import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@shared/storage/db';
import { IndexedDbJournalRepository, IndexedDbSyncQueueRepository } from './journal.repository';
import { IndexedDbRatingDraftRepository } from '@features/rating/repositories/ratingDraft.repository';
import { createDraft, setAspectScore } from '@domain/rating/rating.machine';
import type { JournalEntry } from '@domain/journal/journal.types';
import type { FilmSnapshot } from '@domain/rating/rating.types';

const film: FilmSnapshot = { filmId: 7, title: 'Фильм', updatedAt: '2026-07-01T00:00:00.000Z' };

const entry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  schemaVersion: 1,
  id: 'entry-1',
  clientMutationId: 'mut-1',
  filmId: 7,
  film,
  mode: 'quick',
  quickScore: 4,
  aspects: null,
  rawScore: 4,
  displayScore: 4,
  formulaVersion: 1,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

/** localStorage stand-in so the mirror can be inspected and corrupted. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(async () => {
  await db.journal.clear();
  await db.ratingDrafts.clear();
  await db.syncQueue.clear();
  await db.watchlist.clear();
});

describe('journal repository', () => {
  it('stores and lists an entry', async () => {
    const repository = new IndexedDbJournalRepository();
    await repository.upsert(entry());

    const all = await repository.listActive();
    expect(all).toHaveLength(1);
    expect(all[0]?.displayScore).toBe(4);
  });

  it('keeps exactly one active entry per film', async () => {
    const repository = new IndexedDbJournalRepository();
    await repository.upsert(entry());
    await repository.upsert(entry({ id: 'entry-2', clientMutationId: 'mut-2', displayScore: 5 }));

    const all = await repository.listActive();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('entry-2');
    expect(await repository.getByFilmId(7)).toMatchObject({ id: 'entry-2' });
  });

  it('is idempotent for a repeated save', async () => {
    const repository = new IndexedDbJournalRepository();
    const first = await repository.upsert(entry());
    const second = await repository.upsert(entry({ displayScore: 1 }));

    // Same clientMutationId → the second tap changes nothing.
    expect(second.displayScore).toBe(first.displayScore);
    expect(await repository.listActive()).toHaveLength(1);
  });

  it('preserves createdAt when an entry is edited', async () => {
    const repository = new IndexedDbJournalRepository();
    await repository.upsert(entry());
    const edited = await repository.upsert(
      entry({
        clientMutationId: 'mut-2',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        revision: 2,
        displayScore: 2,
      }),
    );

    // The Diary groups by createdAt: editing must not move the card to August.
    expect(edited.createdAt).toBe('2026-07-10T12:00:00.000Z');
    expect(edited.displayScore).toBe(2);
  });

  it('hides a soft-deleted entry and restores it in place', async () => {
    const repository = new IndexedDbJournalRepository();
    await repository.upsert(entry());

    await repository.softDelete('entry-1');
    expect(await repository.listActive()).toHaveLength(0);
    // The tombstone survives, which is what makes Undo a restore.
    expect(await repository.getById('entry-1')).toMatchObject({ syncStatus: 'deleted' });

    const restored = await repository.restore('entry-1');
    expect(restored?.createdAt).toBe('2026-07-10T12:00:00.000Z');
    expect(await repository.listActive()).toHaveLength(1);
  });

  it('drops the tombstone only on finalize', async () => {
    const repository = new IndexedDbJournalRepository();
    await repository.upsert(entry());
    await repository.softDelete('entry-1');
    await repository.finalizeDelete('entry-1');
    expect(await repository.getById('entry-1')).toBeNull();
  });

  it('rejects a detailed entry with a missing aspect', async () => {
    const repository = new IndexedDbJournalRepository();
    await expect(
      repository.upsert(
        entry({
          mode: 'detailed',
          quickScore: null,
          aspects: {
            story: 4,
            performance: 4,
            directionVisual: 4,
            soundMusic: 4,
            aftertaste: null,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('notifies subscribers on every mutation', async () => {
    const repository = new IndexedDbJournalRepository();
    let calls = 0;
    const unsubscribe = repository.subscribe(() => {
      calls += 1;
    });

    await repository.upsert(entry());
    await repository.softDelete('entry-1');
    unsubscribe();
    await repository.restore('entry-1');

    expect(calls).toBe(2);
  });
});

describe('sync queue', () => {
  it('queues a save and clears it once synced', async () => {
    const queue = new IndexedDbSyncQueueRepository();
    const repository = new IndexedDbJournalRepository();
    await repository.upsert(entry());

    const pending = await queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.task).toMatchObject({ type: 'journalUpsert', entryId: 'entry-1' });

    await queue.markSynced(pending[0]!.id);
    expect(await queue.listPending()).toHaveLength(0);
  });

  it('never saves an entry without its sync task', async () => {
    const repository = new IndexedDbJournalRepository();
    const queue = new IndexedDbSyncQueueRepository();

    // Break the queue write, then attempt a save.
    const add = db.syncQueue.add.bind(db.syncQueue);
    vi.spyOn(db.syncQueue, 'add').mockRejectedValueOnce(new Error('queue full'));

    await expect(repository.upsert(entry())).rejects.toThrow();

    // Both sides rolled back together: no orphan entry claiming to be saved
    // while the caller was told the save failed.
    expect(await repository.listActive()).toHaveLength(0);
    expect(await queue.listPending()).toHaveLength(0);

    vi.mocked(db.syncQueue.add).mockRestore();
    expect(typeof add).toBe('function');
  });

  it('records an error without losing the task', async () => {
    const queue = new IndexedDbSyncQueueRepository();
    await queue.enqueue({ type: 'watchlistAdd', filmId: 1 });
    const [task] = await queue.listPending();

    await queue.markError(task!.id, 'network');
    const [retried] = await queue.listPending();
    expect(retried?.attempts).toBe(1);
  });
});

describe('rating draft repository', () => {
  it('round-trips a draft', async () => {
    const repository = new IndexedDbRatingDraftRepository(new MemoryStorage());
    const draft = setAspectScore(createDraft({ film, mode: 'detailed' }), 'story', 3);

    await repository.saveActive(draft);
    const restored = await repository.getActive();
    expect(restored?.aspects.story).toBe(3);
    expect(restored?.draftUuid).toBe(draft.draftUuid);
  });

  it('keeps a deliberate zero through storage', async () => {
    const repository = new IndexedDbRatingDraftRepository(new MemoryStorage());
    await repository.saveActive(
      setAspectScore(createDraft({ film, mode: 'detailed' }), 'story', 0),
    );

    const restored = await repository.getActive();
    expect(restored?.aspects.story).toBe(0);
    expect(restored?.aspects.performance).toBeNull();
  });

  it('prefers the newest revision when the mirror is ahead', async () => {
    const storage = new MemoryStorage();
    const repository = new IndexedDbRatingDraftRepository(storage);

    const older = setAspectScore(createDraft({ film, mode: 'detailed' }), 'story', 1);
    await repository.saveActive(older);

    // Simulate a WebView killed after the mirror write but before IndexedDB.
    const newer = { ...setAspectScore(older, 'story', 5), revision: older.revision + 5 };
    storage.setItem('syo:rating-draft:active', JSON.stringify(newer));

    const restored = await repository.getActive();
    expect(restored?.aspects.story).toBe(5);
    // …and the winner is written back, so both layers agree afterwards.
    expect((await db.ratingDrafts.get('active'))?.aspects.story).toBe(5);
  });

  it('recovers a draft that only the mirror has', async () => {
    const storage = new MemoryStorage();
    const draft = setAspectScore(createDraft({ film, mode: 'detailed' }), 'story', 2);
    storage.setItem('syo:rating-draft:active', JSON.stringify(draft));

    const repository = new IndexedDbRatingDraftRepository(storage);
    expect((await repository.getActive())?.aspects.story).toBe(2);
  });

  it('ignores a corrupted mirror instead of crashing the flow', async () => {
    const storage = new MemoryStorage();
    storage.setItem('syo:rating-draft:active', '{not json');
    const repository = new IndexedDbRatingDraftRepository(storage);
    expect(await repository.getActive()).toBeNull();
  });

  it('clears both layers on delete', async () => {
    const storage = new MemoryStorage();
    const repository = new IndexedDbRatingDraftRepository(storage);
    await repository.saveActive(createDraft({ film, mode: 'quick' }));

    await repository.deleteActive();
    expect(await repository.getActive()).toBeNull();
    expect(storage.getItem('syo:rating-draft:active')).toBeNull();
  });
});

describe('schema migration', () => {
  it('opens at version 2 with the new stores and keeps the old ones', async () => {
    await db.open();
    const names = db.tables.map((table) => table.name).sort();
    expect(names).toEqual(
      [
        'feed',
        'films',
        'journal',
        'preferences',
        'presentations',
        'ratingDrafts',
        'syncQueue',
        'watchlist',
      ].sort(),
    );
    expect(db.verno).toBeGreaterThanOrEqual(2);
  });

  it('does not disturb existing watchlist rows', async () => {
    await db.watchlist.put({
      id: 1,
      title: 'Старый фильм',
      year: '2020',
      posterPath: '/p.jpg',
      accent: { hex: '#000', rgb: '0, 0, 0' },
      addedAt: 1,
      pendingSync: false,
    });

    await db.close();
    await db.open();

    expect(await db.watchlist.get(1)).toMatchObject({ title: 'Старый фильм' });
  });
});
