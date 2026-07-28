import { ASPECT_IDS, DEEP_STEP_COUNT } from './rating.constants';
import {
  emptyAspects,
  type AspectScores,
  type RatingDraft,
  type RatingDraftStatus,
  type RatingMode,
  type RatingValue,
} from './rating.types';

/**
 * Validation for anything crossing a trust boundary: IndexedDB rows, the
 * localStorage mirror, URL parameters. Storage written by an older build (or
 * corrupted) must never crash the flow.
 *
 * Recovery, not rejection (spec §41): a draft with one bad field keeps the
 * fields that are still valid and drops only the broken ones. Only a draft
 * without an identifiable film is unusable.
 */

export const isRatingValue = (value: unknown): value is RatingValue =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

export const isRatingValueOrNull = (value: unknown): value is RatingValue | null =>
  value === null || isRatingValue(value);

export const isRatingMode = (value: unknown): value is RatingMode =>
  value === 'quick' || value === 'deep';

const isStatus = (value: unknown): value is RatingDraftStatus =>
  value === 'active' || value === 'completed' || value === 'abandoned';

const asStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** Unknown or out-of-range scores are dropped, not treated as zero. */
const recoverAspects = (value: unknown): AspectScores => {
  const result = emptyAspects();
  if (typeof value !== 'object' || value === null) return result;
  const source = value as Record<string, unknown>;
  for (const id of ASPECT_IDS) {
    if (isRatingValue(source[id])) result[id] = source[id] as RatingValue;
  }
  return result;
};

/**
 * Parses a stored draft, salvaging what it can. Returns null only when there
 * is no film to rate — then "no draft" is the honest answer.
 */
export const parseRatingDraft = (value: unknown): RatingDraft | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;

  const filmId = source.filmId;
  if (typeof filmId !== 'number' || !Number.isFinite(filmId) || filmId <= 0) return null;
  const filmTitle = asStringOrNull(source.filmTitle);
  if (!filmTitle) return null;

  const aspects = recoverAspects(source.aspects);
  const rawStep = source.currentStep;
  const currentStep =
    typeof rawStep === 'number' && Number.isInteger(rawStep) && rawStep >= 0
      ? Math.min(rawStep, DEEP_STEP_COUNT - 1)
      : 0;

  const timestamp = new Date().toISOString();
  const draft: RatingDraft = {
    id: asStringOrNull(source.id) ?? createId(),
    filmId,
    filmTitle,
    posterPath: asStringOrNull(source.posterPath),
    backdropPath: asStringOrNull(source.backdropPath),
    releaseYear: asStringOrNull(source.releaseYear),
    dominantColor: asStringOrNull(source.dominantColor),
    mode: isRatingMode(source.mode) ? source.mode : null,
    quickRating: isRatingValue(source.quickRating) ? source.quickRating : null,
    aspects,
    currentStep,
    status: isStatus(source.status) ? source.status : 'active',
    createdAt: asStringOrNull(source.createdAt) ?? timestamp,
    updatedAt: asStringOrNull(source.updatedAt) ?? timestamp,
    revision: typeof source.revision === 'number' ? source.revision : 0,
  };
  const editingEntryId = asStringOrNull(source.editingEntryId);
  if (editingEntryId) draft.editingEntryId = editingEntryId;

  return draft;
};

/**
 * Ids are only ever local, so they need not be cryptographically unique across
 * devices — they must merely never collide with themselves.
 */
export const createId = (): string => {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && 'randomUUID' in cryptoRef) return cryptoRef.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
