import Dexie, { type Table } from 'dexie';
import type { Film, FilmSummary } from '@entities/film/film.model';
import type { WatchlistEntry } from '@entities/watchlist/watchlist.model';

export interface FilmCacheRow {
  id: number;
  film: Film;
  cachedAt: number;
}

export interface FeedCacheRow {
  key: string;
  items: FilmSummary[];
  cachedAt: number;
}

export interface PresentationCacheRow {
  filmId: number;
  mode: 'logo' | 'text';
  logoPath: string;
  tone: string;
  cachedAt: number;
}

export interface PreferenceRow {
  key: string;
  value: unknown;
}

export type SyncTask =
  { type: 'watchlistAdd'; filmId: number } | { type: 'watchlistRemove'; filmId: number };

export interface SyncQueueRow {
  id?: number;
  task: SyncTask;
  createdAt: number;
  attempts: number;
}

/**
 * The only IndexedDB definition in the app. UI never touches it —
 * repositories do.
 */
export class SyoDatabase extends Dexie {
  films!: Table<FilmCacheRow, number>;
  feed!: Table<FeedCacheRow, string>;
  presentations!: Table<PresentationCacheRow, number>;
  watchlist!: Table<WatchlistEntry, number>;
  preferences!: Table<PreferenceRow, string>;
  syncQueue!: Table<SyncQueueRow, number>;

  constructor(name = 'syo') {
    super(name);
    this.version(1).stores({
      films: 'id, cachedAt',
      feed: 'key, cachedAt',
      presentations: 'filmId, cachedAt',
      watchlist: 'id, addedAt',
      preferences: 'key',
      syncQueue: '++id, createdAt',
    });
  }
}

export const db = new SyoDatabase();

/**
 * Storage must never break the app: a private-mode browser or a full quota
 * degrades to memory-only behaviour instead of throwing into the UI.
 */
export const safeRead = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    console.warn('[syo] storage read failed', error);
    return fallback;
  }
};

export const safeWrite = async (write: () => Promise<unknown>): Promise<boolean> => {
  try {
    await write();
    return true;
  } catch (error) {
    console.warn('[syo] storage write failed', error);
    return false;
  }
};

export const readPreference = async <T>(key: string, fallback: T): Promise<T> => {
  const row = await safeRead(() => db.preferences.get(key), undefined);
  return row === undefined ? fallback : (row.value as T);
};

export const writePreference = async (key: string, value: unknown): Promise<void> => {
  await safeWrite(() => db.preferences.put({ key, value }));
};
