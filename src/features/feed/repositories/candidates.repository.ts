import { tmdbClient, type TmdbClient, type TmdbRequestOptions } from '@shared/api/tmdb/tmdb.client';
import { tmdbEndpoints } from '@shared/api/tmdb/tmdb.endpoints';
import { mapMovieList } from '@shared/api/tmdb/tmdb.mappers';
import { tmdbPagedSchema } from '@shared/api/tmdb/tmdb.schemas';
import type { FilmSummary } from '@entities/film/film.model';
import type { RecommendationCandidate } from '@domain/feed/recommendation.engine';

/**
 * Where recommendation candidates come from (P0.4 §13.1, §30.4).
 *
 * One place, outside React. Requests are bounded (a handful of seeds, one page
 * each), run with a shared AbortSignal, and a failure of any single source is
 * simply fewer candidates — never an error on screen.
 */

export interface CandidateRequest {
  seedFilmIds: number[];
  /** TMDB genre ids the user rates well, for discovery. */
  genreIds?: number[];
  signal?: AbortSignal;
}

/** Two requests per seed, at most three seeds — a feed is not a crawler. */
const MAX_SEEDS_PER_REFRESH = 3;

export class CandidatesRepository {
  constructor(private readonly client: TmdbClient = tmdbClient) {}

  private async list(
    path: string,
    options: TmdbRequestOptions,
    signal?: AbortSignal,
  ): Promise<FilmSummary[]> {
    try {
      const payload = await this.client.request(path, tmdbPagedSchema, { ...options, signal });
      return mapMovieList(payload.results, 20);
    } catch {
      // One dead source costs its candidates and nothing else (§25.4).
      return [];
    }
  }

  async fetchCandidates(request: CandidateRequest): Promise<RecommendationCandidate[]> {
    const seeds = request.seedFilmIds.slice(0, MAX_SEEDS_PER_REFRESH);
    const jobs: Promise<RecommendationCandidate[]>[] = [];

    for (const seedFilmId of seeds) {
      const recommendations = tmdbEndpoints.recommendations(seedFilmId);
      jobs.push(
        this.list(recommendations.path, recommendations.options, request.signal).then((films) =>
          films.map((film, index) => ({
            film,
            source: 'recommendations' as const,
            seedFilmId,
            sourceRank: index,
          })),
        ),
      );

      const similar = tmdbEndpoints.similar(seedFilmId);
      jobs.push(
        this.list(similar.path, similar.options, request.signal).then((films) =>
          films.map((film, index) => ({
            film,
            source: 'similar' as const,
            seedFilmId,
            sourceRank: index,
          })),
        ),
      );
    }

    if (request.genreIds?.length) {
      const discover = tmdbEndpoints.discover({ genreIds: request.genreIds });
      jobs.push(
        this.list(discover.path, discover.options, request.signal).then((films) =>
          films.map((film, index) => ({
            film,
            source: 'genre' as const,
            seedFilmId: null,
            sourceRank: index,
          })),
        ),
      );
    }

    const results = await Promise.all(jobs);
    return results.flat();
  }
}

export const candidatesRepository = new CandidatesRepository();
