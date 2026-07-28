import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
import { useJournalStore } from '@features/journal/model/journal.store';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { createDraft, setAspectScore } from '@domain/rating/rating.machine';
import type { FilmSnapshot } from '@domain/rating/rating.types';

const FILM_ID = 101;

const snapshot: FilmSnapshot = {
  filmId: FILM_ID,
  title: 'Тихий свет',
  releaseYear: 2023,
  posterPath: '/poster-101.jpg',
  updatedAt: '2026-07-20T10:00:00.000Z',
};

/** Seeds the film cache so the flow can start without any network. */
const seedFilm = async () => {
  // Built from the model so it satisfies the cache schema exactly.
  await writeFilmToCache({
    ...emptyFilm(FILM_ID, 'Тихий свет'),
    year: '2023',
    posterPath: '/poster-101.jpg',
    backdropPath: '/backdrop-101.jpg',
    overview: 'Описание',
    detailed: true,
  });
};

/** Drags the star control to a value using the stubbed geometry. */
const rateStars = async (value: number) => {
  const slider = await screen.findByRole('slider');
  slider.focus();
  const user = userEvent.setup();
  // Home lands on a deliberate 0, then arrows step up — no pointer geometry
  // needed, and it exercises the same commit path.
  await user.keyboard('{Home}');
  for (let step = 0; step < value; step += 1) await user.keyboard('{ArrowRight}');
  return slider;
};

beforeEach(async () => {
  await resetAppState();
  installFetchMock({ details: { [FILM_ID]: detailsFixture(FILM_ID) } });
  await seedFilm();
});

describe('Flow 1 — quick rating end to end', () => {
  it('rates, saves and shows the film in the diary', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await user.click(await screen.findByTestId('mode-quick'));

    // Nothing is preselected: Save is genuinely unavailable.
    const save = await screen.findByTestId('quick-save');
    expect(save).toBeDisabled();
    expect(await screen.findByText('Проведи по звёздам')).toBeInTheDocument();

    await rateStars(4);
    await waitFor(() => expect(screen.getByTestId('quick-save')).toBeEnabled());
    await user.click(screen.getByTestId('quick-save'));

    await user.click(await screen.findByTestId('result-save'));

    // Local-first: the entry exists in storage and on the Diary.
    await waitFor(() => expect(useJournalStore.getState().entries).toHaveLength(1));
    const [entry] = useJournalStore.getState().entries;
    expect(entry).toMatchObject({ filmId: FILM_ID, mode: 'quick', quickScore: 4, displayScore: 4 });
    // The Diary tab is open (its heading, not the bottom-bar label) and the
    // new card is on screen.
    expect(await screen.findByRole('heading', { name: 'Дневник' })).toBeInTheDocument();
    expect(await screen.findByTestId(`journal-card-${entry!.id}`)).toBeInTheDocument();

    // The finished draft is gone from both storage layers.
    expect(useRatingStore.getState().draft).toBeNull();
    expect(await db.ratingDrafts.get('active')).toBeUndefined();
  });

  it('does not create a draft when the selector is merely opened', async () => {
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await screen.findByTestId('mode-quick');

    expect(useRatingStore.getState().draft).toBeNull();
    expect(await db.ratingDrafts.get('active')).toBeUndefined();
  });
});

describe('Flow 2 — detailed rating and rounding', () => {
  it('walks five aspects and rounds the total to a half star', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await user.click(await screen.findByTestId('mode-detailed'));
    await screen.findByText('Сюжет');

    // 5, 4, 5, 4, 5 → raw 4.6 → display 4.5
    for (const value of [5, 4, 5, 4, 5]) {
      await rateStars(value);
      await user.click(await screen.findByTestId('aspect-next'));
    }

    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useJournalStore.getState().entries).toHaveLength(1));
    const [entry] = useJournalStore.getState().entries;
    expect(entry).toMatchObject({ mode: 'detailed', rawScore: 4.6, displayScore: 4.5 });
    expect(entry?.aspects).toMatchObject({ story: 5, performance: 4, aftertaste: 5 });
  });

  it('keeps a deliberate zero out of the "not rated" state', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await user.click(await screen.findByTestId('mode-detailed'));
    const slider = await screen.findByRole('slider');
    slider.focus();
    await user.keyboard('{Home}');

    await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '0'));
    expect(slider).toHaveAttribute('aria-valuetext', '0 из 5, Рассыпался');
    // A zero is progress: the draft records it and the next step unlocks.
    await waitFor(() => expect(useRatingStore.getState().draft?.aspects.story).toBe(0));
    expect(await screen.findByTestId('aspect-next')).toBeInTheDocument();
  });
});

