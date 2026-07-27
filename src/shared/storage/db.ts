import Dexie, { type Table } from 'dexie';
import type { Film, FilmSummary } from '@entities/film/film.model';
import type { WatchlistEntry } from '@entities/watchlist/watchlist.model';
import type { RatingDraft } from '@domain/rating/rating.types';
import type { JournalEntry } from '@domain/journal/journal.types';

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
  | { type: 'watchlistAdd'; filmId: number }
  | { type: 'watchlistRemove'; filmId: number }
  | { type: 'journalUpsert'; entryId: string; clientMutationId: string; revision: number }
  | { type: 'journalDelete'; entryId: string; clientMutationId: string; revision: number };

export interface SyncQueueRow {
  id?: number;
  task: SyncTask;
  createdAt: number;
  attempts: number;
  /** Set by markError; kept so a failure is visible without a second store. */
  lastError?: string;
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
  /** Exactly one row, keyed 'active' — the single in-flight rating draft. */
  ratingDrafts!: Table<RatingDraft, string>;
  journal!: Table<JournalEntry, string>;

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

    /*
     * v2 adds the rating draft and journal stores. Dexie applies only the
     * missing versions, and stores absent from a version() call are left
     * untouched — the film cache and the watchlist survive the upgrade.
     *
     * `filmId` is indexed but NOT unique: a soft-deleted tombstone keeps its
     * row, so a re-rated film would collide with a unique index. Uniqueness of
     * the *active* entry per film is enforced in the repository instead.
     */
    this.version(2).stores({
      ratingDrafts: 'id, updatedAt',
      journal: 'id, filmId, createdAt, deletedAt, syncStatus',
    });
  }
}

export const db = new SyoDatabase();

export type StorageErrorKind = 'quota' | 'aborted' | 'serialization' | 'migration' | 'unknown';

/**
 * Typed storage failure (spec §14.8). Callers that must tell the user
 * something ("не получилось сохранить на устройстве") need the kind, never the
 * raw DOMException text.
 */
export class StorageError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    override readonly cause?: unknown,
  ) {
    super(`storage:${kind}`);
    this.name = 'StorageError';
  }
}

export const classifyStorageError = (error: unknown): StorageError => {
  if (error instanceof StorageError) return error;
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'QuotaExceededError' || name === 'QuotaExceeded') return new StorageError('quota', error);
  if (name === 'AbortError' || name === 'TransactionInactiveError')
    return new StorageError('aborted', error);
  if (name === 'DataCloneError') return new StorageError('serialization', error);
  if (name === 'VersionError' || name === 'UpgradeError') return new StorageError('migration', error);
  return new StorageError('unknown', error);
};

/**
 * For writes whose failure the user must hear about (saving a rating).
 * Unlike safeWrite it rethrows — as a typed error.
 */
export const strictWrite = async <T>(write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    throw classifyStorageError(error);
  }
};

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
