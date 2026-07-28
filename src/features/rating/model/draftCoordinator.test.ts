import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@shared/storage/db';
import { requestDraft, replaceDraft } from './draftCoordinator';
import { useRatingStore } from './rating.store';
import type { RatingFilmSummary } from '@domain/rating/rating.machine';

const filmA: RatingFilmSummary = {
  filmId: 1,
  filmTitle: 'Фильм A',
  posterPath: '/a.jpg',
  backdropPath: null,
  releaseYear: '2024',
};

const filmB: RatingFilmSummary = { ...filmA, filmId: 2, filmTitle: 'Фильм B' };

beforeEach(async () => {
  await db.ratingDrafts.clear();
  globalThis.localStorage?.clear();
  useRatingStore.setState({ draft: null, hydrated: true, storageError: null });
});

describe('one active draft', () => {
  it('creates a draft when nothing is in progress', async () => {
    const outcome = await requestDraft({ film: filmA, mode: 'quick' });

    expect(outcome.kind).toBe('started');
    expect(useRatingStore.getState().draft?.filmId).toBe(1);
  });

  it('resumes the same film instead of starting over', async () => {
    const first = await requestDraft({ film: filmA, mode: 'deep' });
    if (first.kind !== 'started') throw new Error('expected a fresh draft');
    await useRatingStore.getState().setAspect('story', 4);

    const second = await requestDraft({ film: filmA, mode: 'deep' });

    expect(second.kind).toBe('resumed');
    // The answer already given must survive: that is the whole point.
    expect(useRatingStore.getState().draft?.aspects.story).toBe(4);
  });

  it('refuses to silently replace another film and reports a conflict', async () => {
    await requestDraft({ film: filmA, mode: 'quick' });
    await useRatingStore.getState().setQuick(5);

    const outcome = await requestDraft({ film: filmB, mode: 'quick' });

    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') throw new Error('expected a conflict');
    expect(outcome.existing.filmId).toBe(1);
    // Nothing was touched.
    expect(useRatingStore.getState().draft?.filmId).toBe(1);
    expect(useRatingStore.getState().draft?.quickRating).toBe(5);
  });

  it('treats editing a different entry as a conflict, not a resume', async () => {
    await requestDraft({ film: filmA, mode: 'quick' });

    const outcome = await requestDraft({ film: filmA, mode: 'quick', editingEntryId: 'entry-9' });

    expect(outcome.kind).toBe('conflict');
  });

  it('replaces only after an explicit confirmation', async () => {
    await requestDraft({ film: filmA, mode: 'quick' });
    await useRatingStore.getState().setQuick(3);

    const replaced = await replaceDraft({ film: filmB, mode: 'deep' });

    expect(replaced.filmId).toBe(2);
    expect(useRatingStore.getState().draft?.filmId).toBe(2);
    // Exactly one row survives: two active drafts must never coexist.
    expect(await db.ratingDrafts.count()).toBe(1);
  });

  it('keeps a single stored row across repeated starts', async () => {
    await replaceDraft({ film: filmA, mode: 'quick' });
    await replaceDraft({ film: filmB, mode: 'quick' });
    await replaceDraft({ film: filmA, mode: 'deep' });

    expect(await db.ratingDrafts.count()).toBe(1);
    expect(useRatingStore.getState().draft?.filmId).toBe(1);
  });
});
