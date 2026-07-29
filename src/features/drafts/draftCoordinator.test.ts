import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@shared/storage/db';
import {
  discardActive,
  replaceDraft,
  replaceWithWritingDraft,
  requestDraft,
  requestWritingDraft,
  restoreDraft,
} from './draftCoordinator';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useWritingStore } from '@features/writing/model/writing.store';
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
  useWritingStore.setState({ draft: null, hydrated: true, storageError: null, dirty: false });
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

describe('one slot, two kinds of draft', () => {
  const writingOptions = {
    entryId: 'entry-1',
    film: { filmId: 1, filmTitle: 'Фильм A', posterPath: null, releaseYear: '2024' },
    source: 'ratingResult' as const,
  };

  it('starts a writing draft when nothing is in progress', async () => {
    const outcome = await requestWritingDraft(writingOptions);

    expect(outcome.kind).toBe('started');
    expect(useWritingStore.getState().draft?.entryId).toBe('entry-1');
    expect(await db.ratingDrafts.count()).toBe(1);
  });

  it('resumes the text of the same entry with what was typed', async () => {
    await requestWritingDraft(writingOptions);
    useWritingStore.getState().setText('Пара фраз');
    await useWritingStore.getState().flush();

    const outcome = await requestWritingDraft(writingOptions);

    expect(outcome.kind).toBe('resumed');
    expect(useWritingStore.getState().draft?.workingText).toBe('Пара фраз');
  });

  it('will not start a rating over an unfinished text', async () => {
    await requestWritingDraft(writingOptions);
    useWritingStore.getState().setText('Важный абзац');
    await useWritingStore.getState().flush();

    const outcome = await requestDraft({ film: filmA, mode: 'quick' });

    expect(outcome.kind).toBe('conflict');
    // Nothing was touched.
    expect(useWritingStore.getState().draft?.workingText).toBe('Важный абзац');
    expect(useRatingStore.getState().draft).toBeNull();
  });

  it('will not start a text over an unfinished rating', async () => {
    await requestDraft({ film: filmA, mode: 'quick' });

    const outcome = await requestWritingDraft({ ...writingOptions, entryId: 'entry-2' });

    expect(outcome.kind).toBe('conflict');
    expect(useWritingStore.getState().draft).toBeNull();
  });

  it('treats a text for another entry as a conflict', async () => {
    await requestWritingDraft(writingOptions);
    const outcome = await requestWritingDraft({ ...writingOptions, entryId: 'entry-other' });
    expect(outcome.kind).toBe('conflict');
  });

  it('leaves exactly one row when a text replaces a rating', async () => {
    await requestDraft({ film: filmA, mode: 'quick' });
    await replaceWithWritingDraft(writingOptions);

    expect(await db.ratingDrafts.count()).toBe(1);
    expect(useRatingStore.getState().draft).toBeNull();
    expect(useWritingStore.getState().draft?.entryId).toBe('entry-1');
  });

  it('puts a deleted text back exactly as it was', async () => {
    await requestWritingDraft(writingOptions);
    useWritingStore.getState().setText('Не потеряй меня');
    await useWritingStore.getState().flush();
    const snapshot = useWritingStore.getState().draft!;

    await discardActive();
    expect(await db.ratingDrafts.count()).toBe(0);

    expect(await restoreDraft(snapshot)).toBe(true);
    expect(useWritingStore.getState().draft?.workingText).toBe('Не потеряй меня');
    expect(await db.ratingDrafts.count()).toBe(1);
  });

  it('refuses to restore over a draft started meanwhile', async () => {
    await requestWritingDraft(writingOptions);
    const snapshot = useWritingStore.getState().draft!;
    await discardActive();
    await requestDraft({ film: filmB, mode: 'quick' });

    expect(await restoreDraft(snapshot)).toBe(false);
    expect(useRatingStore.getState().draft?.filmId).toBe(2);
  });
});
