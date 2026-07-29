import { createId } from '@domain/rating/rating.validation';
import {
  MAX_ANSWERED_QUESTIONS,
  TEXT_LIMIT,
  type AssistantCandidate,
  type AssistantOperation,
  type AssistantRequestSnapshot,
  type ConversationQuestion,
  type ConversationState,
  type TextRevision,
  type WritingDraft,
  type WritingFilmSummary,
  type WritingMode,
  type WritingScreen,
} from './writing.types';

/**
 * Writing draft state machine (spec §31). Pure: every function takes a draft
 * and returns a new one. Nothing here touches storage, network or React.
 */

export interface CreateWritingDraftOptions {
  entryId: string;
  film: WritingFilmSummary;
  source: 'ratingResult' | 'journalEntry';
  /** Text already saved on the entry, when editing rather than starting fresh. */
  initialText?: string;
  initialRevisions?: TextRevision[];
  selectedRevisionId?: string | null;
  now?: () => string;
}

const nowIso = () => new Date().toISOString();

export const createWritingDraft = (options: CreateWritingDraftOptions): WritingDraft => {
  const timestamp = (options.now ?? nowIso)();
  return {
    schemaVersion: 1,
    id: 'active',
    kind: 'writing',
    filmId: options.film.filmId,
    entryId: options.entryId,
    film: options.film,
    mode: null,
    currentScreen: 'mode',
    workingText: options.initialText ?? '',
    selectedRevisionId: options.selectedRevisionId ?? null,
    revisions: options.initialRevisions ?? [],
    conversation: null,
    pendingAssistantRequest: null,
    assistantCandidate: null,
    spoiler: false,
    source: options.source,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  };
};

/** Every mutation bumps the revision — stale writes are rejected by it. */
const advance = (draft: WritingDraft, patch: Partial<WritingDraft>): WritingDraft => ({
  ...draft,
  ...patch,
  updatedAt: nowIso(),
  revision: draft.revision + 1,
});

export const setScreen = (draft: WritingDraft, screen: WritingScreen): WritingDraft =>
  advance(draft, { currentScreen: screen });

/**
 * Switching mode never destroys what the other mode produced: the manual text
 * and the raw answers both survive (spec §9.6).
 */
export const setWritingMode = (draft: WritingDraft, mode: WritingMode): WritingDraft =>
  advance(draft, {
    mode,
    currentScreen: mode === 'free' ? 'editor' : mode === 'conversation' ? 'conversation' : 'mode',
  });

export const setWorkingText = (draft: WritingDraft, text: string): WritingDraft =>
  advance(draft, { workingText: text.slice(0, TEXT_LIMIT) });

export const rememberSelection = (
  draft: WritingDraft,
  selection: { start: number; end: number; scrollTop?: number },
): WritingDraft => ({
  ...draft,
  selectionStart: selection.start,
  selectionEnd: selection.end,
  ...(selection.scrollTop === undefined ? {} : { editorScrollTop: selection.scrollTop }),
});

/* --- revisions -------------------------------------------------------- */

export interface AddRevisionOptions {
  text: string;
  kind: 'user' | 'assistant';
  origin: TextRevision['origin'];
  changeSummary?: string | null;
  promptVersion?: string | null;
  requestId?: string | null;
  parentRevisionId?: string | null;
}

/**
 * Appends a revision *only when the text actually changed* (spec §8.3): a
 * revision per keystroke, or per open-and-close, would turn history into noise.
 */
export const addRevision = (
  draft: WritingDraft,
  options: AddRevisionOptions,
): { draft: WritingDraft; revision: TextRevision | null } => {
  const current = draft.revisions.find((item) => item.id === draft.selectedRevisionId);
  if (current && current.text === options.text) return { draft, revision: null };

  const revision: TextRevision = {
    id: createId(),
    parentRevisionId: options.parentRevisionId ?? draft.selectedRevisionId,
    kind: options.kind,
    origin: options.origin,
    text: options.text.slice(0, TEXT_LIMIT),
    changeSummary: options.changeSummary ?? null,
    createdAt: nowIso(),
    promptVersion: options.promptVersion ?? null,
    requestId: options.requestId ?? null,
  };

  return {
    draft: advance(draft, {
      revisions: [...draft.revisions, revision],
      selectedRevisionId: revision.id,
      workingText: revision.text,
    }),
    revision,
  };
};

