import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
  createTelegramFake,
  installFetchMock,
  renderApp,
  resetAppState,
  trendingFixture,
} from './harness';
import { db } from '@shared/storage/db';
import { mapMovieList } from '@shared/api/tmdb/tmdb.mappers';
import { FEED_CACHE_KEY } from '@entities/feed/feed.model';

describe('startup', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('paints cached feed data before the network answers', async () => {
    await db.feed.put({
      key: FEED_CACHE_KEY,
      items: mapMovieList([{ ...trendingFixture.results[0], id: 900, title: 'Из кэша' }]),
      cachedAt: Date.now(),
    });

    // The network never resolves during this test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const telegram = createTelegramFake();
    renderApp({ telegram });

    expect(await screen.findByText('Из кэша')).toBeInTheDocument();
  });

  it('replaces cached items with fresh ones without clearing the screen', async () => {
    await db.feed.put({
      key: FEED_CACHE_KEY,
      items: mapMovieList([{ ...trendingFixture.results[0], id: 900, title: 'Из кэша' }]),
      cachedAt: Date.now() - 60_000,
    });
    installFetchMock();

    renderApp({ telegram: createTelegramFake() });

    expect(await screen.findByText('Из кэша')).toBeInTheDocument();
    expect(await screen.findByText('Тихий свет')).toBeInTheDocument();
    // A refresh must not blank the feed: something is on screen the whole time.
    expect(screen.getByLabelText('Основная навигация')).toBeInTheDocument();
  });

  it('calls ready() and expand() but does not request fullscreen on startup', async () => {
    installFetchMock();
    const telegram = createTelegramFake();
    renderApp({ telegram });

    await screen.findByText('Тихий свет');

    expect(telegram.calls).toContain('ready');
    expect(telegram.calls).toContain('expand');
    expect(telegram.calls).not.toContain('requestFullscreen');
  });

  it('writes normalized Telegram insets as CSS variables', async () => {
    installFetchMock();
    renderApp({ telegram: createTelegramFake() });

    await waitFor(() => {
      // 59 device inset + 46 Telegram content inset, counted exactly once.
      expect(document.documentElement.style.getPropertyValue('--content-safe-top')).toBe('105px');
    });
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('34px');
  });

  it('renders the feed in a plain browser too', async () => {
    installFetchMock();
    renderApp({ telegram: null });

    expect(await screen.findByText('Тихий свет')).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--safe-top')).toBe(
      'env(safe-area-inset-top, 0px)',
    );
  });

  it('shows a calm retry block when there is no data at all', async () => {
    installFetchMock({ offline: true });
    const telegram = createTelegramFake();
    renderApp({ telegram });

    // Two retries with backoff happen first — the screen stays quiet until then.
    expect(
      await screen.findByText('Не получилось загрузить ленту.', undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeInTheDocument();
    // A screen-level failure is the one error worth feeling (spec §21).
    expect(telegram.calls).toContain('haptic.notification.error');
  }, 15000);
});
