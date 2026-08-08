import type { WritingScreen } from '@domain/writing/writing.types';

export type RootTab = 'feed' | 'diary' | 'profile';

export interface FilmRouteParams {
  filmId: number;
  /** Known title, so the page can render its heading before data arrives. */
  title?: string;
}

/**
 * The rating flow is a nested full-screen scenario: every one of these routes
 * hides the bottom bar and owns its own safe header (spec §5.1).
 */
export type RatingRoute =
  | { kind: 'rateMode'; filmId: number }
  | { kind: 'rateQuick'; filmId: number }
  | { kind: 'rateDeep'; filmId: number; step: number }
  | { kind: 'rateResult'; filmId: number };

/**
 * Writing is a nested full-screen scenario like rating: one route kind with the
 * screen inside it, so moving between mode → editor → preview is an internal
 * transition rather than a page change.
 */
export interface WritingRoute {
  kind: 'write';
  entryId: string;
  screen: WritingScreen;
}

/** Profile is a root tab; these are the screens inside and beside it. */
export type ProfileRoute =
  | { kind: 'tasteSignature' }
  | { kind: 'settings'; section: 'root' | 'appearance' | 'data' | 'about' };

export type Route =
  | { kind: 'root'; tab: RootTab }
  | { kind: 'picker'; mode?: 'rate' | 'selectFavorite' }
  | ({ kind: 'film' } & FilmRouteParams)
  | RatingRoute
  | WritingRoute
  | ProfileRoute
  | { kind: 'diaryEntry'; entryId: string };

export type RouteKind = Route['kind'];

/** How the top-most page entered — drives the temporary back transition only. */
export type TransitionPhase = 'idle' | 'entering' | 'leaving';

export interface NavigationState {
  /** stack[0] is always a root route. */
  stack: Route[];
  activeTab: RootTab;
  phase: TransitionPhase;
  /** The route currently animating out, kept mounted until the transition ends. */
  leaving: Route | null;
}

export const isRootRoute = (route: Route): route is { kind: 'root'; tab: RootTab } =>
  route.kind === 'root';

export const isRatingRoute = (route: Route): route is RatingRoute =>
  route.kind === 'rateMode' ||
  route.kind === 'rateQuick' ||
  route.kind === 'rateDeep' ||
  route.kind === 'rateResult';

export const isWritingRoute = (route: Route): route is WritingRoute => route.kind === 'write';

export const routeKey = (route: Route): string => {
  switch (route.kind) {
    case 'root':
      return `root:${route.tab}`;
    case 'picker':
      return 'picker';
    case 'film':
      return `film:${route.filmId}`;
    case 'rateMode':
      return `rate:${route.filmId}:mode`;
    case 'rateQuick':
      return `rate:${route.filmId}:quick`;
    case 'rateDeep':
      // The five steps share one key: moving between them is an internal
      // transition, not a page change, so the panel is not remounted.
      return `rate:${route.filmId}:deep`;
    case 'rateResult':
      return `rate:${route.filmId}:result`;
    case 'write':
      // All writing screens share one key, so switching screens keeps the
      // editor mounted and the typed text on screen.
      return `write:${route.entryId}`;
    case 'tasteSignature':
      return 'profile:signature';
    case 'settings':
      return `settings:${route.section}`;
    case 'diaryEntry':
      return `diary:${route.entryId}`;
  }
};
