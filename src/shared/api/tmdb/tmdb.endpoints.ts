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

  /**
   * Candidates for the personal feed (P0.4 §13.2). Components never call
   * TMDB — these descriptors are the only place a feed request is spelled out.
   */
  recommendations: (filmId: number): { path: string; options: TmdbRequestOptions } => ({
    path: `/movie/${filmId}/recommendations`,
    options: { query: { page: 1 } },
  }),

  similar: (filmId: number): { path: string; options: TmdbRequestOptions } => ({
    path: `/movie/${filmId}/similar`,
    options: { query: { page: 1 } },
  }),

  /** Genre discovery, ordered by popularity with a quality floor. */
  discover: (options: {
    genreIds?: number[];
    personId?: number;
    minVotes?: number;
  }): { path: string; options: TmdbRequestOptions } => ({
    path: '/discover/movie',
    options: {
      query: {
        page: 1,
        include_adult: false,
        sort_by: 'popularity.desc',
        'vote_count.gte': options.minVotes ?? 200,
        ...(options.genreIds?.length ? { with_genres: options.genreIds.join(',') } : {}),
        ...(options.personId ? { with_cast: options.personId } : {}),
      },
    },
  }),

  genres: (): { path: string; options: TmdbRequestOptions } => ({
    path: '/genre/movie/list',
    options: {},
  }),
} as const;
