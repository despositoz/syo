import type { RatingDraft } from '@domain/rating/rating.types';

/**
 * Writing domain types (spec §7).
 *
 * The user's own words are the source of truth. Every assistant result is a
 * *candidate* until explicitly accepted, and the original is never destroyed —
 * that is what the revision list is for.
 */

export type WritingMode = null | 'free' | 'conversation';

export type WritingScreen =
  | 'mode'
  | 'editor'
  | 'conversation'
  | 'processing'
  | 'aiResult'
  | 'preview';

/** Operations the assistant can perform (spec §15). */
export type AssistantOperation =
  | 'nextQuestion'
  | 'replaceQuestion'
  | 'composeConversation'
  | 'collect'
  | 'correct'
  | 'shorten'
  | 'connect';

/** Text-producing operations — the ones that yield a candidate. */
export type TextOperation = Exclude<AssistantOperation, 'nextQuestion' | 'replaceQuestion'>;

export type RevisionOrigin = 'manual' | TextOperation;

export interface TextRevision {
  id: string;
  parentRevisionId: string | null;
  kind: 'user' | 'assistant';
  origin: RevisionOrigin;
  text: string;
  changeSummary: string | null;
  createdAt: string;
  promptVersion: string | null;
  requestId: string | null;
}

export interface ConversationQuestion {
  questionId: string;
  question: string;
  leadIn: string | null;
  topic: string | null;
  suggestFinish: boolean;
}

export interface ConversationTurn {
  questionId: string;
  questionText: string;
  topic: string | null;
  leadIn: string | null;
  /** The user's exact words. Never overwritten by composed text (§7.4). */
  answerText: string | null;
  status: 'answered' | 'skipped' | 'replaced';
  createdAt: string;
  answeredAt: string | null;
}

export type ConversationStatus =
  | 'idle'
  | 'loadingQuestion'
  | 'answering'
  | 'readyToCompose'
  | 'composing'
  | 'complete'
  | 'error';

export type CompletionReason = 'enoughMaterial' | 'userFinished' | 'maxQuestions' | null;

export interface ConversationState {
  sessionId: string;
  turns: ConversationTurn[];
  currentQuestion: ConversationQuestion | null;
  selectedTopics: string[];
  skippedQuestionIds: string[];
  replacedQuestionIds: string[];
  status: ConversationStatus;
  completionReason: CompletionReason;
}

export interface AssistantCandidate {
  id: string;
  baseRevisionId: string | null;
  operation: TextOperation;
  text: string;
  changeSummary: string;
  promptVersion: string;
  requestId: string;
  createdAt: string;
}

/**
 * What was asked for, kept so a late response can be recognised as stale
 * (spec §20.5) and so a retry reuses the same logical request.
 */
export interface AssistantRequestSnapshot {
  requestId: string;
  operation: AssistantOperation;
  /** Draft revision the request was built from. */
  baseRevision: number;
  baseRevisionId: string | null;
  startedAt: string;
}

/** Film context the writing flow carries, captured once so it works offline. */
export interface WritingFilmSummary {
  filmId: number;
  filmTitle: string;
  posterPath: string | null;
  releaseYear: string | null;
  dominantColor?: string | null;
}

export interface WritingDraft {
  schemaVersion: 1;
  id: 'active';
  kind: 'writing';

  filmId: number;
  /** The entry this text belongs to. Writing never creates a second one. */
  entryId: string;
  film: WritingFilmSummary;

  mode: WritingMode;
  currentScreen: WritingScreen;

  workingText: string;
  selectedRevisionId: string | null;
  revisions: TextRevision[];

  conversation: ConversationState | null;
  pendingAssistantRequest: AssistantRequestSnapshot | null;
  assistantCandidate: AssistantCandidate | null;

  spoiler: boolean;
  source: 'ratingResult' | 'journalEntry';

  /** Optional recovery metadata — not part of the saved entry (§7.6). */
  selectionStart?: number;
  selectionEnd?: number;
  editorScrollTop?: number;

  createdAt: string;
  updatedAt: string;
  revision: number;
}

/**
 * Exactly one draft exists at a time, of either kind (spec §6.1).
 * A rating draft carries no `kind`, so the discriminator is its absence.
 */
export type ActiveDraft = RatingDraft | WritingDraft;

export const isWritingDraft = (draft: ActiveDraft | null): draft is WritingDraft =>
  draft !== null && (draft as WritingDraft).kind === 'writing';

export const isRatingDraft = (draft: ActiveDraft | null): draft is RatingDraft =>
  draft !== null && (draft as WritingDraft).kind !== 'writing';

/** Technical ceiling on a single text (spec §10.5). */
export const TEXT_LIMIT = 30_000;
export const TEXT_WARN_AT = 27_000;
/** Ceiling on one conversation answer (spec §13.9). */
export const ANSWER_LIMIT = 4_000;
/** Beyond this the conversation offers to compose instead of asking on (§13.6). */
export const MAX_ANSWERED_QUESTIONS = 5;
