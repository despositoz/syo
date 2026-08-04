import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '@app/App';
import { setTelegramController } from '@app/telegram/telegramStore';
import { useNavigationStore } from '@app/navigation/navigationStore';
import { pathToStack } from '@app/routes';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { useThemeStore } from '@app/theme/themeStore';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { clearFilmMemoryCache } from '@entities/film/film.cache';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useWritingStore } from '@features/writing/model/writing.store';
import { resetFeedStore } from '@features/feed/model/feed.store';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { db } from '@shared/storage/db';
import type { TelegramWebApp } from '@app/telegram/telegramTypes';

/* --- TMDB fixtures ----------------------------------------------------- */

export const trendingFixture = {
  page: 1,
  total_pages: 1,
  total_results: 2,
  results: [
    {
      id: 101,
      title: 'Тихий свет',
      original_title: 'Silent Light',
      original_language: 'en',
      release_date: '2023-05-01',
      overview: 'Описание из ленты.',
      poster_path: '/poster-101.jpg',
      backdrop_path: '/backdrop-101.jpg',
      vote_average: 7.8,
      vote_count: 1200,
      adult: false,
      genre_ids: [18],
    },
    {
      id: 102,
      title: 'Второй фильм',
      original_title: 'Second Film',
      original_language: 'en',
      release_date: '2022-03-11',
      overview: 'Ещё одно описание.',
      poster_path: '/poster-102.jpg',
      backdrop_path: '',
      vote_average: 6.4,
      vote_count: 300,
      adult: false,
      genre_ids: [878],
    },
  ],
};

export const searchFixture = {
  page: 1,
  total_pages: 1,
  total_results: 1,
  results: [
    {
      id: 201,
      title: 'Найденный фильм',
      original_title: 'Found Movie',
      original_language: 'en',
      release_date: '2021-09-09',
      overview: 'Результат поиска.',
      poster_path: '/poster-201.jpg',
      backdrop_path: '/backdrop-201.jpg',
      vote_average: 8.2,
      vote_count: 900,
      adult: false,
      genre_ids: [53],
    },
  ],
};

export const detailsFixture = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: 'Тихий свет',
  original_title: 'Silent Light',
  original_language: 'en',
  release_date: '2023-05-01',
  overview: 'Полное описание фильма.',
  poster_path: '/poster-101.jpg',
  backdrop_path: '/backdrop-101.jpg',
  vote_average: 7.8,
  vote_count: 1200,
  adult: false,
  runtime: 128,
  tagline: '',
  budget: 0,
  revenue: 0,
  genres: [{ id: 18, name: 'Драма' }],
  production_countries: [{ iso_3166_1: 'US', name: 'США' }],
  production_companies: [{ id: 5, name: 'Studio' }],
  credits: {
    cast: [{ id: 1, name: 'Актриса', character: 'Она', profile_path: '/a.jpg', order: 0 }],
    crew: [{ id: 2, name: 'Режиссёр Тестов', job: 'Director', department: 'Directing' }],
  },
  images: { logos: [] },
  ...overrides,
});

/* --- fetch mock -------------------------------------------------------- */

export interface FetchMockOptions {
  /** Every request rejects, as if the device were offline. */
  offline?: boolean;
  details?: Record<number, unknown>;
}

export const installFetchMock = (options: FetchMockOptions = {}) => {
  const calls: string[] = [];

  const json = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);

  const impl = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (options.offline) return Promise.reject(new TypeError('Failed to fetch'));

    if (url.includes('/trending/movie/day')) return json(trendingFixture);
    if (url.includes('/movie/popular')) return json(trendingFixture);
    if (url.includes('/search/movie')) return json(searchFixture);

    const detailsMatch = /\/movie\/(\d+)/.exec(url);
    if (detailsMatch) {
      const id = Number(detailsMatch[1]);
      return json(options.details?.[id] ?? detailsFixture(id));
    }

    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
  });

  vi.stubGlobal('fetch', impl);
  return { calls, impl };
};

/* --- Telegram fake ----------------------------------------------------- */

export interface TelegramFake {
  webApp: TelegramWebApp;
  calls: string[];
  emit: (event: string) => void;
  backPress: () => void;
}