/* --- assistant -------------------------------------------------------- */

/**
 * Records what was asked for, before anything leaves the device. A response
 * that does not match this snapshot is stale and never reaches the editor.
 */
export const beginAssistantRequest = (
  draft: WritingDraft,
  request: AssistantRequestSnapshot,
): WritingDraft => advance(draft, { pendingAssistantRequest: request });

/** The snapshot for an operation about to be sent. */
export const requestSnapshot = (
  draft: WritingDraft,
  operation: AssistantOperation,
  requestId: string,
): AssistantRequestSnapshot => ({
  requestId,
  operation,
  baseRevision: draft.revision,
  baseRevisionId: draft.selectedRevisionId,
  startedAt: nowIso(),
});

/**
 * A candidate is accepted only when it answers the request we are still
 * waiting for, from the revision it was built on (spec §20.5).
 */
export const isCandidateFresh = (draft: WritingDraft, candidate: AssistantCandidate): boolean => {
  const pending = draft.pendingAssistantRequest;
  if (!pending) return false;
  if (pending.requestId !== candidate.requestId) return false;
  return pending.baseRevisionId === candidate.baseRevisionId;
};

export const storeCandidate = (draft: WritingDraft, candidate: AssistantCandidate): WritingDraft =>
  advance(draft, {
    assistantCandidate: candidate,
    pendingAssistantRequest: null,
    currentScreen: 'aiResult',
  });

export const clearPendingRequest = (draft: WritingDraft): WritingDraft =>
  advance(draft, { pendingAssistantRequest: null });

/** "Принять": the candidate becomes the working text and its own revision. */
export const acceptCandidate = (draft: WritingDraft): WritingDraft => {
  const candidate = draft.assistantCandidate;
  if (!candidate) return draft;

  /*
   * The user's own words become a revision first. Typing alone creates no
   * revision, so without this the moment of accepting a suggestion would be
   * the moment the original stopped existing — and it must always be
   * reachable (spec §2.3).
   */
  const withOriginal = draft.workingText.trim()
    ? addRevision(draft, { text: draft.workingText, kind: 'user', origin: 'manual' }).draft
    : draft;

  const { draft: next } = addRevision(withOriginal, {
    text: candidate.text,
    kind: 'assistant',
    origin: candidate.operation,
    changeSummary: candidate.changeSummary,
    promptVersion: candidate.promptVersion,
    requestId: candidate.requestId,
  });
  return advance(next, { assistantCandidate: null, currentScreen: 'editor' });
};

/**
 * "Оставить оригинал": the working text is untouched, and the candidate stays
 * in the draft as the last thing SYO proposed (spec §21.6).
 */
export const keepOriginal = (draft: WritingDraft): WritingDraft =>
  advance(draft, { currentScreen: 'editor' });

/** "Редактировать вручную": the candidate becomes editable text, unsaved. */
export const editCandidateManually = (draft: WritingDraft): WritingDraft => {
  const candidate = draft.assistantCandidate;
  if (!candidate) return draft;
  return advance(draft, { workingText: candidate.text, currentScreen: 'editor' });
};

/* --- conversation ----------------------------------------------------- */

export const startConversation = (draft: WritingDraft): WritingDraft =>
  advance(draft, {
    conversation: draft.conversation ?? {
      sessionId: createId(),
      turns: [],
      currentQuestion: null,
      selectedTopics: [],
      skippedQuestionIds: [],
      replacedQuestionIds: [],
      status: 'idle',
      completionReason: null,
    },
    currentScreen: 'conversation',
  });

const withConversation = (draft: WritingDraft, patch: Partial<ConversationState>): WritingDraft => {
  if (!draft.conversation) return draft;
  return advance(draft, { conversation: { ...draft.conversation, ...patch } });
};

export const setConversationStatus = (
  draft: WritingDraft,
  status: ConversationState['status'],
): WritingDraft => withConversation(draft, { status });

export const setQuestion = (draft: WritingDraft, question: ConversationQuestion): WritingDraft =>
  withConversation(draft, { currentQuestion: question, status: 'answering' });

