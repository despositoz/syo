import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTelegramFake,
  detailsFixture,
  installFetchMock,
  renderApp,
  resetAppState,
} from './harness';
import { useNavigationStore } from '@app/navigation/navigationStore';
import { db } from '@shared/storage/db';
import { emptyFilm } from '@entities/film/film.model';
import { writeFilmToCache } from '@entities/film/film.cache';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { createDraft, resumeTarget, setQuickRating } from '@domain/rating/rating.machine';
import type { RatingFilmSummary } from '@domain/rating/rating.machine';

const FILM_ID = 101;

const film: RatingFilmSummary = {
  filmId: FILM_ID,
  filmTitle: 'Тихий свет',
  posterPath: '/poster-101.jpg',
  backdropPath: null,
  releaseYear: '2023',
};

/** Seeds the film cache so the flow can start without any network. */
const seedFilm = async () => {
  await writeFilmToCache({
    ...emptyFilm(FILM_ID, 'Тихий свет'),
    year: '2023',
    posterPath: '/poster-101.jpg',
    backdropPath: '/backdrop-101.jpg',
    overview: 'Описание',
    detailed: true,
  });
};

/**
 * Sets a star value through the keyboard: the same commit path as a tap, with
 * no pointer geometry to stub.
 */
const rateStars = async (value: number) => {
  const radios = await screen.findAllByRole('radio');
  const focusable = radios.find((radio) => radio.tabIndex === 0) ?? radios[0]!;
  focusable.focus();
  const user = userEvent.setup();
  await user.keyboard('{Home}');
  for (let step = 1; step < value; step += 1) await user.keyboard('{ArrowRight}');
};

beforeEach(async () => {
  await resetAppState();
  installFetchMock({ details: { [FILM_ID]: detailsFixture(FILM_ID) } });
  await seedFilm();
});

describe('Flow 1 — quick rating end to end', () => {
  it('rates, saves and shows the entry', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await user.click(await screen.findByTestId('mode-quick'));
    await rateStars(4);

    await user.click(await screen.findByTestId('quick-continue'));
    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useDiaryStore.getState().entries).toHaveLength(1));
    const entry = useDiaryStore.getState().entries[0]!;
    expect(entry.mode).toBe('quick');
    expect(entry.overallRating).toBe(4);
    // A quick entry never carries aspects.
    expect(Object.values(entry.aspects).every((value) => value === null)).toBe(true);

    // The finished draft is gone from both layers.
    await waitFor(() => expect(useRatingStore.getState().draft).toBeNull());
    expect(await db.ratingDrafts.count()).toBe(0);
  });

  it('does not create a draft when the chooser is merely opened', async () => {
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await screen.findByTestId('mode-deep');
    expect(useRatingStore.getState().draft).toBeNull();
    expect(await db.ratingDrafts.count()).toBe(0);
  });
});

describe('Flow 2 — deep rating and rounding', () => {
  it('walks five steps and rounds the total to a whole star', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await user.click(await screen.findByTestId('mode-deep'));

    // 5, 4, 5, 4, 5 → 4.6 → 5 stars.
    for (const value of [5, 4, 5, 4, 5]) {
      await rateStars(value);
      await waitFor(() => expect(screen.queryAllByRole('radio').length).toBeGreaterThan(0), {
        timeout: 2000,
      });
      await new Promise((resolve) => setTimeout(resolve, 420));
    }

    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useDiaryStore.getState().entries).toHaveLength(1));
    const entry = useDiaryStore.getState().entries[0]!;
    expect(entry.mode).toBe('deep');
    expect(entry.preciseRating).toBe(4.6);
    expect(entry.overallRating).toBe(5);
  });

  it('never lets a step be skipped', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-deep'));

    // The third marker is in the future while step one is unanswered.
    const future = await screen.findByTestId('step-marker-3');
    expect(future).toBeDisabled();
  });
});

describe('Flow 3 — a draft survives a reload', () => {
  it('resumes on the step it was left on, with values intact', async () => {
    // Persisted exactly the way the app does it, so hydrate() sees real storage.
    await useRatingStore.getState().start({ film, mode: 'deep' });
    await useRatingStore.getState().setAspect('story', 4);
    await useRatingStore.getState().goToStep(1);
    await useRatingStore.getState().setAspect('characters', 3);
    await useRatingStore.getState().goToStep(2);

    // A fresh launch reads storage and lands where the user stopped.
    useRatingStore.setState({ draft: null, hydrated: false });
    await useRatingStore.getState().hydrate();

    const restored = useRatingStore.getState().draft;
    expect(restored?.aspects.story).toBe(4);
    expect(restored?.aspects.characters).toBe(3);
    expect(restored?.currentStep).toBe(2);
    expect(resumeTarget(restored!)).toEqual({ screen: 'deep', step: 2 });
  });

  it('shows the unfinished draft at the top of the diary', async () => {
    await useRatingStore.getState().start({ film, mode: 'quick' });
    await useRatingStore.getState().setQuick(3);

    renderApp({ telegram: createTelegramFake(), path: '/diary' });

    expect(await screen.findByTestId('active-draft-card')).toBeInTheDocument();
    expect(screen.getByText(/Ты не закончил/)).toBeInTheDocument();
  });
});

