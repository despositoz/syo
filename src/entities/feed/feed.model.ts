import type { FilmSummary } from '@entities/film/film.model';

/** Layout intent decided by the repository, not by the page. */
export type FeedItemKind = 'cinematic' | 'compact';

export interface FeedItem {
  id: number;
  kind: FeedItemKind;
  film: FilmSummary;
}

export interface FeedSnapshot {
  items: FeedItem[];
  /** Epoch ms of the data actually shown. 0 = never loaded. */
  updatedAt: number;
  source: 'cache' | 'network' | 'empty';
}

export const FEED_CACHE_KEY = 'trending-day';
/** Cache is served instantly; anything older is refreshed in the background. */
export const FEED_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * One large cinematic card, then compact ones. The first item is the strongest
 * recommendation, not a random hero.
 */
export const toFeedItems = (films: FilmSummary[]): FeedItem[] =>
  films.map((film, index) => ({
    id: film.id,
    kind: index === 0 ? 'cinematic' : 'compact',
    film,
  }));

export const emptySnapshot = (): FeedSnapshot => ({ items: [], updatedAt: 0, source: 'empty' });
