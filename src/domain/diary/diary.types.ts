import type { AspectScores, RatingMode, RatingValue } from '@domain/rating/rating.types';

/**
 * A saved rating (spec §5).
 *
 * `id` is the primary key, not `filmId` — P0.2 keeps one entry per film, but a
 * rewatch later needs its own row without a schema change.
 *
 * `hasText`/`text` are the seats kept for the next stage's written impression.
 * They are always false/null here, and nothing in the UI hints at them.
 */
export interface DiaryEntry {
  id: string;
  filmId: number;
  filmTitle: string;
  posterPath: string | null;
  releaseYear: string | null;
  mode: RatingMode;
  /** Whole stars, 1-5. */
  overallRating: RatingValue;
  /** Mean of the aspects for deep, the star itself for quick. */
  preciseRating: number;
  /** All five for deep; all null for quick. */
  aspects: AspectScores;
  hasText: false;
  text: null;
  /** When the film was watched. P0.2 uses the moment of rating. */
  watchedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Makes a repeated save (double tap, replayed sync) idempotent. */
  clientMutationId: string;
  revision: number;
  syncStatus: 'local' | 'pending' | 'synced' | 'error' | 'deleted';
  /** Set by a soft delete; the row survives so Undo can restore it. */
  deletedAt?: string | null;
}

export const isActiveEntry = (entry: DiaryEntry): boolean =>
  entry.deletedAt === null || entry.deletedAt === undefined;
