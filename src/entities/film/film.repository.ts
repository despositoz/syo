import type { TmdbClient } from '@shared/api/tmdb/tmdb.client';
import { TmdbError, tmdbClient } from '@shared/api/tmdb/tmdb.client';
import { tmdbEndpoints } from '@shared/api/tmdb/tmdb.endpoints';
import { filmFromSummary, mapMovieDetails, mapMovieList } from '@shared/api/tmdb/tmdb.mappers';
import { tmdbMovieDetailsSchema, tmdbPagedSchema } from '@shared/api/tmdb/tmdb.schemas';
import type { Film, FilmSummary } from './film.model';
import { readFilmFromCache, writeFilmToCache } from './film.cache';

export interface FilmLoadResult {
  film: Film;
  /** 'cache' means the network is still pending or failed. */
  source: 'cache' | 'network';
  /** Present when the network failed but a cached film was served. */
  error?: TmdbError;
}

/**
 * Merges local cache and network. Screens ask for a film — they never learn
 * where it came from beyond `source`.
 */
export class FilmRepository {
  constructor(private readonly client: TmdbClient = tmdbClient) {}

  async search(query: string, signal?: AbortSignal): Promise<FilmSummary[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const { path, options } = tmdbEndpoints.search(trimmed);
    const payload = await this.client.request(path, tmdbPagedSchema, { ...options, signal });
    return mapMovieList(payload.results, 20);
  }

  /** Cached film first (instantly), then a network refresh. */
  async getCached(filmId: number): Promise<Film | null> {
    return readFilmFromCache(filmId);
  }

  async fetchDetails(filmId: number, signal?: AbortSignal): Promise<Film> {
    const previous = await readFilmFromCache(filmId);
    const { path, options } = tmdbEndpoints.details(filmId);
    const payload = await this.client.request(path, tmdbMovieDetailsSchema, { ...options, signal });
    const film = mapMovieDetails(payload, previous);
    await writeFilmToCache(film);
    return film;
  }

  /**
   * Never throws when *any* usable data exists: a summary from the feed or a
   * cached film keeps the screen alive (spec §25).
   */
  async load(
    filmId: number,
    summary?: FilmSummary | null,
    signal?: AbortSignal,
  ): Promise<FilmLoadResult> {
    try {
      const film = await this.fetchDetails(filmId, signal);
      return { film, source: 'network' };
    } catch (error) {
      const cached = await readFilmFromCache(filmId);
      if (cached) {
        return { film: cached, source: 'cache', error: asTmdbError(error) };
      }
      if (summary) {
        const stub = filmFromSummary(summary);
        return { film: stub, source: 'cache', error: asTmdbError(error) };
      }
      throw error;
    }
  }

  async saveSummaryAsFilm(summary: FilmSummary): Promise<Film> {
    const previous = await readFilmFromCache(summary.id);
    const film = filmFromSummary(summary, previous);
    await writeFilmToCache(film);
    return film;
  }
}

const asTmdbError = (error: unknown): TmdbError | undefined =>
  error instanceof TmdbError ? error : undefined;

export const filmRepository = new FilmRepository();
