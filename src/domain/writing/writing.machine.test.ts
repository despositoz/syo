import { describe, expect, it } from 'vitest';
import {
  acceptCandidate,
  addRevision,
  answeredTurns,
  canCompose,
  commitAnswer,
  createWritingDraft,
  editCandidateManually,
  isCandidateFresh,
  keepOriginal,
  setQuestion,
  setWorkingText,
  setWritingMode,
  shouldOfferCompose,
  skipQuestion,
  startConversation,
  storeCandidate,
  writingProgressLabel,
  writingResumeTarget,
} from './writing.machine';
import { MAX_ANSWERED_QUESTIONS, TEXT_LIMIT, type AssistantCandidate } from './writing.types';

const draft = () =>
  createWritingDraft({
    entryId: 'entry-1',
    film: { filmId: 7, filmTitle: 'Фильм', posterPath: null, releaseYear: '2024' },
    source: 'ratingResult',
  });

const question = (id: string, suggestFinish = false) => ({
  questionId: id,
  question: `Вопрос ${id}`,
  leadIn: null,
  topic: null,
  suggestFinish,
});

describe('writing draft', () => {
  it('starts with no mode and nothing written', () => {
    const created = draft();
    expect(created.mode).toBeNull();
    expect(created.workingText).toBe('');
    expect(writingResumeTarget(created)).toEqual({ screen: 'mode' });
  });

  it('keeps the text when the mode changes', () => {
    const typed = setWorkingText(setWritingMode(draft(), 'free'), 'Мой текст');
    const switched = setWritingMode(typed, 'conversation');
    expect(switched.workingText).toBe('Мой текст');
  });

  it('never stores more than the technical limit', () => {
    const long = setWorkingText(draft(), 'а'.repeat(TEXT_LIMIT + 500));
    expect(long.workingText).toHaveLength(TEXT_LIMIT);
  });

  it('bumps the revision counter on every commit, so stale writes lose', () => {
    const first = setWorkingText(draft(), 'раз');
    const second = setWorkingText(first, 'два');
    expect(second.revision).toBe(first.revision + 1);
  });
});

describe('revisions', () => {
  it('adds a revision for changed text', () => {
    const typed = setWorkingText(draft(), 'Первая версия');
    const { draft: next, revision } = addRevision(typed, {
      text: typed.workingText,
      kind: 'user',
      origin: 'manual',
    });

    expect(revision).not.toBeNull();
    expect(next.revisions).toHaveLength(1);
    expect(next.selectedRevisionId).toBe(revision?.id);
  });

  it('does not add a second revision for identical text', () => {
    const typed = setWorkingText(draft(), 'Одно и то же');
    const { draft: once } = addRevision(typed, {
      text: typed.workingText,
      kind: 'user',
      origin: 'manual',
    });
    const { draft: twice, revision } = addRevision(once, {
      text: typed.workingText,
      kind: 'user',
      origin: 'manual',
    });

    expect(revision).toBeNull();
    expect(twice.revisions).toHaveLength(1);
  });
});

describe('assistant candidates', () => {
  const candidate = (overrides: Partial<AssistantCandidate> = {}): AssistantCandidate => ({
    id: 'cand-1',
    baseRevisionId: null,
    operation: 'correct',
    text: 'Исправленный текст',
    changeSummary: 'Поправил опечатки',
    promptVersion: 'v1',
    requestId: 'req-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const waiting = () => ({
    ...setWorkingText(draft(), 'Оригинал'),
    pendingAssistantRequest: {
      requestId: 'req-1',
      operation: 'correct' as const,
      baseRevision: 1,
      baseRevisionId: null,
      startedAt: new Date().toISOString(),
    },
  });

  it('rejects a response to a request nobody is waiting for', () => {
    expect(isCandidateFresh(draft(), candidate())).toBe(false);
  });

  it('rejects a response built on a different revision', () => {
    expect(isCandidateFresh(waiting(), candidate({ baseRevisionId: 'other' }))).toBe(false);
  });

  it('accepts the response to the request in flight', () => {
    expect(isCandidateFresh(waiting(), candidate())).toBe(true);
  });

  it('accepting keeps the original as its own revision', () => {
    const withOriginal = addRevision(waiting(), {
      text: 'Оригинал',
      kind: 'user',
      origin: 'manual',
    }).draft;
    const shown = storeCandidate(withOriginal, candidate());
    const accepted = acceptCandidate(shown);

    expect(accepted.workingText).toBe('Исправленный текст');
    expect(accepted.revisions).toHaveLength(2);
    expect(accepted.revisions[0]?.text).toBe('Оригинал');
    expect(accepted.assistantCandidate).toBeNull();
  });

  it('keeping the original changes nothing about the text', () => {
    const shown = storeCandidate(waiting(), candidate());
    const kept = keepOriginal(shown);
    expect(kept.workingText).toBe('Оригинал');
    expect(kept.revisions).toHaveLength(0);
  });

  it('editing manually loads the candidate without saving it', () => {
    const shown = storeCandidate(waiting(), candidate());
    const editing = editCandidateManually(shown);
    expect(editing.workingText).toBe('Исправленный текст');
    // Not a revision yet: nothing was accepted.
    expect(editing.revisions).toHaveLength(0);
  });
});

describe('conversation', () => {
  const answer = (state: ReturnType<typeof draft>, id: string) =>
    commitAnswer(setQuestion(startConversation(state), question(id)), `Ответ ${id}`);

  it('stores the answer exactly as typed', () => {
    const answered = answer(draft(), 'q1');
    expect(answered.conversation?.turns[0]?.answerText).toBe('Ответ q1');
    expect(answeredTurns(answered)).toHaveLength(1);
  });

  it('a skip is not an empty opinion', () => {
    const skipped = skipQuestion(setQuestion(startConversation(draft()), question('q1')));
    expect(skipped.conversation?.turns[0]?.status).toBe('skipped');
    expect(skipped.conversation?.turns[0]?.answerText).toBeNull();
    expect(answeredTurns(skipped)).toHaveLength(0);
  });

  it('will not compose from nothing', () => {
    expect(canCompose(startConversation(draft()))).toBe(false);
    expect(canCompose(answer(draft(), 'q1'))).toBe(true);
  });

  it('offers to finish once there is enough material', () => {
    let state = draft();
    for (let index = 0; index < MAX_ANSWERED_QUESTIONS; index += 1) {
      state = answer(state, `q${index}`);
    }
    expect(shouldOfferCompose(state)).toBe(true);
  });
});

describe('resume', () => {
  it('never resumes into a request that is long gone', () => {
    const processing = { ...setWritingMode(draft(), 'free'), currentScreen: 'processing' as const };
    expect(writingResumeTarget(processing)).toEqual({ screen: 'editor' });
  });

  it('describes what is left in words, never in step numbers', () => {
    expect(writingProgressLabel(draft())).toBe('Выбери способ');
    const typed = setWorkingText(setWritingMode(draft(), 'free'), 'Текст');
    expect(writingProgressLabel(typed)).toBe('Осталось сохранить');
  });
});
