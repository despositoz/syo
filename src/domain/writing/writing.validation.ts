import { createId } from '@domain/rating/rating.validation';
import {
  ANSWER_LIMIT,
  TEXT_LIMIT,
  type AssistantCandidate,
  type AssistantRequestSnapshot,
  type ConversationState,
  type ConversationTurn,
  type TextRevision,
  type WritingDraft,
  type WritingMode,
  type WritingScreen,
} from './writing.types';

/**
 * Validation for stored writing drafts.
 *
 * Recovery, not rejection: a draft with one broken field keeps everything that
 * is still readable. Losing a paragraph the user typed because a timestamp was
 * malformed would be the worst possible trade.
 */

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const clampText = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.slice(0, limit) : '';

const isMode = (value: unknown): value is WritingMode =>
  value === null || value === 'free' || value === 'conversation';

const SCREENS: readonly WritingScreen[] = [
  'mode',
  'editor',
  'conversation',
  'processing',
  'aiResult',
  'preview',
];

const isScreen = (value: unknown): value is WritingScreen =>
  typeof value === 'string' && (SCREENS as readonly string[]).includes(value);

const parseRevision = (value: unknown): TextRevision | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const id = asString(source.id);
  if (!id) return null;
  if (typeof source.text !== 'string') return null;

  return {
    id,
    parentRevisionId: asString(source.parentRevisionId),
    kind: source.kind === 'assistant' ? 'assistant' : 'user',
    origin: (asString(source.origin) ?? 'manual') as TextRevision['origin'],
    text: clampText(source.text, TEXT_LIMIT),
    changeSummary: asString(source.changeSummary),
    createdAt: asString(source.createdAt) ?? new Date().toISOString(),
    promptVersion: asString(source.promptVersion),
    requestId: asString(source.requestId),
  };
};

const parseTurn = (value: unknown): ConversationTurn | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const questionId = asString(source.questionId);
  const questionText = asString(source.questionText);
  if (!questionId || !questionText) return null;

  const status = source.status;
  return {
    questionId,
    questionText,
    topic: asString(source.topic),
    leadIn: asString(source.leadIn),
    answerText:
      typeof source.answerText === 'string' ? clampText(source.answerText, ANSWER_LIMIT) : null,
    status: status === 'skipped' || status === 'replaced' ? status : 'answered',
    createdAt: asString(source.createdAt) ?? new Date().toISOString(),
    answeredAt: asString(source.answeredAt),
  };
};

const parseConversation = (value: unknown): ConversationState | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;

  const turns = Array.isArray(source.turns)
    ? source.turns.map(parseTurn).filter((turn): turn is ConversationTurn => turn !== null)
    : [];

  const question = source.currentQuestion as Record<string, unknown> | null | undefined;
  const questionId = question ? asString(question.questionId) : null;
  const questionText = question ? asString(question.question) : null;

  return {
    sessionId: asString(source.sessionId) ?? createId(),
    turns,
    currentQuestion:
      questionId && questionText
        ? {
            questionId,
            question: questionText,
            leadIn: asString(question?.leadIn),
            topic: asString(question?.topic),
            suggestFinish: question?.suggestFinish === true,
          }
        : null,
    selectedTopics: Array.isArray(source.selectedTopics)
      ? source.selectedTopics.filter((topic): topic is string => typeof topic === 'string')
      : [],
    skippedQuestionIds: Array.isArray(source.skippedQuestionIds)
      ? source.skippedQuestionIds.filter((id): id is string => typeof id === 'string')
      : [],
    replacedQuestionIds: Array.isArray(source.replacedQuestionIds)
      ? source.replacedQuestionIds.filter((id): id is string => typeof id === 'string')
      : [],
    // A status mid-flight cannot survive a restart: a request that was in the
    // air is gone, so the conversation resumes idle rather than pretending.
    status: source.status === 'complete' ? 'complete' : 'idle',
    completionReason:
      source.completionReason === 'enoughMaterial' ||
      source.completionReason === 'userFinished' ||
      source.completionReason === 'maxQuestions'
        ? source.completionReason
        : null,
  };
};

const parseCandidate = (value: unknown): AssistantCandidate | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const id = asString(source.id);
  const text = asString(source.text);
  const requestId = asString(source.requestId);
  if (!id || !text || !requestId) return null;

  return {
    id,
    baseRevisionId: asString(source.baseRevisionId),
    operation: (asString(source.operation) ?? 'collect') as AssistantCandidate['operation'],
    text: clampText(text, TEXT_LIMIT),
    changeSummary: asString(source.changeSummary) ?? '',
    promptVersion: asString(source.promptVersion) ?? 'unknown',
    requestId,
    createdAt: asString(source.createdAt) ?? new Date().toISOString(),
  };
};

const parsePendingRequest = (value: unknown): AssistantRequestSnapshot | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const requestId = asString(source.requestId);
  const operation = asString(source.operation);
  if (!requestId || !operation) return null;

  return {
    requestId,
    operation: operation as AssistantRequestSnapshot['operation'],
    baseRevision: typeof source.baseRevision === 'number' ? source.baseRevision : 0,
    baseRevisionId: asString(source.baseRevisionId),
    startedAt: asString(source.startedAt) ?? new Date().toISOString(),
  };
};

/**
 * Parses a stored writing draft. Returns null only when there is no entry to
 * attach the text to — then the draft has nothing to be about.
 */
export const parseWritingDraft = (value: unknown): WritingDraft | null => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  if (source.kind !== 'writing') return null;

  const entryId = asString(source.entryId);
  const filmId = Number(source.filmId);
  if (!entryId || !Number.isFinite(filmId) || filmId <= 0) return null;

  const film = (source.film ?? {}) as Record<string, unknown>;
  const filmTitle = asString(film.filmTitle) ?? asString(source.filmTitle);
  if (!filmTitle) return null;

  const revisions = Array.isArray(source.revisions)
    ? source.revisions
        .map(parseRevision)
        .filter((revision): revision is TextRevision => revision !== null)
    : [];

  const timestamp = new Date().toISOString();
  const draft: WritingDraft = {
    schemaVersion: 1,
    id: 'active',
    kind: 'writing',
    filmId,
    entryId,
    film: {
      filmId,
      filmTitle,
      posterPath: asString(film.posterPath),
      releaseYear: asString(film.releaseYear),
      dominantColor: asString(film.dominantColor),
    },
    mode: isMode(source.mode) ? source.mode : null,
    // A screen that only exists mid-request cannot be resumed into.
    currentScreen: isScreen(source.currentScreen) ? source.currentScreen : 'mode',
    workingText: clampText(source.workingText, TEXT_LIMIT),
    selectedRevisionId: asString(source.selectedRevisionId),
    revisions,
    conversation: parseConversation(source.conversation),
    // A request that was in flight when the app died is not in flight now.
    pendingAssistantRequest: parsePendingRequest(source.pendingAssistantRequest),
    assistantCandidate: parseCandidate(source.assistantCandidate),
    spoiler: source.spoiler === true,
    source: source.source === 'journalEntry' ? 'journalEntry' : 'ratingResult',
    createdAt: asString(source.createdAt) ?? timestamp,
    updatedAt: asString(source.updatedAt) ?? timestamp,
    revision: typeof source.revision === 'number' ? source.revision : 0,
  };

  if (typeof source.selectionStart === 'number') draft.selectionStart = source.selectionStart;
  if (typeof source.selectionEnd === 'number') draft.selectionEnd = source.selectionEnd;
  if (typeof source.editorScrollTop === 'number') draft.editorScrollTop = source.editorScrollTop;

  return draft;
};
