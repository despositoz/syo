export type RootTab = 'feed' | 'diary' | 'profile';

export interface FilmRouteParams {
  filmId: number;
  /** Known title, so the page can render its heading before data arrives. */
  title?: string;
}

export type Route =
  { kind: 'root'; tab: RootTab } | { kind: 'picker' } | ({ kind: 'film' } & FilmRouteParams);

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

export const routeKey = (route: Route): string => {
  switch (route.kind) {
    case 'root':
      return `root:${route.tab}`;
    case 'picker':
      return 'picker';
    case 'film':
      return `film:${route.filmId}`;
  }
};
