import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTelegramFake,
  detailsFixture,
  installFetchMock,
  installIntersectionObserver,
  renderApp,
  resetAppState,
} from './harness';
import { db } from '@shared/storage/db';
import { emptyFilm } from '@entities/film/film.model';

const openFirstFilm = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText('Тихий свет');
  await user.click(screen.getByText('Тихий свет'));
  await screen.findByTestId('film-title');
};

describe('film page', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens from the feed and shows details, director and cast', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);

    expect(await screen.findByText('Полное описание фильма.')).toBeInTheDocument();
    expect(await screen.findByText('Режиссёр Тестов')).toBeInTheDocument();
    expect(await screen.findByText('Актриса')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Начать оценку/ })).toBeInTheDocument();
  });

  it('hides the bottom bar on the film page and restores it after back', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);
    expect(screen.getByLabelText('Основная навигация')).toHaveAttribute('aria-hidden', 'true');

    await user.click(screen.getByTestId('app-back-button'));

    await waitFor(() =>
      expect(screen.getByLabelText('Основная навигация')).not.toHaveAttribute('aria-hidden'),
    );
  });

  it('commits to a text title when there is no logo and never swaps it later', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);
    const title = await screen.findByTestId('film-title');
    expect(title).toHaveTextContent('Тихий свет');

    // Give the preflight budget and any late image event a chance to fire.
    // Wrapped in act(): the preflight resolving is a real state update.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(screen.getByTestId('film-title')).toHaveTextContent('Тихий свет');
    expect(document.querySelector('img[data-tone]')).toBeNull();
  }, 15000);

  it('keeps the accessible title in the DOM in every mode', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);

    expect(screen.getByRole('heading', { level: 1, name: 'Тихий свет' })).toBeInTheDocument();
  });

  it('toggles the watchlist from the hero button and confirms with a snackbar', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);
    const hero = screen.getByTestId('watchlist-hero');
    expect(hero).toHaveAttribute('aria-pressed', 'false');

    await user.click(hero);

    await waitFor(() => expect(hero).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByText(/Добавлено в «Посмотреть позже»/)).toBeInTheDocument();
    await waitFor(async () => expect(await db.watchlist.get(101)).toBeTruthy());

    await user.click(hero);
    await waitFor(() => expect(hero).toHaveAttribute('aria-pressed', 'false'));
    expect(await screen.findByText('Убрано из списка')).toBeInTheDocument();
  });

  it('never shows both watchlist projections at once', async () => {
    installFetchMock();
    const observer = installIntersectionObserver();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);

    // Hero button visible → toolbar bookmark absent.
    act(() => observer.setVisible(true));
    expect(screen.getByTestId('watchlist-hero')).toBeInTheDocument();
    expect(screen.queryByTestId('watchlist-toolbar')).not.toBeInTheDocument();

    // Hero button scrolled away → toolbar bookmark takes over.
    act(() => observer.setVisible(false));
    expect(await screen.findByTestId('watchlist-toolbar')).toBeInTheDocument();
  });

  it('shares one state between both projections', async () => {
    installFetchMock();
    const observer = installIntersectionObserver();
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);

    await user.click(screen.getByTestId('watchlist-hero'));
    await waitFor(() =>
      expect(screen.getByTestId('watchlist-hero')).toHaveAttribute('aria-pressed', 'true'),
    );

    act(() => observer.setVisible(false));
    const toolbar = await screen.findByTestId('watchlist-toolbar');
    expect(toolbar).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires no haptic on back, one on open', async () => {
    installFetchMock();
    const telegram = createTelegramFake({ isFullscreen: true });
    const user = userEvent.setup();
    renderApp({ telegram });

    await openFirstFilm(user);
    const afterOpen = telegram.calls.filter((call) => call.startsWith('haptic')).length;
    expect(afterOpen).toBeGreaterThan(0);

    await user.click(screen.getByTestId('app-back-button'));
    await waitFor(() => expect(screen.queryByTestId('film-title')).not.toBeInTheDocument());

    expect(telegram.calls.filter((call) => call.startsWith('haptic'))).toHaveLength(afterOpen);
  });

  it('renders a cached film offline without a full-screen error', async () => {
    await db.films.put({
      id: 555,
      film: {
        ...emptyFilm(555, 'Офлайн фильм'),
        year: '2019',
        overview: 'Описание из локального кэша.',
        director: 'Кэш Режиссёров',
        detailed: true,
      },
      cachedAt: Date.now(),
    });
    installFetchMock({ offline: true });

    renderApp({ telegram: createTelegramFake({ isFullscreen: true }), path: '/film/555' });

    // The element mounts empty and fills from IndexedDB — assert the content,
    // not just its presence.
    await waitFor(() => expect(screen.getByTestId('film-title')).toHaveTextContent('Офлайн фильм'));
    expect(await screen.findByText('Описание из локального кэша.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets the watchlist work offline', async () => {
    await db.films.put({
      id: 555,
      film: { ...emptyFilm(555, 'Офлайн фильм'), detailed: true },
      cachedAt: Date.now(),
    });
    installFetchMock({ offline: true });
    const user = userEvent.setup();

    renderApp({ telegram: createTelegramFake({ isFullscreen: true }), path: '/film/555' });
    await screen.findByTestId('film-title');

    await user.click(screen.getByTestId('watchlist-hero'));

    await waitFor(async () => expect(await db.watchlist.get(555)).toBeTruthy());
    // The write is queued for a later sync and never rolled back.
    expect((await db.syncQueue.toArray()).map((row) => row.task.type)).toContain('watchlistAdd');
  });

  it('keeps a block failure from replacing the screen', async () => {
    installFetchMock({
      details: {
        101: detailsFixture(101, { credits: { cast: [], crew: [] }, backdrop_path: null }),
      },
    });
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });

    await openFirstFilm(user);

    // Cast block simply disappears; the page still renders.
    expect(screen.queryByText('В ролях')).not.toBeInTheDocument();
    expect(await screen.findByText('Полное описание фильма.')).toBeInTheDocument();
  });
});
