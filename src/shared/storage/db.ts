import Dexie, { type Table } from 'dexie';
import type { Film, FilmSummary } from '@entities/film/film.model';
import type { WatchlistEntry } from '@entities/watchlist/watchlist.model';
import type { ActiveDraft } from '@domain/writing/writing.types';
import type { DiaryEntry } from '@domain/diary/diary.types';

export interface FilmCacheRow {
  id: number;
  film: Film;
  cachedAt: number;
}

/**
 * The feed cache row.
 *
 * `items` is the P0.1–P0.3 shape (a bare list of films); `snapshot` is the
 * P0.4 one. Both may be present on a row written by an older build, and the
 * reader prefers the snapshot — that is what makes the upgrade invisible
 * rather than a blank screen (P0.4 §36.3).
 */
export interface FeedCacheRow {
  key: string;
  items?: FilmSummary[];
  snapshot?: unknown;
  cachedAt: number;
}

/** One row per feedback action the user took in the feed (P0.4 §16). */
export interface FeedFeedbackRow {
  id: string;
  itemId: string;
  filmId: number | null;
  observationCode: string | null;
  action: string;
  contextId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** How often an item was actually on screen, and what happened to it. */
export interface FeedImpressionRow {
  itemId: string;
  firstShownAt: string;
  lastShownAt: string;
  showCount: number;
  openedAt: string | null;
  action: string | null;
}

/** Where the feed was when the user left it (P0.4 §22). */
export interface FeedPositionRow {
  key: string;
  anchorItemId: string | null;
  anchorOffset: number;
  scrollTopFallback: number;
  updatedAt: number;
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
  | { type: 'diaryUpsert'; entryId: string; clientMutationId: string; revision: number }
  | { type: 'diaryDelete'; entryId: string; clientMutationId: string; revision: number };

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
  /** At most one row with status 'active' — the single in-flight draft. */
  /**
   * The single active draft — a rating one or a writing one (spec §6.4,
   * variant A). The physical store keeps its v2 name: renaming it would mean
   * moving live data for no behavioural gain, and moving a draft is exactly
   * the operation with the worst downside.
   */
  ratingDrafts!: Table<ActiveDraft, string>;
  diaryEntries!: Table<DiaryEntry, string>;
  feedFeedback!: Table<FeedFeedbackRow, string>;
  feedImpressions!: Table<FeedImpressionRow, string>;
  feedPosition!: Table<FeedPositionRow, string>;

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

    /*
     * v3 moves the diary to its own store with the indexes the Diary actually
     * queries (spec §6), and retires the v2 `journal` store.
     *
     * The old rows are carried across rather than dropped: the scale changed
     * from 0-5 with halves to 1-5 whole, so a 0 or a 4.5 is clamped and rounded
     * into the new scale. Losing someone's ratings to a schema change would be
     * the worst possible outcome of a rename.
     */
    this.version(3)
      .stores({
        diaryEntries: 'id, filmId, createdAt, watchedAt, updatedAt, deletedAt, syncStatus',
        journal: null,
      })
      .upgrade(async (tx) => {
        const legacy = await tx.table('journal').toArray();
        if (!legacy.length) return;
        const migrated = legacy.map(migrateLegacyEntry).filter((row): row is DiaryEntry => !!row);
        await tx.table('diaryEntries').bulkPut(migrated);
      });

    /*
     * v4 makes room for the written impression. No index changes: entries
     * saved before P0.3 simply gain `hasText: false` and `text: null`, which is
     * what "rating only" means. Re-running finds nothing left to backfill, so
     * the upgrade is idempotent.
     */
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('diaryEntries')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row.text === undefined) row.text = null;
            row.hasText = row.text !== null;
          });
      });

    /*
     * v5 adds the personal feed's own stores. The feed cache itself is *not*
     * touched: the legacy `items` array stays exactly where it is and is
     * converted to discovery items on read, so an upgrade never costs the user
     * their first paint (P0.4 §36).
     */
    this.version(5).stores({
      feedFeedback: 'id, itemId, filmId, action, createdAt',
      feedImpressions: 'itemId, lastShownAt',
      feedPosition: 'key',
    });
  }
}

/** Maps a v2 journal row onto the v3 diary shape. */
const migrateLegacyEntry = (row: Record<string, unknown>): DiaryEntry | null => {
  const filmId = Number(row.filmId);
  if (!Number.isFinite(filmId) || filmId <= 0) return null;

  const film = (row.film ?? {}) as Record<string, unknown>;
  const raw = Number(row.rawScore ?? row.displayScore ?? 0);
  // 0-5 with halves → 1-5 whole.
  const overall = Math.min(5, Math.max(1, Math.round(raw))) as DiaryEntry['overallRating'];
  const aspects = (row.aspects ?? null) as DiaryEntry['aspects'] | null;
  const deep = row.mode === 'detailed' || row.mode === 'deep';
  // The v2 aspect ids differ from v3's, so read them as a loose bag.
  const legacyAspects = (aspects ?? {}) as Record<string, unknown>;
  const timestamp = typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString();

  return {
    id: String(row.id ?? `${filmId}`),
    filmId,
    filmTitle: String(film.title ?? row.filmTitle ?? 'Без названия'),
    posterPath: typeof film.posterPath === 'string' ? film.posterPath : null,
    releaseYear: film.releaseYear ? String(film.releaseYear) : null,
    mode: deep ? 'deep' : 'quick',
    overallRating: overall,
    preciseRating: Math.min(5, Math.max(1, raw || overall)),
    // Aspect ids changed too, so only a complete deep set is worth keeping.
    aspects:
      deep && aspects
        ? {
            story: clampLegacy(legacyAspects.story),
            characters: clampLegacy(legacyAspects.performance),
            direction: clampLegacy(legacyAspects.directionVisual),
            sound: clampLegacy(legacyAspects.soundMusic),
            aftertaste: clampLegacy(legacyAspects.aftertaste),
          }
        : { story: null, characters: null, direction: null, sound: null, aftertaste: null },
    hasText: false,
    text: null,
    watchedAt: typeof row.updatedAt === 'string' ? row.updatedAt : timestamp,
    createdAt: timestamp,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : timestamp,
    clientMutationId: String(row.clientMutationId ?? `${row.id}`),
    revision: Number(row.revision ?? 1),
    syncStatus: 'local',
    deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : null,
  };
};

/** A legacy 0 becomes 1: the old scale's zero has no home in 1-5. */
const clampLegacy = (value: unknown): DiaryEntry['overallRating'] | null => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(5, Math.max(1, Math.round(number))) as DiaryEntry['overallRating'];
};

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
  if (name === 'QuotaExceededError' || name === 'QuotaExceeded')
    return new StorageError('quota', error);
  if (name === 'AbortError' || name === 'TransactionInactiveError')
    return new StorageError('aborted', error);
  if (name === 'DataCloneError') return new StorageError('serialization', error);
  if (name === 'VersionError' || name === 'UpgradeError')
    return new StorageError('migration', error);
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
