import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@shared/storage/db';
import { IndexedDbDiaryRepository, IndexedDbSyncQueueRepository } from './diary.repository';
import { IndexedDbActiveDraftRepository } from '@features/drafts/activeDraft.repository';
import { createDraft, setAspectRating } from '@domain/rating/rating.machine';
import { emptyAspects } from '@domain/rating/rating.types';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { RatingFilmSummary } from '@domain/rating/rating.machine';
import type { RatingDraft } from '@domain/rating/rating.types';
import { isRatingDraft } from '@domain/writing/writing.types';

/** The stored draft is a union; these cases always store a rating one. */
const asRating = (draft: unknown): RatingDraft | null =>
  isRatingDraft(draft as never) ? (draft as RatingDraft) : null;

const film: RatingFilmSummary = {
  filmId: 7,
  filmTitle: 'Фильм',
  posterPath: '/p.jpg',
  backdropPath: null,
  releaseYear: '2024',
};

const entry = (overrides: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'entry-1',
  filmId: 7,
  filmTitle: 'Фильм',
  posterPath: '/p.jpg',
  releaseYear: '2024',
  mode: 'quick',
  overallRating: 4,
  preciseRating: 4,
  aspects: emptyAspects(),
  hasText: false,
  text: null,
  watchedAt: '2026-07-10T12:00:00.000Z',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
  clientMutationId: 'mut-1',
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
  await db.diaryEntries.clear();
  await db.ratingDrafts.clear();
  await db.syncQueue.clear();
  await db.watchlist.clear();
});

