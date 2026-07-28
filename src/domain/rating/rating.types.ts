/**
 * Rating domain types (spec §13).
 *
 * `null` means "not rated yet"; `0` means "deliberately rated zero".
 * These two are never conflated — no falsy checks anywhere in this codebase.
 */

export type RatingMode = 'quick' | 'detailed';

export type RatingAspectId =
  'story' | 'performance' | 'directionVisual' | 'soundMusic' | 'aftertaste';

export type RatingValue = 0 | 1 | 2 | 3 | 4 | 5;

export type SyncStatus = 'local' | 'pending' | 'synced' | 'error' | 'deleted';

/** The screen a draft is parked on, so a reload resumes exactly there. */
export type RatingScreen = 'quick' | 'aspect' | 'result';

/**
 * Everything the rating flow needs about a film, copied at start time.
 * The flow must work offline, so it never re-reads TMDB.
 */
export interface FilmSnapshot {
  filmId: number;
  title: string;
  originalTitle?: string;
  releaseYear?: number;
  posterPath?: string;
  backdropPath?: string;
  /** Dominant colour as "r, g, b" so it drops straight into rgba(). */
  dominantColor?: string;
  genreIds?: number[];
  updatedAt: string;
}

export interface AspectScores {
  story: RatingValue | null;
  performance: RatingValue | null;
  directionVisual: RatingValue | null;
  soundMusic: RatingValue | null;
  aftertaste: RatingValue | null;
}

export interface RatingDraft {
  schemaVersion: 1;
  /** Only one active draft exists in the whole app. */
  id: 'active';
  draftUuid: string;
  film: FilmSnapshot;
  mode: RatingMode;
  quickScore: RatingValue | null;
  /** Kept when quick is upgraded to detailed — never used in the formula. */
  previousQuickScore?: RatingValue | null;
  aspects: AspectScores;
  currentAspect: RatingAspectId | null;
  currentScreen: RatingScreen;
  /** Set when the draft edits an existing journal entry. */
  editingEntryId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface RatingResult {
  rawAverage: number;
  displayScore: number;
  formulaVersion: 1;
}

export const emptyAspects = (): AspectScores => ({
  story: null,
  performance: null,
  directionVisual: null,
  soundMusic: null,
  aftertaste: null,
});