describe('Flow 4/5 — only one active draft', () => {
  it('offers a choice instead of silently replacing another film', async () => {
    const user = userEvent.setup();
    await useRatingStore
      .getState()
      .start({ film: { ...film, filmId: 999, filmTitle: 'Другой фильм' }, mode: 'quick' });
    await useRatingStore.getState().setQuick(5);

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));

    expect(await screen.findByTestId('conflict-continue')).toBeInTheDocument();
    // Untouched until an explicit choice.
    expect(useRatingStore.getState().draft?.filmId).toBe(999);
  });

  it('discards the old draft only on an explicit choice, then starts the new one', async () => {
    const user = userEvent.setup();
    await useRatingStore
      .getState()
      .start({ film: { ...film, filmId: 999, filmTitle: 'Другой фильм' }, mode: 'quick' });

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));
    await user.click(await screen.findByTestId('conflict-discard'));

    // The new film's draft replaces it — and there is still exactly one.
    await waitFor(() => expect(useRatingStore.getState().draft?.filmId).toBe(FILM_ID));
    expect(await db.ratingDrafts.count()).toBe(1);
  });
});

describe('Flow 6/7 — editing never duplicates a film', () => {
  it('updates the existing entry instead of adding a second card', async () => {
    const user = userEvent.setup();
    await useDiaryStore
      .getState()
      .saveFromDraft(setQuickRating(createDraft({ film, mode: 'quick' }), 3));
    const original = useDiaryStore.getState().entries[0]!;

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    // An already-rated film asks what to do rather than duplicating.
    await user.click(await screen.findByTestId('duplicate-edit'));

    await rateStars(5);
    await user.click(await screen.findByTestId('quick-continue'));
    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useDiaryStore.getState().entries[0]?.overallRating).toBe(5));
    const entries = useDiaryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(original.id);
    // Editing keeps the original creation date.
    expect(entries[0]?.createdAt).toBe(original.createdAt);
  });
});

describe('Flow 10 — saving a rating clears the watchlist', () => {
  it('removes the film from Watch Later and offers to put it back', async () => {
    const user = userEvent.setup();
    await useWatchlistStore.getState().toggle({
      id: FILM_ID,
      title: 'Тихий свет',
      year: '2023',
      posterPath: '/poster-101.jpg',
      accent: { hex: '#6f2a35', rgb: '111, 42, 53' },
    } as never);
    expect(useWatchlistStore.getState().entries[FILM_ID]).toBeDefined();

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));
    await rateStars(4);
    await user.click(await screen.findByTestId('quick-continue'));
    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useWatchlistStore.getState().entries[FILM_ID]).toBeUndefined());
    // Undo restores membership only — the rating stays saved.
    await user.click(await screen.findByTestId('snackbar-action'));
    await waitFor(() => expect(useWatchlistStore.getState().entries[FILM_ID]).toBeDefined());
    expect(useDiaryStore.getState().entries).toHaveLength(1);
  });
});

describe('Flow 8 — delete and undo', () => {
  it('restores a deleted entry with its original dates', async () => {
    await useDiaryStore
      .getState()
      .saveFromDraft(setQuickRating(createDraft({ film, mode: 'quick' }), 4));
    const entry = useDiaryStore.getState().entries[0]!;

    await useDiaryStore.getState().remove(entry.id);
    expect(useDiaryStore.getState().entries).toHaveLength(0);

    await useDiaryStore.getState().restore(entry.id);
    const restored = useDiaryStore.getState().entries[0];
    expect(restored?.id).toBe(entry.id);
    expect(restored?.createdAt).toBe(entry.createdAt);
  });
});

describe('direct links into the flow', () => {
  it('never renders a result the data cannot support', async () => {
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/result` });

    // No draft at all: the flow starts at the chooser instead of a broken result.
    await waitFor(() =>
      expect(useNavigationStore.getState().current()).toMatchObject({ kind: 'rateMode' }),
    );
  });

  it('redirects a link to a locked step back to the first gap', async () => {
    await useRatingStore.getState().start({ film, mode: 'deep' });

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/deep/4` });

    await waitFor(() =>
      expect(useNavigationStore.getState().current()).toMatchObject({ kind: 'rateDeep', step: 0 }),
    );
  });
});
