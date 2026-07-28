import { db, safeRead, strictWrite } from '@shared/storage/db';
import type { SyncTask } from '@shared/storage/db';
import { assertValidEntry, sortForDiary } from '@domain/diary/diary.schema';
import { isActiveEntry, type DiaryEntry } from '@domain/diary/diary.types';

/**
 * Local-first diary storage (spec §39).
 *
 * A save is complete once the local transaction commits; the sync task is
 * written in the same transaction and never gates the UI. Deletes are soft, so
 * Undo is a restore rather than a re-insert.
 */

export interface DiaryRepository {
  listActive(): Promise<DiaryEntry[]>;
  getById(id: string): Promise<DiaryEntry | null>;
  /** The one active (non-deleted) entry for a film, if it exists. */
  getByFilmId(filmId: number): Promise<DiaryEntry | null>;
  upsert(entry: DiaryEntry): Promise<DiaryEntry>;
  softDelete(id: string): Promise<DiaryEntry | null>;
  restore(id: string): Promise<DiaryEntry | null>;
  finalizeDelete(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export interface SyncQueueRepository {
  enqueue(task: SyncTask): Promise<void>;
  listPending(): Promise<{ id: number; task: SyncTask; attempts: number }[]>;
  markSynced(id: number): Promise<void>;
  markError(id: number, reason: string): Promise<void>;
}

export class IndexedDbSyncQueueRepository implements SyncQueueRepository {
  async enqueue(task: SyncTask): Promise<void> {
    await strictWrite(() => db.syncQueue.add({ task, createdAt: Date.now(), attempts: 0 }));
  }

  async listPending(): Promise<{ id: number; task: SyncTask; attempts: number }[]> {
    const rows = await safeRead(() => db.syncQueue.orderBy('createdAt').toArray(), []);
    return rows
      .filter((row): row is typeof row & { id: number } => typeof row.id === 'number')
      .map((row) => ({ id: row.id, task: row.task, attempts: row.attempts }));
  }

  async markSynced(id: number): Promise<void> {
    await strictWrite(() => db.syncQueue.delete(id));
  }

  async markError(id: number, reason: string): Promise<void> {
    await strictWrite(() =>
      db.syncQueue
        .where('id')
        .equals(id)
        .modify((row) => {
          row.attempts += 1;
          row.lastError = reason;
        }),
    );
  }
}

export const syncQueueRepository: SyncQueueRepository = new IndexedDbSyncQueueRepository();

/**
 * Adds a sync task from *inside* an open transaction, so the task and the row
 * it describes commit or fail together. A saved entry whose queue write failed
 * would otherwise report a save error for something already saved.
 */
const enqueueWithin = (task: SyncTask): Promise<number> =>
  db.syncQueue.add({ task, createdAt: Date.now(), attempts: 0 });

export class IndexedDbDiaryRepository implements DiaryRepository {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  /** Newest edit first (spec §33). */
  async listActive(): Promise<DiaryEntry[]> {
    const rows = await safeRead(() => db.diaryEntries.toArray(), []);
    return sortForDiary(rows.filter(isActiveEntry));
  }

  /** A tombstone is storage's business: callers never see a deleted entry. */
  async getById(id: string): Promise<DiaryEntry | null> {
    const row = await safeRead(() => db.diaryEntries.get(id), undefined);
    if (!row) return null;
    return isActiveEntry(row) ? row : null;
  }

  /** Includes tombstones — delete and restore need the row itself. */
  private async getRow(id: string): Promise<DiaryEntry | null> {
    return (await safeRead(() => db.diaryEntries.get(id), undefined)) ?? null;
  }

  async getByFilmId(filmId: number): Promise<DiaryEntry | null> {
    const rows = await safeRead(() => db.diaryEntries.where('filmId').equals(filmId).toArray(), []);
    return rows.filter(isActiveEntry)[0] ?? null;
  }

  /**
   * Idempotent by `clientMutationId`: a double tap on Save, or a replayed sync,
   * updates the same row instead of creating a second one (spec §38).
   */
  async upsert(entry: DiaryEntry): Promise<DiaryEntry> {
    assertValidEntry(entry);

    const stored = await strictWrite(async () =>
      db.transaction('rw', db.diaryEntries, db.syncQueue, async () => {
        const existing = await db.diaryEntries.get(entry.id);
        if (existing?.clientMutationId === entry.clientMutationId) return existing;

        // One entry per film: fold any other active row for this film in.
        const sameFilm = (await db.diaryEntries.where('filmId').equals(entry.filmId).toArray())
          .filter(isActiveEntry)
          .filter((row) => row.id !== entry.id);

        const next: DiaryEntry = {
          ...entry,
          // Editing keeps the original creation date; only updatedAt moves.
          createdAt: existing?.createdAt ?? sameFilm[0]?.createdAt ?? entry.createdAt,
          deletedAt: null,
        };

        await db.diaryEntries.put(next);
        for (const duplicate of sameFilm) await db.diaryEntries.delete(duplicate.id);
        await enqueueWithin({
          type: 'diaryUpsert',
          entryId: next.id,
          clientMutationId: next.clientMutationId,
          revision: next.revision,
        });
        return next;
      }),
    );

    this.emit();
    return stored;
  }

  async softDelete(id: string): Promise<DiaryEntry | null> {
    const entry = await this.getRow(id);
    if (!entry) return null;

    const deleted: DiaryEntry = {
      ...entry,
      deletedAt: new Date().toISOString(),
      syncStatus: 'deleted',
      revision: entry.revision + 1,
    };
    await strictWrite(() =>
      db.transaction('rw', db.diaryEntries, db.syncQueue, async () => {
        await db.diaryEntries.put(deleted);
        await enqueueWithin({
          type: 'diaryDelete',
          entryId: id,
          clientMutationId: deleted.clientMutationId,
          revision: deleted.revision,
        });
      }),
    );
    this.emit();
    return deleted;
  }

  /** Undo. Keeps createdAt, so the card returns to where it was. */
  async restore(id: string): Promise<DiaryEntry | null> {
    const entry = await this.getRow(id);
    if (!entry) return null;

    const restored: DiaryEntry = {
      ...entry,
      deletedAt: null,
      syncStatus: 'local',
      revision: entry.revision + 1,
    };
    await strictWrite(() =>
      db.transaction('rw', db.diaryEntries, db.syncQueue, async () => {
        await db.diaryEntries.put(restored);
        await enqueueWithin({
          type: 'diaryUpsert',
          entryId: id,
          clientMutationId: restored.clientMutationId,
          revision: restored.revision,
        });
      }),
    );
    this.emit();
    return restored;
  }

  /** Drops the tombstone for good, once the Undo window has passed. */
  async finalizeDelete(id: string): Promise<void> {
    await strictWrite(() => db.diaryEntries.delete(id));
    this.emit();
  }
}

export const diaryRepository: DiaryRepository = new IndexedDbDiaryRepository();
