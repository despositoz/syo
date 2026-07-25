import type { Route, RootTab } from './navigation/navigationTypes';

export const ROOT_TABS: readonly RootTab[] = ['feed', 'diary', 'profile'] as const;

export const TAB_LABELS: Record<RootTab, string> = {
  feed: 'Лента',
  diary: 'Дневник',
  profile: 'Профиль',
};

export const RATE_LABEL = 'Оценить';

const isRootTab = (value: string): value is RootTab =>
  (ROOT_TABS as readonly string[]).includes(value);

/**
 * Deploy base without a trailing slash: '' at the domain root, '/syo' when the
 * app is published under a subdirectory (GitHub Pages). Every URL we write
 * carries it and every URL we read has it stripped, so hosting under a
 * subpath never leaks a link outside the app.
 */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

const relativePath = (route: Route): string => {
  switch (route.kind) {
    case 'root':
      return route.tab === 'feed' ? '/' : `/${route.tab}`;
    case 'picker':
      return '/rate';
    case 'film':
      return `/film/${route.filmId}`;
  }
};

/** Route → URL path. The browser fallback gets real, shareable URLs. */
export const routeToPath = (route: Route): string => `${BASE}${relativePath(route)}`;

/** URL path → route stack. Unknown paths fall back to the feed. */
export const pathToStack = (pathname: string): Route[] => {
  const withoutBase =
    BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const segments = withoutBase.split('/').filter(Boolean);
  const [first, second] = segments;

  if (!first) return [{ kind: 'root', tab: 'feed' }];
  if (isRootTab(first)) return [{ kind: 'root', tab: first }];
  if (first === 'rate') return [{ kind: 'root', tab: 'feed' }, { kind: 'picker' }];
  if (first === 'film') {
    const filmId = Number(second);
    if (Number.isFinite(filmId) && filmId > 0) {
      return [
        { kind: 'root', tab: 'feed' },
        { kind: 'film', filmId },
      ];
    }
  }
  return [{ kind: 'root', tab: 'feed' }];
};