describe('Flow 3 — a draft survives a reload', () => {
  it('resumes on the aspect it was left on, with values intact', async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp({
      telegram: createTelegramFake(),
      path: `/rate/${FILM_ID}/mode`,
    });

    await user.click(await screen.findByTestId('mode-detailed'));
    await rateStars(4);
    await user.click(await screen.findByTestId('aspect-next'));
    await screen.findByText('Герои и актёрская игра');
    await rateStars(3);
    await user.click(await screen.findByTestId('aspect-next'));
    await screen.findByText('Режиссура и визуал');

    await waitFor(() => expect(useRatingStore.getState().draft?.aspects.performance).toBe(3));
    unmount();

    // A fresh app instance, exactly like a cold start.
    useRatingStore.setState({ draft: null, hydrated: false });
    renderApp({ telegram: createTelegramFake(), path: '/' });

    await waitFor(() => expect(useRatingStore.getState().hydrated).toBe(true));
    const draft = useRatingStore.getState().draft;
    expect(draft?.aspects).toMatchObject({ story: 4, performance: 3 });
    expect(draft?.currentAspect).toBe('directionVisual');
  });

  it('shows the unfinished draft at the top of the diary', async () => {
    await useRatingStore.getState().start({ film: snapshot, mode: 'detailed' });
    renderApp({ telegram: createTelegramFake(), path: '/diary' });

    const card = await screen.findByTestId('active-draft-card');
    expect(within(card).getByText(/Ты не закончил/)).toBeInTheDocument();
    expect(within(card).getByText('0 из 5')).toBeInTheDocument();
  });
});

describe('Flow 4/5 — only one active draft', () => {
  it('offers a choice instead of silently replacing another film', async () => {
    const user = userEvent.setup();
    // A draft for a different film is already in flight.
    await useRatingStore
      .getState()
      .start({ film: { ...snapshot, filmId: 999, title: 'Другой фильм' }, mode: 'quick' });

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));

    expect(await screen.findByText(/Ты не закончил «Другой фильм»/)).toBeInTheDocument();
    // Nothing was overwritten while the question is open.
    expect(useRatingStore.getState().draft?.film.filmId).toBe(999);
  });

  it('discards the old draft only on an explicit choice, and then starts the new one', async () => {
    const user = userEvent.setup();
    await useRatingStore
      .getState()
      .start({ film: { ...snapshot, filmId: 999, title: 'Другой фильм' }, mode: 'quick' });

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));
    await user.click(await screen.findByTestId('conflict-discard'));

    // The old film is gone and the requested one is in progress: confirming a
    // destructive choice must complete the action the user asked for, not just
    // delete and leave them on an unchanged screen.
    await waitFor(() => expect(useRatingStore.getState().draft?.film.filmId).toBe(FILM_ID));
    expect(useRatingStore.getState().draft?.mode).toBe('quick');
    expect((await db.ratingDrafts.get('active'))?.film.filmId).toBe(FILM_ID);
  });
});

