/**
 * Rating domain types (spec §5).
 *
 * The scale is 1-5 with no halves. Zero is not a rating: "nothing chosen yet"
 * is `null` everywhere outside the star control's own internal state.
 */

export type RatingMode = 'quick' | 'deep';

export type RatingAspectId = 'story' | 'characters' | 'direction' | 'sound' | 'aftertaste';

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export type RatingDraftStatus = 'active' | 'completed' | 'abandoned';

export type SyncStatus = 'local' | 'pending' | 'synced' | 'error' | 'deleted';

/** Flow state machine (spec §3) — lives in the store, never only in a component. */
export type RatingFlowState =
  'preparing' | 'chooseMode' | 'quick' | 'deepStep' | 'result' | 'saving' | 'saved' | 'error';

export interface AspectScores {
  story: RatingValue | null;
  characters: RatingValue | null;
  direction: RatingValue | null;
  sound: RatingValue | null;
  aftertaste: RatingValue | null;
}

export interface RatingDraft {
  id: string;
  filmId: number;
  filmTitle: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseYear: string | null;
  /** Null until a mode is chosen — the selector alone creates nothing. */
  mode: RatingMode | null;
  quickRating: RatingValue | null;
  aspects: AspectScores;
  /** 0-based index into the five deep steps. */
  currentStep: number;
  status: RatingDraftStatus;
  createdAt: string;
  updatedAt: string;
  /** Set when the draft edits an existing entry — never creates a second one. */
  editingEntryId?: string;
  /** "r, g, b" of the film, for the ambient. */
  dominantColor?: string | null;
  /** Bumped on every commit so the emergency mirror can win a race. */
  revision: number;
}

export const emptyAspects = (): AspectScores => ({
  story: null,
  characters: null,
  direction: null,
  sound: null,
  aftertaste: null,
});
