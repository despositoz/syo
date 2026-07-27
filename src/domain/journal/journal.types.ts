import type {
  AspectScores,
  FilmSnapshot,
  RatingMode,
  RatingValue,
  SyncStatus,
} from '@domain/rating/rating.types';

/**
 * A saved rating (spec §13.1).
 *
 * `id` is the primary key, not `filmId` — P0.2 keeps one active entry per film,
 * but rewatches later need their own rows without a schema change.
 */
export interface JournalEntry {
  schemaVersion: 1;
  id: string;
  /** Makes a repeated save (double tap, sync retry) idempotent. */
  clientMutationId: string;
  filmId: number;
  film: FilmSnapshot;
  mode: RatingMode;
  quickScore: RatingValue | null;
  /** null for quick entries; all five values for detailed ones. */
  aspects: AspectScores | null;
  rawScore: number;
  displayScore: number;
  formulaVersion: 1;
  /** When the entry was first added. Not a "watched on" date. */
  createdAt: string;
  updatedAt: string;
  revision: number;
  syncStatus: SyncStatus;
  /** Set by a soft delete; the row survives so Undo can restore it. */
  deletedAt?: string | null;
}

export type JournalView = 'grid' | 'list';

/** Entries of one calendar month, newest month first. */
export interface JournalMonth {
  /** "2026-07" — stable key for React and for tests. */
  key: string;
  label: string;
  entries: JournalEntry[];
}

export const isActiveEntry = (entry: JournalEntry): boolean =>
  entry.deletedAt === null || entry.deletedAt === undefined;