export const toggleTopic = (draft: WritingDraft, topic: string): WritingDraft => {
  const current = draft.conversation?.selectedTopics ?? [];
  return withConversation(draft, {
    selectedTopics: current.includes(topic)
      ? current.filter((item) => item !== topic)
      : [...current, topic],
  });
};

/** The user's exact words, stored before any request goes out (spec §13.10). */
export const commitAnswer = (draft: WritingDraft, answer: string): WritingDraft => {
  const conversation = draft.conversation;
  const question = conversation?.currentQuestion;
  if (!conversation || !question) return draft;

  return withConversation(draft, {
    turns: [
      ...conversation.turns,
      {
        questionId: question.questionId,
        questionText: question.question,
        topic: question.topic,
        leadIn: question.leadIn,
        answerText: answer,
        status: 'answered',
        createdAt: new Date().toISOString(),
        answeredAt: new Date().toISOString(),
      },
    ],
    currentQuestion: null,
    status: 'idle',
  });
};

export const skipQuestion = (draft: WritingDraft): WritingDraft => {
  const conversation = draft.conversation;
  const question = conversation?.currentQuestion;
  if (!conversation || !question) return draft;

  return withConversation(draft, {
    turns: [
      ...conversation.turns,
      {
        questionId: question.questionId,
        questionText: question.question,
        topic: question.topic,
        leadIn: question.leadIn,
        // A skip is not an empty opinion: nothing is sent as the user's words.
        answerText: null,
        status: 'skipped',
        createdAt: new Date().toISOString(),
        answeredAt: null,
      },
    ],
    currentQuestion: null,
    skippedQuestionIds: [...conversation.skippedQuestionIds, question.questionId],
    status: 'idle',
  });
};

export const replaceQuestion = (draft: WritingDraft): WritingDraft => {
  const conversation = draft.conversation;
  const question = conversation?.currentQuestion;
  if (!conversation || !question) return draft;

  return withConversation(draft, {
    currentQuestion: null,
    replacedQuestionIds: [...conversation.replacedQuestionIds, question.questionId],
    status: 'idle',
  });
};

export const answeredTurns = (draft: WritingDraft) =>
  (draft.conversation?.turns ?? []).filter(
    (turn) => turn.status === 'answered' && turn.answerText?.trim(),
  );

/** Enough said: past this the flow offers to compose rather than ask on. */
export const shouldOfferCompose = (draft: WritingDraft): boolean => {
  const answered = answeredTurns(draft).length;
  if (answered >= MAX_ANSWERED_QUESTIONS) return true;
  return draft.conversation?.currentQuestion?.suggestFinish === true && answered >= 1;
};

/** Composing from nothing would be inventing an opinion (spec §13.10). */
export const canCompose = (draft: WritingDraft): boolean => answeredTurns(draft).length >= 1;

/* --- resume ----------------------------------------------------------- */

export type WritingResumeTarget =
  | { screen: 'mode' }
  | { screen: 'editor' }
  | { screen: 'conversation' }
  | { screen: 'aiResult' }
  | { screen: 'preview' };

/**
 * Where a restored writing draft opens. Screens that only exist mid-request
 * (`processing`) are never resumed into: the request is long gone.
 */
export const writingResumeTarget = (draft: WritingDraft): WritingResumeTarget => {
  if (!draft.mode) return { screen: 'mode' };
  if (draft.currentScreen === 'aiResult' && draft.assistantCandidate) return { screen: 'aiResult' };
  if (draft.currentScreen === 'preview' && draft.workingText.trim()) return { screen: 'preview' };
  if (draft.mode === 'conversation' && draft.currentScreen === 'conversation') {
    return { screen: 'conversation' };
  }
  return { screen: 'editor' };
};

/** Words for the diary draft card — never "conversationStep=2" (spec §6.8). */
export const writingProgressLabel = (draft: WritingDraft): string => {
  if (!draft.mode) return 'Выбери способ';
  if (draft.assistantCandidate) return 'Осталось проверить текст';
  if (draft.mode === 'conversation' && !draft.workingText.trim()) {
    return answeredTurns(draft).length ? 'Ответы сохранены' : 'Выбери способ';
  }
  return draft.workingText.trim() ? 'Осталось сохранить' : 'Текст сохраняется';
};
