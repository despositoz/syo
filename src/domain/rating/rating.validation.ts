import { ASPECT_IDS, isRatingAspectId } from './rating.constants';
import {
  emptyAspects,
  type AspectScores,
  type FilmSnapshot,
  type RatingDraft,
  type RatingMode,
  type RatingScreen,
  type RatingValue,
} from './rating.types';

/**
 * Validation for anything crossing a trust boundary: IndexedDB rows, the
 * localStorage mirror, and URL parameters. Storage written by an older build
 * (or corrupted) must never crash the flow — it is rejected and rebuilt.
 */

export const isRatingValue = (value: unknown): value is RatingValue =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;

/** Note the explicit null check: `0` is valid and must survive. */
export const isRatingValueOrNull = (value: unknown): value is RatingValue | null =>
  value === null || isRatingValue(value);

export const isRatingMode = (value: unknown): value is RatingMode =>
  value === 'quick' || value === 'detailed';

const isRatingScreen = (value: unknown): value is RatingScreen =>
  value === 'quick' || value === 'aspect' || value === 'result';

const parseAspects = (value: unknown): AspectScores | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const result = emptyAspects();
  for (const id of ASPECT_IDS) {
    const score = source[id];
    if (!isRatingValueOrNull(score)) return null;
    result[id] = score;
  }
  return result;
};

const parseFilmSnapshot = (value: unknown): FilmSnapshot | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const filmId = source.filmId;
  const title = source.title;
  if (typeof filmId !== 'number' || !Number.isFinite(filmId) || filmId <= 0) return null;
  if (typeof title !== 'string' || !title) return null;

  const snapshot: FilmSnapshot = {
    filmId,
    title,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString(),
  };
  if (typeof source.originalTitle === 'string') snapshot.originalTitle = source.originalTitle;
  if (typeof source.releaseYear === 'number') snapshot.releaseYear = source.releaseYear;
  if (typeof source.posterPath === 'string') snapshot.posterPath = source.posterPath;
  if (typeof source.backdropPath === 'string') snapshot.backdropPath = source.backdropPath;
  if (typeof source.dominantColor === 'string') snapshot.dominantColor = source.dominantColor;
  if (Array.isArray(source.genreIds)) {
    snapshot.genreIds = source.genreIds.filter((id): id is number => typeof id === 'number');
  }
  return snapshot;
};

/**
 * Parses a stored draft. Returns null for anything unusable rather than
 * throwing: a broken draft must degrade to "no draft", not to a broken app.
 */
export const parseRatingDraft = (value: unknown): RatingDraft | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;

  if (source.schemaVersion !== 1) return null;
  if (!isRatingMode(source.mode)) return null;
  if (!isRatingScreen(source.currentScreen)) return null;
  if (!isRatingValueOrNull(source.quickScore)) return null;

  const film = parseFilmSnapshot(source.film);
  if (!film) return null;

  const aspects = parseAspects(source.aspects);
  if (!aspects) return null;

  const currentAspect = source.currentAspect;
  if (
    currentAspect !== null &&
    !(typeof currentAspect === 'string' && isRatingAspectId(currentAspect))
  ) {
    return null;
  }

  const draft: RatingDraft = {
    schemaVersion: 1,
    id: 'active',
    draftUuid: typeof source.draftUuid === 'string' ? source.draftUuid : createId(),
    film,
    mode: source.mode,
    quickScore: source.quickScore,
    aspects,
    currentAspect,
    currentScreen: source.currentScreen,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString(),
    revision: typeof source.revision === 'number' ? source.revision : 0,
  };

  if (isRatingValueOrNull(source.previousQuickScore) && source.previousQuickScore !== null) {
    draft.previousQuickScore = source.previousQuickScore;
  }
  if (typeof source.editingEntryId === 'string') draft.editingEntryId = source.editingEntryId;

  return draft;
};

/**
 * Ids are only ever local, so a UUID is not required to be cryptographically
 * unique across devices — it must merely never collide with itself.
 */
export const createId = (): string => {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && 'randomUUID' in cryptoRef) return cryptoRef.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
