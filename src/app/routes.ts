import { DEEP_STEP_COUNT } from '@domain/rating/rating.constants';
import type { WritingScreen } from '@domain/writing/writing.types';
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
    case 'rateMode':
      return `/rate/${route.filmId}/mode`;
    case 'rateQuick':
      return `/rate/${route.filmId}/quick`;
    case 'rateDeep':
      return `/rate/${route.filmId}/deep/${route.step + 1}`;
    case 'rateResult':
      return `/rate/${route.filmId}/result`;
    case 'write':
      return `/write/${route.entryId}/${route.screen}`;
    case 'tasteSignature':
      return '/profile/signature';
    case 'settings':
      return route.section === 'root' ? '/settings' : `/settings/${route.section}`;
    case 'diaryEntry':
      return `/diary/${route.entryId}`;
  }
};

/** Route → URL path. The browser fallback gets real, shareable URLs. */
export const routeToPath = (route: Route): string => `${BASE}${relativePath(route)}`;

const feedRoot: Route = { kind: 'root', tab: 'feed' };
const diaryRoot: Route = { kind: 'root', tab: 'diary' };

/**
 * The rating flow always sits on top of the film page, so back from the mode
 * selector lands on the film rather than on an empty root.
 */
const ratingStack = (filmId: number, screen: Route): Route[] => [
  feedRoot,
  { kind: 'film', filmId },
  screen,
];

/** URL path → route stack. Unknown paths fall back to the feed. */
export const pathToStack = (pathname: string): Route[] => {
  const withoutBase = BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const segments = withoutBase.split('/').filter(Boolean);
  const [first, second, third, fourth] = segments;

  if (!first) return [feedRoot];

  // Checked before the root-tab match: 'diary' is both a tab and the prefix of
  // an entry link, and the two-segment form must win.
  if (first === 'diary' && second) {
    return [diaryRoot, { kind: 'diaryEntry', entryId: second }];
  }

  if (isRootTab(first)) return [{ kind: 'root', tab: first }];

  if (first === 'rate') {
    // Bare /rate is the movie picker; /rate/:filmId/... is the rating flow.
    if (!second) return [feedRoot, { kind: 'picker' }];

    const filmId = Number(second);
    if (!Number.isFinite(filmId) || filmId <= 0) return [feedRoot];

    if (third === 'quick') return ratingStack(filmId, { kind: 'rateQuick', filmId });
    if (third === 'result') return ratingStack(filmId, { kind: 'rateResult', filmId });
    if (third === 'deep' && fourth) {
      // The URL is 1-based; the domain is 0-based.
      const step = Number(fourth) - 1;
      if (Number.isInteger(step) && step >= 0 && step < DEEP_STEP_COUNT) {
        return ratingStack(filmId, { kind: 'rateDeep', filmId, step });
      }
    }
    return ratingStack(filmId, { kind: 'rateMode', filmId });
  }

  if (first === 'profile' && second === 'signature') {
    return [{ kind: 'root', tab: 'profile' }, { kind: 'tasteSignature' }];
  }

  if (first === 'settings') {
    const section =
      second === 'appearance' || second === 'data' || second === 'about' ? second : 'root';
    return [
      { kind: 'root', tab: 'profile' },
      { kind: 'settings', section },
    ];
  }

  if (first === 'write' && second) {
    // 'processing' exists only while a request is in the air, so a URL never
    // resumes into it: the request it belonged to is long gone.
    const screen: WritingScreen =
      third === 'editor' || third === 'conversation' || third === 'aiResult' || third === 'preview'
        ? third
        : 'mode';
    return [
      diaryRoot,
      { kind: 'diaryEntry', entryId: second },
      { kind: 'write', entryId: second, screen },
    ];
  }

  if (first === 'film') {
    const filmId = Number(second);
    if (Number.isFinite(filmId) && filmId > 0) {
      return [feedRoot, { kind: 'film', filmId }];
    }
  }

  return [feedRoot];
};