describe('Flow 6/7 — editing never duplicates a film', () => {
  it('updates the existing entry instead of adding a second card', async () => {
    const user = userEvent.setup();
    // An existing quick entry, as if saved earlier.
    await useJournalStore
      .getState()
      .saveFromDraft({ ...createDraft({ film: snapshot, mode: 'quick' }), quickScore: 3 });
    const original = useJournalStore.getState().entries[0]!;

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));

    await rateStars(5);
    await user.click(await screen.findByTestId('quick-save'));
    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useJournalStore.getState().entries[0]?.displayScore).toBe(5));
    expect(useJournalStore.getState().entries).toHaveLength(1);
    // Same row, same creation date — the Diary must not reorder.
    expect(useJournalStore.getState().entries[0]?.id).toBe(original.id);
    expect(useJournalStore.getState().entries[0]?.createdAt).toBe(original.createdAt);
  });

  it('turns a quick entry into a detailed one without a second entry', async () => {
    let draft = createDraft({ film: snapshot, mode: 'detailed' });
    for (const id of [
      'story',
      'performance',
      'directionVisual',
      'soundMusic',
      'aftertaste',
    ] as const) {
      draft = setAspectScore(draft, id, 4);
    }
    await useJournalStore.getState().saveFromDraft({ ...draft, previousQuickScore: 3 });

    const entries = useJournalStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ mode: 'detailed', displayScore: 4 });
    // The old quick score is history, never part of the detailed formula.
    expect(entries[0]?.quickScore).toBeNull();
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
      accent: { hex: '#435973', rgb: '67, 89, 115' },
      originalTitle: '',
      backdropPath: '',
      genres: [],
      rating: 0,
      voteCount: 0,
      overview: '',
      releaseDate: '',
    });
    expect(useWatchlistStore.getState().entries[FILM_ID]).toBeDefined();

    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });
    await user.click(await screen.findByTestId('mode-quick'));
    await rateStars(4);
    await user.click(await screen.findByTestId('quick-save'));
    await user.click(await screen.findByTestId('result-save'));

    await waitFor(() => expect(useWatchlistStore.getState().entries[FILM_ID]).toBeUndefined());
    expect(
      await screen.findByText('Оценка сохранена. Фильм убран из «Посмотреть позже»'),
    ).toBeInTheDocument();
    // The rating itself survives regardless.
    expect(useJournalStore.getState().entries).toHaveLength(1);
  });
});

describe('Flow 8 — delete and undo', () => {
  it('restores a deleted entry to its original place', async () => {
    await useJournalStore
      .getState()
      .saveFromDraft({ ...createDraft({ film: snapshot, mode: 'quick' }), quickScore: 3 });
    const entry = useJournalStore.getState().entries[0]!;

    await useJournalStore.getState().remove(entry.id);
    expect(useJournalStore.getState().entries).toHaveLength(0);

    await useJournalStore.getState().restore(entry.id);
    const restored = useJournalStore.getState().entries[0];
    expect(restored?.id).toBe(entry.id);
    // Undo is a restore, not a re-insert: the creation date is untouched.
    expect(restored?.createdAt).toBe(entry.createdAt);
  });
});

describe('leaving the flow after a save', () => {
  it('lands on the Diary, not back on the feed', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/mode` });

    await user.click(await screen.findByTestId('mode-quick'));
    await rateStars(4);
    await user.click(await screen.findByTestId('quick-save'));
    await user.click(await screen.findByTestId('result-save'));

    // Unwinding the pushed history entries must not restore the old route:
    // the popstate that follows would otherwise put the user back on the feed.
    await waitFor(() => expect(useNavigationStore.getState().activeTab).toBe('diary'));
    expect(useNavigationStore.getState().stack).toHaveLength(1);
    expect(await screen.findByRole('heading', { name: 'Дневник' })).toBeInTheDocument();
  });
});

describe('direct links into the flow', () => {
  it('never renders a result the data cannot support', async () => {
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/result` });

    // With no draft at all the flow starts at the mode selector.
    expect(await screen.findByTestId('mode-detailed')).toBeInTheDocument();
    expect(screen.queryByTestId('result-save')).not.toBeInTheDocument();
  });

  it('redirects a link to a locked aspect back to the first gap', async () => {
    await useRatingStore.getState().start({ film: snapshot, mode: 'detailed' });
    renderApp({ telegram: createTelegramFake(), path: `/rate/${FILM_ID}/aspects/aftertaste` });

    // "Что осталось" is unreachable until the earlier aspects are rated.
    expect(await screen.findByText('Сюжет')).toBeInTheDocument();
  });
});
