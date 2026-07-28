import { ASPECT_IDS, DEEP_STEP_COUNT, aspectAtStep } from './rating.constants';
import { isComplete } from './rating.calculator';
import { createId } from './rating.validation';
import {
  emptyAspects,
  type AspectScores,
  type RatingAspectId,
  type RatingDraft,
  type RatingFlowState,
  type RatingMode,
  type RatingValue,
} from './rating.types';

/**
 * Draft state machine (spec §3). Pure: every function takes a draft and returns
 * a new one. The current step lives here and in storage — never inferred from
 * the DOM, and never held only in React state.
 *
 *   preparing → chooseMode → quick   → result → saving → saved
 *   preparing → chooseMode → deepStep(0..4) → result → saving → saved
 */

/** What the flow needs about a film, captured once so it works offline. */
export interface RatingFilmSummary {
  filmId: number;
  filmTitle: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseYear: string | null;
  dominantColor?: string | null;
}

export interface CreateDraftOptions {
  film: RatingFilmSummary;
  /** Null until the user picks one on the mode screen. */
  mode?: RatingMode | null;
  /** Set when editing an existing diary entry. */
  editingEntryId?: string;
  /** Existing values when editing — real data, not defaults. */
  quickRating?: RatingValue | null;
  aspects?: AspectScores;
  now?: () => string;
}

const nowIso = () => new Date().toISOString();

/**
 * Created only *after* a mode is chosen — opening the selector and leaving
 * must not leave an empty draft behind (spec §10).
 */
export const createDraft = (options: CreateDraftOptions): RatingDraft => {
  const timestamp = (options.now ?? nowIso)();
  const draft: RatingDraft = {
    id: createId(),
    filmId: options.film.filmId,
    filmTitle: options.film.filmTitle,
    posterPath: options.film.posterPath,
    backdropPath: options.film.backdropPath,
    releaseYear: options.film.releaseYear,
    dominantColor: options.film.dominantColor ?? null,
    mode: options.mode ?? null,
    quickRating: options.quickRating ?? null,
    aspects: options.aspects ?? emptyAspects(),
    currentStep: 0,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  };
  if (options.editingEntryId) draft.editingEntryId = options.editingEntryId;
  return draft;
};

/** Every mutation bumps the revision — the emergency mirror compares on it. */
const advance = (draft: RatingDraft, patch: Partial<RatingDraft>): RatingDraft => ({
  ...draft,
  ...patch,
  updatedAt: nowIso(),
  revision: draft.revision + 1,
});

export const setMode = (draft: RatingDraft, mode: RatingMode): RatingDraft =>
  advance(draft, { mode, currentStep: 0 });

export const setQuickRating = (draft: RatingDraft, value: RatingValue): RatingDraft =>
  advance(draft, { quickRating: value });

export const setAspectRating = (
  draft: RatingDraft,
  aspectId: RatingAspectId,
  value: RatingValue,
): RatingDraft => advance(draft, { aspects: { ...draft.aspects, [aspectId]: value } });

/** The aspect a step points at. */
export const aspectOfStep = (step: number): RatingAspectId | null => aspectAtStep(step)?.id ?? null;

/** First step with no value yet — where a resumed draft should land. */
export const firstIncompleteStep = (aspects: AspectScores): number => {
  const index = ASPECT_IDS.findIndex((id) => aspects[id] === null);
  return index === -1 ? DEEP_STEP_COUNT - 1 : index;
};

/**
 * A step is reachable if it is already answered, or is the first unanswered
 * one. Future steps stay locked so none can be skipped (spec §22).
 */
export const canOpenStep = (draft: RatingDraft, step: number): boolean => {
  if (step < 0 || step >= DEEP_STEP_COUNT) return false;
  const aspectId = aspectOfStep(step);
  if (!aspectId) return false;
  if (draft.aspects[aspectId] !== null) return true;
  return firstIncompleteStep(draft.aspects) === step;
};

export const goToStep = (draft: RatingDraft, step: number): RatingDraft =>
  canOpenStep(draft, step) ? advance(draft, { currentStep: step }) : draft;

/** The result is reachable with a quick rating, or with all five aspects. */
export const canOpenResult = (draft: RatingDraft): boolean =>
  draft.mode === 'quick' ? draft.quickRating !== null : isComplete(draft.aspects);

/** What follows a committed value: the next step, or the result after the last. */
export const nextStep = (draft: RatingDraft): number | 'result' => {
  if (draft.mode === 'quick') return 'result';
  const aspectId = aspectOfStep(draft.currentStep);
  // An unanswered step cannot be left behind.
  if (!aspectId || draft.aspects[aspectId] === null) return draft.currentStep;
  const next = draft.currentStep + 1;
  return next >= DEEP_STEP_COUNT ? 'result' : next;
};

export type BackTarget =
  { kind: 'step'; step: number } | { kind: 'quick' } | { kind: 'mode' } | { kind: 'film' };

/**
 * Back semantics for both our own control and the Telegram BackButton
 * (spec §30). Back never destroys the draft.
 */
export const backTargetFrom = (
  draft: RatingDraft,
  screen: 'mode' | 'quick' | 'deep' | 'result',
): BackTarget => {
  if (screen === 'mode') return { kind: 'film' };
  if (screen === 'quick') return { kind: 'mode' };
  if (screen === 'result') {
    return draft.mode === 'quick' ? { kind: 'quick' } : { kind: 'step', step: DEEP_STEP_COUNT - 1 };
  }
  return draft.currentStep <= 0 ? { kind: 'mode' } : { kind: 'step', step: draft.currentStep - 1 };
};

/** True once the user has entered anything worth keeping. */
export const hasProgress = (draft: RatingDraft): boolean =>
  draft.quickRating !== null || ASPECT_IDS.some((id) => draft.aspects[id] !== null);

/** Human-readable progress for the conflict sheet and the diary draft card. */
export const draftProgressLabel = (draft: RatingDraft): string => {
  if (draft.mode === 'quick') {
    return draft.quickRating === null ? 'Оценка не выбрана' : 'Осталось сохранить';
  }
  if (draft.mode === 'deep') {
    const done = ASPECT_IDS.filter((id) => draft.aspects[id] !== null).length;
    return done === DEEP_STEP_COUNT ? 'Осталось сохранить' : `${done} из ${DEEP_STEP_COUNT}`;
  }
  return 'Режим не выбран';
};

export type ResumeTarget =
  | { screen: 'mode' }
  | { screen: 'quick' }
  | { screen: 'deep'; step: number }
  | { screen: 'result' };

/**
 * Where a restored draft should open. A draft whose stored step is no longer
 * supported by its data falls back to the first gap rather than to a broken
 * screen (spec §41).
 */
export const resumeTarget = (draft: RatingDraft): ResumeTarget => {
  if (!draft.mode) return { screen: 'mode' };
  // Quick always resumes on its own screen: the value is one tap from there,
  // and the result is a step forward rather than a place to be dropped into.
  if (draft.mode === 'quick') return { screen: 'quick' };
  if (isComplete(draft.aspects)) return { screen: 'result' };
  const step = canOpenStep(draft, draft.currentStep)
    ? draft.currentStep
    : firstIncompleteStep(draft.aspects);
  return { screen: 'deep', step };
};

/** The flow state a draft is in — exposed so the store never guesses. */
export const flowStateOf = (draft: RatingDraft | null): RatingFlowState => {
  if (!draft) return 'preparing';
  if (!draft.mode) return 'chooseMode';
  if (draft.mode === 'quick') return draft.quickRating === null ? 'quick' : 'result';
  return isComplete(draft.aspects) ? 'result' : 'deepStep';
};
