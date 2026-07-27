import type { RatingAspectId } from '@domain/rating/rating.types';

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
  | { kind: 'rateAspect'; filmId: number; aspectId: RatingAspectId }
  | { kind: 'rateResult'; filmId: number };

export type Route =
  | { kind: 'root'; tab: RootTab }
  | { kind: 'picker' }
  | ({ kind: 'film' } & FilmRouteParams)
  | RatingRoute
  | { kind: 'journalEntry'; entryId: string };

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
  route.kind === 'rateAspect' ||
  route.kind === 'rateResult';

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
    case 'rateAspect':
      // Aspects share one key: moving between them is an internal transition,
      // not a page change, so the panel is not remounted.
      return `rate:${route.filmId}:aspect`;
    case 'rateResult':
      return `rate:${route.filmId}:result`;
    case 'journalEntry':
      return `journal:${route.entryId}`;
  }
};
