import type { TmdbClient } from '@shared/api/tmdb/tmdb.client';
import { tmdbClient } from '@shared/api/tmdb/tmdb.client';
import { tmdbEndpoints } from '@shared/api/tmdb/tmdb.endpoints';
import { mapMovieList } from '@shared/api/tmdb/tmdb.mappers';
import { tmdbPagedSchema } from '@shared/api/tmdb/tmdb.schemas';
import { parseCachedSummaries } from '@entities/film/film.schema';
import type { FilmSummary } from '@entities/film/film.model';
import { db, safeRead, safeWrite } from '@shared/storage/db';
import { emptySnapshot, toFeedItems, FEED_CACHE_KEY, type FeedSnapshot } from './feed.model';

export class FeedRepository {
  constructor(private readonly client: TmdbClient = tmdbClient) {}

  /** Local data first so the feed never starts empty (spec §24). */
  async readCache(key = FEED_CACHE_KEY): Promise<FeedSnapshot> {
    const row = await safeRead(() => db.feed.get(key), undefined);
    if (!row) return emptySnapshot();
    const items = parseCachedSummaries(row.items);
    if (!items.length) return emptySnapshot();
    return { items: toFeedItems(items), updatedAt: row.cachedAt, source: 'cache' };
  }

  async fetchTrending(signal?: AbortSignal): Promise<FeedSnapshot> {
    const { path, options } = tmdbEndpoints.trending();
    const payload = await this.client.request(path, tmdbPagedSchema, { ...options, signal });
    const films = mapMovieList(payload.results, 18).filter((film) => film.posterPath || film.title);
    if (!films.length) return emptySnapshot();
    await this.writeCache(films);
    return { items: toFeedItems(films), updatedAt: Date.now(), source: 'network' };
  }

  async fetchPopular(signal?: AbortSignal): Promise<FilmSummary[]> {
    const { path, options } = tmdbEndpoints.popular();
    const payload = await this.client.request(path, tmdbPagedSchema, { ...options, signal });
    return mapMovieList(payload.results, 12);
  }

  private async writeCache(items: FilmSummary[], key = FEED_CACHE_KEY): Promise<void> {
    await safeWrite(() => db.feed.put({ key, items, cachedAt: Date.now() }));
  }
}

export const feedRepository = new FeedRepository();
