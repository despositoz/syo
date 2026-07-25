import type { Page, Route } from '@playwright/test';
import { BACKDROP, BLACK_LOGO, POSTER, WHITE_LOGO } from './png';

export interface TmdbMockOptions {
  title?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  /** 'none' | 'white' | 'black' */
  logo?: 'none' | 'white' | 'black';
  /** Extra delay before the logo image responds, in ms. */
  logoDelayMs?: number;
}

const summary = (id: number, options: TmdbMockOptions) => ({
  id,
  title: options.title ?? `Фильм ${id}`,
  original_title: `Movie ${id}`,
  original_language: 'en',
  release_date: '2023-05-01',
  overview: 'Описание фильма для теста.',
  poster_path: options.posterPath === null ? null : (options.posterPath ?? '/poster.png'),
  backdrop_path: options.backdropPath === null ? null : (options.backdropPath ?? '/backdrop.png'),
  vote_average: 7.8,
  vote_count: 1200,
  adult: false,
  genre_ids: [18],
});

const details = (id: number, options: TmdbMockOptions) => ({
  ...summary(id, options),
  runtime: 128,
  tagline: '',
  budget: 0,
  revenue: 0,
  genres: [{ id: 18, name: 'Драма' }],
  production_countries: [{ iso_3166_1: 'US', name: 'США' }],
  production_companies: [{ id: 1, name: 'Studio' }],
  overview:
    'Описание фильма для теста. ' +
    'Длинный текст нужен, чтобы страница действительно прокручивалась и проекции watchlist можно было проверить. '.repeat(
      14,
    ),
  credits: {
    // Enough cast for the page to scroll past the hero watchlist button.
    cast: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      name: `Актриса Тест ${index + 1}`,
      character: 'Она',
      profile_path: '/profile.png',
      order: index,
    })),
    crew: [{ id: 2, name: 'Режиссёр Тест', job: 'Director', department: 'Directing' }],
  },
  images:
    options.logo && options.logo !== 'none'
      ? {
          logos: [
            {
              file_path: '/logo.png',
              iso_639_1: 'ru',
              width: 240,
              height: 80,
              aspect_ratio: 3,
              vote_average: 6,
              vote_count: 10,
            },
          ],
        }
      : { logos: [] },
});

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

/** Serves the whole TMDB surface the app touches, including real image bytes. */
export const mockTmdb = async (page: Page, options: TmdbMockOptions = {}): Promise<void> => {
  await page.route('**://api.themoviedb.org/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/trending/movie/day') || url.includes('/movie/popular')) {
      return json(route, {
        page: 1,
        total_pages: 1,
        total_results: 3,
        results: [summary(101, options), summary(102, {}), summary(103, {})],
      });
    }

    if (url.includes('/search/movie')) {
      return json(route, {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [summary(201, { ...options, title: options.title ?? 'Найденный фильм' })],
      });
    }

    const match = /\/movie\/(\d+)/.exec(url);
    if (match) {
      const id = Number(match[1]);
      return json(route, details(id, id === 101 || id === 201 ? options : {}));
    }

    return json(route, {});
  });

  await page.route('**://image.tmdb.org/**', async (route) => {
    const url = route.request().url();
    const png = url.includes('logo')
      ? options.logo === 'black'
        ? BLACK_LOGO
        : WHITE_LOGO
      : url.includes('poster') || url.includes('profile')
        ? POSTER
        : BACKDROP;

    if (url.includes('logo') && options.logoDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.logoDelayMs));
    }

    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: png,
    });
  });
};

export interface TelegramMockOptions {
  fullscreen?: boolean;
  /** Device safe-area inset (status bar / home indicator). */
  safeAreaTop?: number;
  safeAreaBottom?: number;
  /** Telegram's own inset for its floating controls, relative to safe area. */
  contentSafeAreaTop?: number;
  version?: string;
}

/**
 * Installs a Telegram WebApp stub before any app code runs, so the app boots
 * exactly as it would inside a Telegram WebView.
 */
export const mockTelegram = async (
  page: Page,
  options: TelegramMockOptions = {},
): Promise<void> => {
  // index.html loads the real telegram-web-app.js, which would overwrite this
  // stub with its own browser fallback (empty initData, platform "unknown").
  await page.route('**/telegram-web-app.js*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );

  await page.addInitScript((config) => {
    const listeners = new Map<string, Array<() => void>>();
    const calls: string[] = [];

    const webApp = {
      initData: 'user=1&auth_date=1',
      version: config.version ?? '8.0',
      platform: 'ios',
      colorScheme: 'dark',
      isExpanded: true,
      isFullscreen: Boolean(config.fullscreen),
      viewportHeight: window.innerHeight,
      viewportStableHeight: window.innerHeight,
      safeAreaInset: {
        top: config.safeAreaTop ?? 59,
        right: 0,
        bottom: config.safeAreaBottom ?? 34,
        left: 0,
      },
      contentSafeAreaInset: {
        top: config.fullscreen ? (config.contentSafeAreaTop ?? 46) : 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      ready: () => calls.push('ready'),
      expand: () => calls.push('expand'),
      requestFullscreen: () => {
        calls.push('requestFullscreen');
        webApp.isFullscreen = true;
        (listeners.get('fullscreenChanged') ?? []).forEach((handler) => handler());
      },
      exitFullscreen: () => {
        webApp.isFullscreen = false;
      },
      isVersionAtLeast: () => true,
      setHeaderColor: () => {},
      setBackgroundColor: () => {},
      setBottomBarColor: () => {},
      disableVerticalSwipes: () => {},
      onEvent: (event: string, handler: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      },
      offEvent: (event: string, handler: () => void) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== handler),
        );
      },
      BackButton: {
        isVisible: false,
        show: () => {
          webApp.BackButton.isVisible = true;
          calls.push('back.show');
        },
        hide: () => {
          webApp.BackButton.isVisible = false;
          calls.push('back.hide');
        },
        onClick: (handler: () => void) => {
          (window as never as Record<string, unknown>).__syoBackPress = handler;
        },
        offClick: () => {
          delete (window as never as Record<string, unknown>).__syoBackPress;
        },
      },
      HapticFeedback: {
        impactOccurred: (style: string) => calls.push(`haptic.impact.${style}`),
        notificationOccurred: (type: string) => calls.push(`haptic.notification.${type}`),
        selectionChanged: () => calls.push('haptic.selection'),
      },
    };

    (window as never as Record<string, unknown>).Telegram = { WebApp: webApp };
    (window as never as Record<string, unknown>).__syoTelegramCalls = calls;
  }, options);
};

export const telegramCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as never as Record<string, string[]>).__syoTelegramCalls ?? []);

export const pressTelegramBack = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const handler = (window as never as Record<string, () => void>).__syoBackPress;
    if (handler) handler();
  });

export const isTelegramBackVisible = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      (window as never as { Telegram?: { WebApp?: { BackButton?: { isVisible: boolean } } } })
        .Telegram?.WebApp?.BackButton?.isVisible ?? false,
  );

export const cssVar = (page: Page, name: string): Promise<string> =>
  page.evaluate(
    (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(),
    name,
  );
