import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, StorageError } from '@shared/storage/db';
import { replaceDraft, requestDraft } from './draftCoordinator';
import { setRatingDraftRepository, useRatingStore } from './rating.store';
import { IndexedDbRatingDraftRepository } from '@features/rating/repositories/ratingDraft.repository';
import type { RatingDraftRepository } from '@features/rating/repositories/ratingDraft.repository';
import type { FilmSnapshot, RatingDraft } from '@domain/rating/rating.types';

const filmA: FilmSnapshot = { filmId: 1, title: 'Фильм A', updatedAt: '2026-07-01T00:00:00.000Z' };
const filmB: FilmSnapshot = { filmId: 2, title: 'Фильм B', updatedAt: '2026-07-01T00:00:00.000Z' };

/** In-memory repository so failures can be injected on demand. */
class FakeDraftRepository implements RatingDraftRepository {
  draft: RatingDraft | null = null;
  failSave = false;
  failDelete = false;

  async getActive(): Promise<RatingDraft | null> {
    return this.draft;
  }
  async saveActive(draft: RatingDraft): Promise<void> {
    if (this.failSave) throw new StorageError('quota');
    this.draft = draft;
  }
  async deleteActive(): Promise<void> {
    if (this.failDelete) throw new StorageError('aborted');
    this.draft = null;
  }
  async flush(): Promise<void> {}
}

let repository: FakeDraftRepository;

beforeEach(async () => {
  await db.ratingDrafts.clear();
  repository = new FakeDraftRepository();
  setRatingDraftRepository(repository);
  useRatingStore.setState({ draft: null, hydrated: true, storageError: null });
});

describe('draft coordinator', () => {
  it('creates a draft when nothing is in progress', async () => {
    const outcome = await requestDraft({ film: filmA, mode: 'quick' });

    expect(outcome.kind).toBe('started');
    expect(useRatingStore.getState().draft?.film.filmId).toBe(1);
  });

  it('resumes instead of restarting when the same film is already in progress', async () => {
    const first = await useRatingStore.getState().start({ film: filmA, mode: 'detailed' });
    await useRatingStore.getState().setAspect('story', 4);
    const progressed = useRatingStore.getState().draft;

    const outcome = await requestDraft({ film: filmA, mode: 'detailed' });

    expect(outcome.kind).toBe('resumed');
    // The very same draft, not a fresh one: answers already given survive.
    expect(useRatingStore.getState().draft).toBe(progressed);
    expect(useRatingStore.getState().draft?.aspects.story).toBe(4);
    expect(useRatingStore.getState().draft?.draftUuid).toBe(first.draftUuid);
  });

  it('reports a conflict rather than replacing another film', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'quick' });

    const outcome = await requestDraft({ film: filmB, mode: 'quick' });

    expect(outcome).toMatchObject({ kind: 'conflict' });
    // Nothing was touched — the other film's work is still there.
    expect(useRatingStore.getState().draft?.film.filmId).toBe(1);
  });

  it('reports a conflict before switching the same film to the other mode', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'detailed' });
    await useRatingStore.getState().setAspect('story', 5);

    const outcome = await requestDraft({ film: filmA, mode: 'quick' });

    expect(outcome).toMatchObject({ kind: 'modeConflict' });
    expect(useRatingStore.getState().draft?.aspects.story).toBe(5);
  });

  it('treats editing a different entry of the same film as a new intent', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'quick' });

    const outcome = await requestDraft({ film: filmA, mode: 'quick', editingEntryId: 'entry-9' });

    expect(outcome).toMatchObject({ kind: 'modeConflict' });
  });

  it('replaces only when explicitly told to', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'quick' });

    const created = await replaceDraft({ film: filmB, mode: 'detailed' });

    expect(created.film.filmId).toBe(2);
    expect(useRatingStore.getState().draft?.film.filmId).toBe(2);
    expect(repository.draft?.film.filmId).toBe(2);
  });
});

describe('storage failures are never silent', () => {
  it('rejects and records the error when a draft cannot be written', async () => {
    repository.failSave = true;

    await expect(useRatingStore.getState().start({ film: filmA, mode: 'quick' })).rejects.toThrow(
      StorageError,
    );
    // The caller learns about it *and* the UI can show a retry.
    expect(useRatingStore.getState().storageError).toBeInstanceOf(StorageError);
  });

  it('rejects when an answer cannot be persisted, so the flow can stay put', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'detailed' });
    repository.failSave = true;

    await expect(useRatingStore.getState().setAspect('story', 4)).rejects.toThrow(StorageError);
    expect(useRatingStore.getState().storageError?.kind).toBe('quota');
  });

  it('clears the error once a later write succeeds', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'detailed' });
    repository.failSave = true;
    await expect(useRatingStore.getState().setAspect('story', 4)).rejects.toThrow();

    repository.failSave = false;
    await useRatingStore.getState().retrySave();

    expect(useRatingStore.getState().storageError).toBeNull();
    expect(repository.draft?.aspects.story).toBe(4);
  });

  it('keeps the draft in memory when deleting it fails', async () => {
    await useRatingStore.getState().start({ film: filmA, mode: 'quick' });
    repository.failDelete = true;

    await expect(useRatingStore.getState().discard()).rejects.toThrow(StorageError);
    // Clearing memory here would have resurrected the draft on the next launch.
    expect(useRatingStore.getState().draft?.film.filmId).toBe(1);
    expect(repository.draft).not.toBeNull();
  });
});

describe('draft persistence across a restart', () => {
  it('prefers the mirror when IndexedDB lost the last write', async () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;

    const real = new IndexedDbRatingDraftRepository(fakeStorage);
    setRatingDraftRepository(real);

    await useRatingStore.getState().start({ film: filmA, mode: 'detailed' });
    await useRatingStore.getState().setAspect('story', 3);

    // Simulate the async write never landing while the sync mirror did.
    await db.ratingDrafts.clear();

    useRatingStore.setState({ draft: null, hydrated: false });
    await useRatingStore.getState().hydrate();

    expect(useRatingStore.getState().draft?.aspects.story).toBe(3);
  });
});

describe('a corrupted draft never breaks the flow', () => {
  it('degrades to no draft instead of throwing', async () => {
    const storage = {
      getItem: () => '{"schemaVersion":1,"mode":"nonsense"',
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;

    setRatingDraftRepository(new IndexedDbRatingDraftRepository(storage));
    await db.ratingDrafts.clear();

    useRatingStore.setState({ draft: null, hydrated: false });
    await useRatingStore.getState().hydrate();

    expect(useRatingStore.getState().draft).toBeNull();
    expect(useRatingStore.getState().hydrated).toBe(true);
  });
});

// Restore the real repository for any suite that runs after this file.
afterEach(() => {
  vi.restoreAllMocks();
});
