import type { AccentColor, FilmSummary } from '@entities/film/film.model';

export interface WatchlistEntry {
  id: number;
  title: string;
  year: string;
  posterPath: string;
  accent: AccentColor;
  addedAt: number;
  /** Set while a server sync for this entry is still queued. */
  pendingSync: boolean;
}

export const entryFromSummary = (film: FilmSummary): WatchlistEntry => ({
  id: film.id,
  title: film.title,
  year: film.year,
  posterPath: film.posterPath,
  accent: film.accent,
  addedAt: Date.now(),
  pendingSync: true,
});

export const WATCHLIST_ADDED_MESSAGE = 'Добавлено в «Посмотреть позже»';
export const WATCHLIST_REMOVED_MESSAGE = 'Убрано из списка';
