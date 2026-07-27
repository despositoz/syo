import { db, safeRead, strictWrite } from '@shared/storage/db';
import type { SyncTask } from '@shared/storage/db';
import { assertValidEntry } from '@domain/journal/journal.validation';
import { isActiveEntry, type JournalEntry } from '@domain/journal/journal.types';

/**
 * Local-first journal storage (spec §14).
 *
 * A save is complete once the local transaction commits; sync is queued and
 * never blocks the UI. Deletes are soft so Undo is a restore, not a re-insert.
 */

export interface JournalRepository {
  listActive(): Promise<JournalEntry[]>;
  getById(id: string): Promise<JournalEntry | null>;
  /** The one active (non-deleted) entry for a film, if it exists. */
  getByFilmId(filmId: number): Promise<JournalEntry | null>;
  upsert(entry: JournalEntry): Promise<JournalEntry>;
  softDelete(id: string): Promise<JournalEntry | null>;
  restore(id: string): Promise<JournalEntry | null>;
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

export class IndexedDbJournalRepository implements JournalRepository {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly queue: SyncQueueRepository = syncQueueRepository) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  async listActive(): Promise<JournalEntry[]> {
    const rows = await safeRead(() => db.journal.toArray(), []);
    return rows
      .filter(isActiveEntry)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getById(id: string): Promise<JournalEntry | null> {
    const row = await safeRead(() => db.journal.get(id), undefined);
    return row ?? null;
  }

  async getByFilmId(filmId: number): Promise<JournalEntry | null> {
    // filmId is indexed but not unique — tombstones share it, so filter here.
    const rows = await safeRead(() => db.journal.where('filmId').equals(filmId).toArray(), []);
    return rows.filter(isActiveEntry)[0] ?? null;
  }

  /**
   * Idempotent by `clientMutationId`: a double tap on Save, or a replayed sync,
   * updates the same row instead of creating a second one.
   */
  async upsert(entry: JournalEntry): Promise<JournalEntry> {
    assertValidEntry(entry);

    const stored = await strictWrite(async () =>
      db.transaction('rw', db.journal, async () => {
        const existing = await db.journal.get(entry.id);
        if (existing?.clientMutationId === entry.clientMutationId) return existing;

        // One active entry per film: fold any other active row for this film in.
        const sameFilm = (await db.journal.where('filmId').equals(entry.filmId).toArray())
          .filter(isActiveEntry)
          .filter((row) => row.id !== entry.id);

        const next: JournalEntry = {
          ...entry,
          // Editing keeps the original creation date; the Diary must not reorder.
          createdAt: existing?.createdAt ?? sameFilm[0]?.createdAt ?? entry.createdAt,
          deletedAt: null,
        };

        await db.journal.put(next);
        for (const duplicate of sameFilm) await db.journal.delete(duplicate.id);
        return next;
      }),
    );

    await this.queue.enqueue({
      type: 'journalUpsert',
      entryId: stored.id,
      clientMutationId: stored.clientMutationId,
      revision: stored.revision,
    });
    this.emit();
    return stored;
  }

  async softDelete(id: string): Promise<JournalEntry | null> {
    const entry = await this.getById(id);
    if (!entry) return null;

    const deleted: JournalEntry = {
      ...entry,
      deletedAt: new Date().toISOString(),
      syncStatus: 'deleted',
      revision: entry.revision + 1,
    };
    await strictWrite(() => db.journal.put(deleted));
    await this.queue.enqueue({
      type: 'journalDelete',
      entryId: id,
      clientMutationId: deleted.clientMutationId,
      revision: deleted.revision,
    });
    this.emit();
    return deleted;
  }

  /** Undo. Keeps the original createdAt so the card returns to its place. */
  async restore(id: string): Promise<JournalEntry | null> {
    const entry = await this.getById(id);
    if (!entry) return null;

    const restored: JournalEntry = {
      ...entry,
      deletedAt: null,
      syncStatus: 'local',
      revision: entry.revision + 1,
    };
    await strictWrite(() => db.journal.put(restored));
    await this.queue.enqueue({
      type: 'journalUpsert',
      entryId: id,
      clientMutationId: restored.clientMutationId,
      revision: restored.revision,
    });
    this.emit();
    return restored;
  }

  /** Drops the tombstone for good. Not called during the Undo window. */
  async finalizeDelete(id: string): Promise<void> {
    await strictWrite(() => db.journal.delete(id));
    this.emit();
  }
}

export const journalRepository: JournalRepository = new IndexedDbJournalRepository();
