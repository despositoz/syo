import { db, safeRead, safeWrite } from '@shared/storage/db';
import type { Film } from './film.model';
import { parseCachedFilm } from './film.schema';

/** Details older than this are refreshed in the background, never awaited. */
export const FILM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Memory tier in front of IndexedDB: reopening the same film must be instant. */
const memory = new Map<number, Film>();

export const readFilmFromCache = async (filmId: number): Promise<Film | null> => {
  const inMemory = memory.get(filmId);
  if (inMemory) return inMemory;

  const row = await safeRead(() => db.films.get(filmId), undefined);
  if (!row) return null;
  const film = parseCachedFilm(row.film);
  if (!film) {
    await safeWrite(() => db.films.delete(filmId));
    return null;
  }
  memory.set(filmId, film);
  return film;
};

export const readCachedAt = async (filmId: number): Promise<number> => {
  const row = await safeRead(() => db.films.get(filmId), undefined);
  return row?.cachedAt ?? 0;
};

export const writeFilmToCache = async (film: Film): Promise<void> => {
  memory.set(film.id, film);
  await safeWrite(() => db.films.put({ id: film.id, film, cachedAt: Date.now() }));
};

export const isStale = (cachedAt: number, ttl = FILM_CACHE_TTL_MS): boolean =>
  Date.now() - cachedAt > ttl;

/** Test seam. */
export const clearFilmMemoryCache = (): void => memory.clear();