export const createTelegramFake = (
  overrides: Partial<TelegramWebApp> = {},
  { inTelegram = true }: { inTelegram?: boolean } = {},
): TelegramFake => {
  const calls: string[] = [];
  const handlers = new Map<string, () => void>();
  let backHandler: (() => void) | null = null;

  const webApp: TelegramWebApp = {
    initData: inTelegram ? 'user=1' : undefined,
    version: '8.0',
    platform: 'ios',
    colorScheme: 'dark',
    isExpanded: true,
    isFullscreen: false,
    viewportHeight: 812,
    viewportStableHeight: 812,
    safeAreaInset: { top: 59, right: 0, bottom: 34, left: 0 },
    contentSafeAreaInset: { top: 46, right: 0, bottom: 0, left: 0 },
    ready: () => calls.push('ready'),
    expand: () => calls.push('expand'),
    requestFullscreen: () => calls.push('requestFullscreen'),
    isVersionAtLeast: () => true,
    setHeaderColor: () => {},
    setBackgroundColor: () => {},
    setBottomBarColor: () => {},
    disableVerticalSwipes: () => {},
    onEvent: (event, handler) => handlers.set(event, handler),
    offEvent: (event) => handlers.delete(event),
    BackButton: {
      isVisible: false,
      show: () => calls.push('back.show'),
      hide: () => calls.push('back.hide'),
      onClick: (handler) => {
        backHandler = handler;
      },
      offClick: () => {
        backHandler = null;
      },
    },
    HapticFeedback: {
      impactOccurred: (style) => calls.push(`haptic.impact.${style}`),
      notificationOccurred: (type) => calls.push(`haptic.notification.${type}`),
      selectionChanged: () => calls.push('haptic.selection'),
    },
    ...overrides,
  };

  return {
    webApp,
    calls,
    emit: (event) => handlers.get(event)?.(),
    backPress: () => backHandler?.(),
  };
};

/* --- app harness ------------------------------------------------------- */

export interface RenderAppOptions {
  telegram?: TelegramFake | null;
  path?: string;
}

export const resetAppState = async (): Promise<void> => {
  setTelegramController(null);
  useNavigationStore.setState({
    stack: [{ kind: 'root', tab: 'feed' }],
    activeTab: 'feed',
    phase: 'idle',
    leaving: null,
  });
  useWatchlistStore.setState({ entries: {}, hydrated: false });
  useRatingStore.setState({ draft: null, hydrated: false, storageError: null });
  useWritingStore.setState({ draft: null, hydrated: false, storageError: null, dirty: false });
  // The feed keeps a snapshot in module state; a stale one would make the next
  // test believe it is already hydrated and skip its own fetch.
  resetFeedStore();
  useDiaryStore.setState({ entries: [], hydrated: false, view: 'grid', highlightedId: null });
  useThemeStore.setState({ preference: 'cinema', colorScheme: 'dark', resolved: 'cinema' });
  useSnackbarStore.setState({ current: null });
  clearFilmMemoryCache();
  await db.films.clear();
  await db.feed.clear();
  await db.presentations.clear();
  await db.watchlist.clear();
  await db.preferences.clear();
  await db.syncQueue.clear();
  await db.ratingDrafts.clear();
  await db.diaryEntries.clear();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
};

export const renderApp = (options: RenderAppOptions = {}) => {
  if (options.path) {
    window.history.replaceState({}, '', options.path);
    // In production the store reads location at module init; tests re-apply it
    // because the module was already loaded by an earlier case.
    useNavigationStore.getState().replaceStack(pathToStack(options.path));
    useNavigationStore.setState({ phase: 'idle', leaving: null });
  }
  window.Telegram = options.telegram ? { WebApp: options.telegram.webApp } : undefined;
  return render(<App />);
};

/** Controllable IntersectionObserver so visibility can be driven from a test. */
export const installIntersectionObserver = () => {
  const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = [];

  class ControlledObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    private entry: { callback: IntersectionObserverCallback; targets: Element[] };

    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback, targets: [] };
      observers.push(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      this.entry.targets = [];
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal('IntersectionObserver', ControlledObserver);

  return {
    /** Reports every observed target as visible / hidden. */
    setVisible: (isIntersecting: boolean) => {
      observers.forEach((observer) => {
        observer.targets.forEach((target) => {
          observer.callback(
            [{ isIntersecting, target } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
      });
    },
  };
};
