import type { TmdbRequestOptions } from './tmdb.client';

/** Endpoint descriptors — one place to look for "what do we ask TMDB for". */
export const tmdbEndpoints = {
  trending: (): { path: string; options: TmdbRequestOptions } => ({
    path: '/trending/movie/day',
    options: { query: { page: 1 } },
  }),

  popular: (): { path: string; options: TmdbRequestOptions } => ({
    path: '/movie/popular',
    options: { query: { page: 1 } },
  }),

  search: (query: string): { path: string; options: TmdbRequestOptions } => ({
    path: '/search/movie',
    options: { query: { query, include_adult: false, page: 1 } },
  }),

  /**
   * Details, credits and logos in one round trip: the presentation preflight
   * must not wait on three sequential requests.
   */
  details: (filmId: number): { path: string; options: TmdbRequestOptions } => ({
    path: `/movie/${filmId}`,
    options: {
      query: {
        append_to_response: 'credits,images',
        include_image_language: 'ru,en,null',
      },
    },
  }),

  genres: (): { path: string; options: TmdbRequestOptions } => ({
    path: '/genre/movie/list',
    options: {},
  }),
} as const;
