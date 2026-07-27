import { ASPECT_IDS, aspectIndex } from './rating.constants';
import { isComplete } from './rating.calculation';
import { createId } from './rating.validation';
import {
  emptyAspects,
  type AspectScores,
  type FilmSnapshot,
  type RatingAspectId,
  type RatingDraft,
  type RatingMode,
  type RatingValue,
} from './rating.types';

/**
 * Draft state machine (spec §5.3). Pure: every function takes a draft and
 * returns a new one. The current step lives here and in storage — never
 * inferred from the DOM.
 *
 *   IDLE → MODE_SELECT → QUICK_EDITING  → QUICK_RESULT    → SAVING → SAVED
 *   IDLE → MODE_SELECT → ASPECT_1..5    → DETAILED_RESULT → SAVING → SAVED
 */

export interface CreateDraftOptions {
  film: FilmSnapshot;
  mode: RatingMode;
  /** Set when editing an existing journal entry. */
  editingEntryId?: string;
  /** Existing values when editing — real data, not defaults. */
  quickScore?: RatingValue | null;
  aspects?: AspectScores;
  previousQuickScore?: RatingValue | null;
  now?: () => string;
}

const nowIso = () => new Date().toISOString();

/**
 * Created only *after* a mode is chosen — opening the selector and leaving
 * must not leave an empty draft behind (spec §12.2).
 */
export const createDraft = (options: CreateDraftOptions): RatingDraft => {
  const timestamp = (options.now ?? nowIso)();
  const aspects = options.aspects ?? emptyAspects();
  const draft: RatingDraft = {
    schemaVersion: 1,
    id: 'active',
    draftUuid: createId(),
    film: options.film,
    mode: options.mode,
    quickScore: options.quickScore ?? null,
    aspects,
    currentAspect: options.mode === 'detailed' ? (ASPECT_IDS[0] ?? null) : null,
    currentScreen: options.mode === 'quick' ? 'quick' : 'aspect',
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  };
  if (options.editingEntryId) draft.editingEntryId = options.editingEntryId;
  if (options.previousQuickScore !== undefined && options.previousQuickScore !== null) {
    draft.previousQuickScore = options.previousQuickScore;
  }
  return draft;
};

/** Every mutation bumps the revision — the emergency mirror compares on it. */
const advance = (draft: RatingDraft, patch: Partial<RatingDraft>): RatingDraft => ({
  ...draft,
  ...patch,
  updatedAt: nowIso(),
  revision: draft.revision + 1,
});

export const setQuickScore = (draft: RatingDraft, value: RatingValue): RatingDraft =>
  advance(draft, { quickScore: value });

export const setAspectScore = (
  draft: RatingDraft,
  aspectId: RatingAspectId,
  value: RatingValue,
): RatingDraft => advance(draft, { aspects: { ...draft.aspects, [aspectId]: value } });

/**
 * Switches a quick draft to the detailed flow, keeping the quick score only as
 * history: it is never fed into the detailed formula (spec §7.5).
 */
export const upgradeToDetailed = (draft: RatingDraft): RatingDraft =>
  advance(draft, {
    mode: 'detailed',
    previousQuickScore: draft.quickScore,
    quickScore: null,
    currentScreen: 'aspect',
    currentAspect: draft.currentAspect ?? ASPECT_IDS[0] ?? null,
  });

/** First aspect with no value yet — where a resumed draft should land. */
export const firstIncompleteAspect = (aspects: AspectScores): RatingAspectId | null =>
  ASPECT_IDS.find((id) => aspects[id] === null) ?? null;

/**
 * An aspect is reachable if it is completed, or is the first incomplete one.
 * Future aspects stay locked so none can be skipped (spec §8.5).
 */
export const canOpenAspect = (draft: RatingDraft, aspectId: RatingAspectId): boolean => {
  if (draft.aspects[aspectId] !== null) return true;
  return firstIncompleteAspect(draft.aspects) === aspectId;
};

export const goToAspect = (draft: RatingDraft, aspectId: RatingAspectId): RatingDraft => {
  if (!canOpenAspect(draft, aspectId)) return draft;
  return advance(draft, { currentAspect: aspectId, currentScreen: 'aspect' });
};

/** Result is reachable only with a confirmed quick score or all five aspects. */
export const canOpenResult = (draft: RatingDraft): boolean =>
  draft.mode === 'quick' ? draft.quickScore !== null : isComplete(draft.aspects);

export const goToResult = (draft: RatingDraft): RatingDraft =>
  canOpenResult(draft) ? advance(draft, { currentScreen: 'result' }) : draft;

/**
 * What follows a committed value: the next aspect, or the result once the last
 * one is filled.
 */
export const nextStep = (draft: RatingDraft): RatingDraft => {
  if (draft.mode === 'quick') return goToResult(draft);
  const current = draft.currentAspect;
  if (!current) return draft;

  const next = ASPECT_IDS[aspectIndex(current) + 1];
  if (!next) return goToResult(draft);
  if (draft.aspects[current] === null) return draft; // cannot skip an unrated aspect
  return advance(draft, { currentAspect: next, currentScreen: 'aspect' });
};

export type BackTarget =
  | { kind: 'aspect'; aspectId: RatingAspectId }
  | { kind: 'quick' }
  | { kind: 'mode' }
  | { kind: 'film' };

/**
 * Back semantics for both our own control and the Telegram BackButton
 * (spec §20.9). Draft is never destroyed by going back.
 */
export const backTarget = (draft: RatingDraft): BackTarget => {
  if (draft.currentScreen === 'result') {
    if (draft.mode === 'quick') return { kind: 'quick' };
    const last = ASPECT_IDS[ASPECT_IDS.length - 1];
    return last ? { kind: 'aspect', aspectId: last } : { kind: 'mode' };
  }
  if (draft.currentScreen === 'quick') return { kind: 'mode' };

  const current = draft.currentAspect;
  if (!current) return { kind: 'mode' };
  const previous = ASPECT_IDS[aspectIndex(current) - 1];
  return previous ? { kind: 'aspect', aspectId: previous } : { kind: 'mode' };
};

export const goBack = (draft: RatingDraft): RatingDraft => {
  const target = backTarget(draft);
  switch (target.kind) {
    case 'aspect':
      return advance(draft, { currentAspect: target.aspectId, currentScreen: 'aspect' });
    case 'quick':
      return advance(draft, { currentScreen: 'quick' });
    case 'mode':
    case 'film':
      return draft;
  }
};

/** True once the user has entered anything worth keeping. */
export const hasProgress = (draft: RatingDraft): boolean =>
  draft.quickScore !== null || ASPECT_IDS.some((id) => draft.aspects[id] !== null);

/**
 * Where a restored draft should open. A stored 'result' that is no longer
 * reachable (data lost, older build) falls back to the first gap rather than
 * showing a broken result screen (spec §5.7).
 */
export const resumeTarget = (
  draft: RatingDraft,
): { screen: 'quick' | 'result'; aspectId?: undefined } | { screen: 'aspect'; aspectId: RatingAspectId } => {
  if (draft.currentScreen === 'result' && canOpenResult(draft)) return { screen: 'result' };
  if (draft.mode === 'quick') return { screen: 'quick' };

  const aspectId =
    (draft.currentAspect && canOpenAspect(draft, draft.currentAspect) ? draft.currentAspect : null) ??
    firstIncompleteAspect(draft.aspects) ??
    ASPECT_IDS[0];

  return aspectId ? { screen: 'aspect', aspectId } : { screen: 'quick' };
};