describe('diary repository', () => {
  it('stores and lists an entry', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());

    const all = await repository.listActive();
    expect(all).toHaveLength(1);
    expect(all[0]?.overallRating).toBe(4);
  });

  it('keeps exactly one entry per film', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());
    await repository.upsert(entry({ id: 'entry-2', clientMutationId: 'mut-2', overallRating: 5 }));

    const all = await repository.listActive();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('entry-2');
    expect(await repository.getByFilmId(7)).toMatchObject({ id: 'entry-2' });
  });

  it('is idempotent for a repeated save', async () => {
    const repository = new IndexedDbDiaryRepository();
    const first = await repository.upsert(entry());
    const second = await repository.upsert(entry({ overallRating: 1 }));

    // Same clientMutationId → the second tap changes nothing.
    expect(second.overallRating).toBe(first.overallRating);
    expect(await repository.listActive()).toHaveLength(1);
  });

  it('preserves createdAt when an entry is edited', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());
    const edited = await repository.upsert(
      entry({
        clientMutationId: 'mut-2',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        revision: 2,
        overallRating: 2,
      }),
    );

    expect(edited.createdAt).toBe('2026-07-10T12:00:00.000Z');
    expect(edited.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(edited.overallRating).toBe(2);
  });

  it('sorts by updatedAt, so an edited film comes back to the top', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry({ id: 'old', filmId: 1, clientMutationId: 'm1' }));
    await repository.upsert(
      entry({
        id: 'new',
        filmId: 2,
        clientMutationId: 'm2',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
      }),
    );

    const all = await repository.listActive();
    expect(all.map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('hides a soft-deleted entry and restores it in place', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());

    await repository.softDelete('entry-1');
    expect(await repository.listActive()).toHaveLength(0);
    // A tombstone must not be reachable as a normal entry.
    expect(await repository.getById('entry-1')).toBeNull();

    const restored = await repository.restore('entry-1');
    expect(restored?.createdAt).toBe('2026-07-10T12:00:00.000Z');
    expect(await repository.listActive()).toHaveLength(1);
  });

  it('rejects a deep entry with a missing aspect', async () => {
    const repository = new IndexedDbDiaryRepository();
    await expect(
      repository.upsert(
        entry({
          mode: 'deep',
          aspects: { story: 4, characters: 4, direction: 4, sound: 4, aftertaste: null },
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a quick entry that carries aspects', async () => {
    const repository = new IndexedDbDiaryRepository();
    await expect(
      repository.upsert(
        entry({
          mode: 'quick',
          aspects: { story: 4, characters: 4, direction: 4, sound: 4, aftertaste: 4 },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('sync queue', () => {
  it('queues a save inside the same transaction as the entry', async () => {
    const queue = new IndexedDbSyncQueueRepository();
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());

    const pending = await queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.task).toMatchObject({ type: 'diaryUpsert', entryId: 'entry-1' });

    await queue.markSynced(pending[0]!.id);
    expect(await queue.listPending()).toHaveLength(0);
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
    const repository = new IndexedDbActiveDraftRepository(new MemoryStorage());
    const draft = setAspectRating(createDraft({ film, mode: 'deep' }), 'story', 3);

    await repository.saveActive(draft);
    const restored = asRating(await repository.getActive());
    expect(restored?.aspects.story).toBe(3);
    expect(restored?.id).toBe(draft.id);
  });

  it('prefers the newest revision when the mirror is ahead', async () => {
    const storage = new MemoryStorage();
    const repository = new IndexedDbActiveDraftRepository(storage);

    const older = setAspectRating(createDraft({ film, mode: 'deep' }), 'story', 1);
    await repository.saveActive(older);

    // A WebView killed after the mirror write but before IndexedDB.
    const newer = { ...setAspectRating(older, 'story', 5), revision: older.revision + 5 };
    storage.setItem('syo:rating-draft:active', JSON.stringify(newer));

    expect(asRating(await repository.getActive())?.aspects.story).toBe(5);
  });

  it('breaks a revision tie with updatedAt', async () => {
    const storage = new MemoryStorage();
    const repository = new IndexedDbActiveDraftRepository(storage);

    const stored = setAspectRating(createDraft({ film, mode: 'deep' }), 'story', 2);
    await repository.saveActive(stored);

    const sameRevisionButLater = {
      ...stored,
      aspects: { ...stored.aspects, story: 5 },
      updatedAt: new Date(Date.parse(stored.updatedAt) + 5000).toISOString(),
    };
    storage.setItem('syo:rating-draft:active', JSON.stringify(sameRevisionButLater));

    expect(asRating(await repository.getActive())?.aspects.story).toBe(5);
  });

  it('recovers a draft that only the mirror has', async () => {
    const storage = new MemoryStorage();
    const draft = setAspectRating(createDraft({ film, mode: 'deep' }), 'story', 2);
    storage.setItem('syo:rating-draft:active', JSON.stringify(draft));

    const repository = new IndexedDbActiveDraftRepository(storage);
    expect(asRating(await repository.getActive())?.aspects.story).toBe(2);
  });

  it('salvages a corrupted draft instead of losing the film', async () => {
    const storage = new MemoryStorage();
    const draft = createDraft({ film, mode: 'deep' });
    storage.setItem(
      'syo:rating-draft:active',
      // A score outside the scale and a nonsense mode.
      JSON.stringify({ ...draft, mode: 'nonsense', aspects: { ...draft.aspects, story: 9 } }),
    );

    const repository = new IndexedDbActiveDraftRepository(storage);
    const restored = asRating(await repository.getActive());
    expect(restored?.filmId).toBe(7);
    expect(restored?.mode).toBeNull();
    expect(restored?.aspects.story).toBeNull();
  });

  it('ignores an unparseable mirror instead of crashing the flow', async () => {
    const storage = new MemoryStorage();
    storage.setItem('syo:rating-draft:active', '{not json');
    const repository = new IndexedDbActiveDraftRepository(storage);
    expect(await repository.getActive()).toBeNull();
  });

  it('clears both layers on delete', async () => {
    const storage = new MemoryStorage();
    const repository = new IndexedDbActiveDraftRepository(storage);
    await repository.saveActive(createDraft({ film, mode: 'quick' }));

    await repository.deleteActive();
    expect(await repository.getActive()).toBeNull();
    expect(storage.getItem('syo:rating-draft:active')).toBeNull();
  });
});

describe('schema migration', () => {
  it('keeps every earlier store while new versions add their own', async () => {
    await db.open();
    const names = db.tables.map((table) => table.name);

    // The point is that nothing was dropped along the way; later stages add.
    expect(names).toEqual(
      expect.arrayContaining([
        'diaryEntries',
        'feed',
        'films',
        'preferences',
        'presentations',
        'ratingDrafts',
        'syncQueue',
        'watchlist',
      ]),
    );
    expect(db.verno).toBeGreaterThanOrEqual(3);
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

describe('entry text', () => {
  const revision = (id: string, text: string) => ({
    id,
    parentRevisionId: null,
    kind: 'user' as const,
    origin: 'manual' as const,
    text,
    changeSummary: null,
    createdAt: '2026-07-10T12:00:00.000Z',
    promptVersion: null,
    requestId: null,
  });

  const text = (value = 'Мой текст о фильме') => ({
    selectedRevisionId: 'rev-1',
    revisions: [revision('rev-1', value)],
    conversation: null,
    spoiler: false,
  });

  it('saves text onto an existing entry without touching the rating', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry({ mode: 'quick', overallRating: 4, preciseRating: 4 }));

    const stored = await repository.saveText('entry-1', text());

    expect(stored?.hasText).toBe(true);
    expect(stored?.text?.revisions[0]?.text).toBe('Мой текст о фильме');
    // The rating is exactly what it was.
    expect(stored?.overallRating).toBe(4);
    expect(stored?.mode).toBe('quick');
  });

  it('removes the text and leaves the entry in place', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());
    await repository.saveText('entry-1', text());

    const cleared = await repository.saveText('entry-1', null);

    expect(cleared?.hasText).toBe(false);
    expect(cleared?.text).toBeNull();
    expect(await repository.listActive()).toHaveLength(1);
  });

  it('restores a removed text exactly as it was', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());
    const saved = await repository.saveText('entry-1', text('Слова, которые жаль потерять'));
    const snapshot = saved!.text!;

    await repository.saveText('entry-1', null);
    const restored = await repository.saveText('entry-1', snapshot);

    expect(restored?.text?.revisions[0]?.text).toBe('Слова, которые жаль потерять');
  });

  it('queues the change in the same transaction as the text', async () => {
    const repository = new IndexedDbDiaryRepository();
    const queue = new IndexedDbSyncQueueRepository();
    await repository.upsert(entry());
    await db.syncQueue.clear();

    const stored = await repository.saveText('entry-1', text());
    const pending = await queue.listPending();

    expect(pending).toHaveLength(1);
    expect(pending[0]?.task).toMatchObject({
      type: 'diaryUpsert',
      entryId: 'entry-1',
      revision: stored?.revision,
    });
  });

  it('rejects text whose selected revision does not exist', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());

    await expect(
      repository.saveText('entry-1', { ...text(), selectedRevisionId: 'ghost' }),
    ).rejects.toThrow();
  });

  it('reports a deleted entry rather than resurrecting it', async () => {
    const repository = new IndexedDbDiaryRepository();
    await repository.upsert(entry());
    await repository.softDelete('entry-1');

    expect(await repository.saveText('entry-1', text())).toBeNull();
  });
});
