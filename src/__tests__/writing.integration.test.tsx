import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTelegramFake,
  detailsFixture,
  installFetchMock,
  renderApp,
  resetAppState,
} from './harness';
import { db } from '@shared/storage/db';
import { emptyFilm } from '@entities/film/film.model';
import { writeFilmToCache } from '@entities/film/film.cache';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { useWritingStore } from '@features/writing/model/writing.store';
import { useRatingStore } from '@features/rating/model/rating.store';
import { requestWritingDraft } from '@features/drafts/draftCoordinator';
import { setAssistantGateway } from '@features/writing/gateway/assistantGateway.instance';
import {
  AssistantError,
  type AssistantGateway,
  type AssistantRequest,
  type AssistantResult,
} from '@features/writing/gateway/assistant.gateway';
import { selectedText } from '@domain/diary/diary.text';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { emptyAspects } from '@domain/rating/rating.types';

const FILM_ID = 202;
const ENTRY_ID = 'entry-writing';

const entry = (overrides: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: ENTRY_ID,
  filmId: FILM_ID,
  filmTitle: 'Долгая дорога',
  posterPath: '/poster-202.jpg',
  releaseYear: '2022',
  mode: 'quick',
  overallRating: 4,
  preciseRating: 4,
  aspects: emptyAspects(),
  hasText: false,
  text: null,
  watchedAt: '2026-07-20T10:00:00.000Z',
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  clientMutationId: 'mut-writing',
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

/** Puts a saved rating in place: text is always added to an existing entry. */
const seedEntry = async (overrides: Partial<DiaryEntry> = {}) => {
  await db.diaryEntries.put(entry(overrides));
  await writeFilmToCache({
    ...emptyFilm(FILM_ID, 'Долгая дорога'),
    year: '2022',
    posterPath: '/poster-202.jpg',
    detailed: true,
  });
  await useDiaryStore.getState().hydrate();
};

const startWriting = async () => {
  const outcome = await requestWritingDraft({
    entryId: ENTRY_ID,
    film: {
      filmId: FILM_ID,
      filmTitle: 'Долгая дорога',
      posterPath: '/poster-202.jpg',
      releaseYear: '2022',
    },
    source: 'journalEntry',
  });
  if (outcome.kind === 'conflict') throw new Error('unexpected conflict');
  useWritingStore.setState({ hydrated: true });
};

beforeEach(async () => {
  await resetAppState();
  installFetchMock({ details: { [FILM_ID]: detailsFixture(FILM_ID) } });
  await seedEntry();
});

describe('writing a text without any assistant', () => {
  it('writes, previews and saves the text onto the entry', async () => {
    const user = userEvent.setup();
    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });

    await user.click(await screen.findByTestId('writing-mode-free'));

    const area = await screen.findByTestId('writing-textarea');
    await user.type(area, 'Фильм оставил тишину, которую не хочется нарушать.');

    await user.click(await screen.findByTestId('writing-to-preview'));
    expect(await screen.findByTestId('writing-preview-text')).toHaveTextContent(
      'Фильм оставил тишину',
    );

    await user.click(await screen.findByTestId('writing-save'));

    await waitFor(() => {
      const saved = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID);
      expect(saved?.hasText).toBe(true);
    });

    const saved = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID)!;
    expect(selectedText(saved.text)).toContain('не хочется нарушать');
    // The rating it belongs to is untouched.
    expect(saved.overallRating).toBe(4);
    expect(saved.mode).toBe('quick');
    // The draft is gone from both layers once the text is saved.
    await waitFor(() => expect(useWritingStore.getState().draft).toBeNull());
    expect(await db.ratingDrafts.count()).toBe(0);
  });

  it('keeps what was typed when the app is reopened', async () => {
    const user = userEvent.setup();
    await startWriting();
    const first = renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });

    await user.click(await screen.findByTestId('writing-mode-free'));
    await user.type(await screen.findByTestId('writing-textarea'), 'Незаконченная мысль');
    await useWritingStore.getState().flush();
    first.unmount();

    // A cold start reads the draft back from storage, not from memory.
    useWritingStore.setState({ draft: null, hydrated: false });
    await useWritingStore.getState().hydrate();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/editor` });

    expect(await screen.findByTestId('writing-textarea')).toHaveValue('Незаконченная мысль');
  });

  it('an empty text is not saved as a text', async () => {
    const user = userEvent.setup();
    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });

    await user.click(await screen.findByTestId('writing-mode-free'));
    await user.type(await screen.findByTestId('writing-textarea'), '   ');

    // Nothing to preview: the way on is closed until there are words.
    expect(await screen.findByTestId('writing-to-preview')).toBeDisabled();
  });
});

describe('a saved text', () => {
  it('shows on the entry and can be removed with Undo', async () => {
    const user = userEvent.setup();
    await db.diaryEntries.clear();
    await seedEntry({
      hasText: true,
      text: {
        selectedRevisionId: 'rev-1',
        revisions: [
          {
            id: 'rev-1',
            parentRevisionId: null,
            kind: 'user',
            origin: 'manual',
            text: 'Сохранённый текст о фильме',
            changeSummary: null,
            createdAt: '2026-07-20T10:00:00.000Z',
            promptVersion: null,
            requestId: null,
          },
        ],
        conversation: null,
        spoiler: false,
      },
    });

    renderApp({ telegram: createTelegramFake(), path: `/diary/${ENTRY_ID}` });

    expect(await screen.findByTestId('entry-text-body')).toHaveTextContent(
      'Сохранённый текст о фильме',
    );

    await user.click(await screen.findByTestId('entry-menu'));
    await user.click(await screen.findByTestId('entry-delete-text'));

    await waitFor(() => {
      const updated = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID);
      expect(updated?.hasText).toBe(false);
    });
    // The rating survived the text being deleted.
    expect(
      useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID)?.overallRating,
    ).toBe(4);

    await user.click(await screen.findByRole('button', { name: 'Вернуть' }));

    await waitFor(() => {
      const restored = useDiaryStore.getState().entries.find((item) => item.id === ENTRY_ID);
      expect(selectedText(restored?.text ?? null)).toBe('Сохранённый текст о фильме');
    });
  });

  it('hides a spoiler text until it is asked for', async () => {
    const user = userEvent.setup();
    await db.diaryEntries.clear();
    await seedEntry({
      hasText: true,
      text: {
        selectedRevisionId: 'rev-1',
        revisions: [
          {
            id: 'rev-1',
            parentRevisionId: null,
            kind: 'user',
            origin: 'manual',
            text: 'В финале все умирают',
            changeSummary: null,
            createdAt: '2026-07-20T10:00:00.000Z',
            promptVersion: null,
            requestId: null,
          },
        ],
        conversation: null,
        spoiler: true,
      },
    });

    renderApp({ telegram: createTelegramFake(), path: `/diary/${ENTRY_ID}` });

    expect(screen.queryByText('В финале все умирают')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('entry-text-reveal'));
    expect(await screen.findByTestId('entry-text-body')).toHaveTextContent('В финале все умирают');
  });
});

describe('one draft at a time', () => {
  it('asks before a rating replaces an unfinished text', async () => {
    const user = userEvent.setup();
    await startWriting();
    useWritingStore.getState().setText('Черновик, который жалко');
    await useWritingStore.getState().flush();

    renderApp({ telegram: createTelegramFake(), path: `/diary/${ENTRY_ID}` });
    await user.click(await screen.findByTestId('entry-menu'));
    await user.click(await screen.findByTestId('entry-edit'));

    // The text is still there and no rating draft was created behind its back.
    expect(await screen.findByTestId('conflict-discard')).toBeInTheDocument();
    expect(useWritingStore.getState().draft?.workingText).toBe('Черновик, который жалко');
    expect(useRatingStore.getState().draft).toBeNull();
  });
});

describe('SYO helps with the text', () => {
  /** A gateway that answers whatever the test tells it to. */
  class StubGateway implements AssistantGateway {
    seen: AssistantRequest[] = [];
    constructor(private readonly reply: (request: AssistantRequest) => Promise<AssistantResult>) {}
    async send(request: AssistantRequest): Promise<AssistantResult> {
      this.seen.push(request);
      return this.reply(request);
    }
  }

  const textResult =
    (text: string, changeSummary = 'Поправил опечатки') =>
    async (request: AssistantRequest): Promise<AssistantResult> => ({
      kind: 'text',
      requestId: request.requestId,
      promptVersion: 'correct-1',
      operation: 'correct',
      text,
      changeSummary,
    });

  const openEditorWith = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });
    await user.click(await screen.findByTestId('writing-mode-free'));
    await user.type(await screen.findByTestId('writing-textarea'), text);
  };

  it('offers a candidate and leaves the original alone until it is accepted', async () => {
    const user = userEvent.setup();
    const gateway = new StubGateway(textResult('Исправленный текст'));
    setAssistantGateway(gateway);

    await openEditorWith(user, 'Тескт с ашипкой');
    await user.click(await screen.findByTestId('writing-op-correct'));

    expect(await screen.findByTestId('writing-candidate')).toHaveTextContent('Исправленный текст');
    expect(await screen.findByTestId('writing-change-summary')).toHaveTextContent('опечатки');
    // Not accepted yet: the working text is untouched.
    expect(useWritingStore.getState().draft?.workingText).toBe('Тескт с ашипкой');

    await user.click(await screen.findByTestId('writing-accept'));
    await waitFor(() =>
      expect(useWritingStore.getState().draft?.workingText).toBe('Исправленный текст'),
    );
    // The original survives as a version — it is never destroyed.
    const revisions = useWritingStore.getState().draft?.revisions ?? [];
    expect(revisions.some((revision) => revision.text === 'Тескт с ашипкой')).toBe(true);
  });

  it('keeps the user’s own version when they say so', async () => {
    const user = userEvent.setup();
    setAssistantGateway(new StubGateway(textResult('Причёсанный текст')));

    await openEditorWith(user, 'Мой корявый текст');
    await user.click(await screen.findByTestId('writing-op-correct'));
    await user.click(await screen.findByTestId('writing-keep-original'));

    await waitFor(() =>
      expect(useWritingStore.getState().draft?.workingText).toBe('Мой корявый текст'),
    );
    expect(useWritingStore.getState().draft?.revisions).toHaveLength(0);
  });

  it('sends the rating as context and never the initData', async () => {
    const user = userEvent.setup();
    const gateway = new StubGateway(textResult('Ок'));
    setAssistantGateway(gateway);

    await openEditorWith(user, 'Текст');
    await user.click(await screen.findByTestId('writing-op-shorten'));

    await waitFor(() => expect(gateway.seen).toHaveLength(1));
    const sent = gateway.seen[0]!;
    expect(sent.rating).toMatchObject({ overallRating: 4, mode: 'quick' });
    expect(sent.film).toMatchObject({ filmId: FILM_ID, title: 'Долгая дорога' });
    expect(JSON.stringify(sent)).not.toContain('hash');
  });

  it('a failed request changes nothing and says so', async () => {
    const user = userEvent.setup();
    setAssistantGateway(
      new StubGateway(async () => {
        throw new AssistantError('offline');
      }),
    );

    await openEditorWith(user, 'Текст, который нельзя потерять');
    await user.click(await screen.findByTestId('writing-op-correct'));

    expect(await screen.findByTestId('writing-assistant-error')).toHaveTextContent('Нет связи');
    expect(useWritingStore.getState().draft?.workingText).toBe('Текст, который нельзя потерять');
    // Nothing is left pending, so a later response cannot be mistaken for this one.
    await waitFor(() =>
      expect(useWritingStore.getState().draft?.pendingAssistantRequest).toBeNull(),
    );
  });

  it('drops a response to a request the user has moved past', async () => {
    const user = userEvent.setup();
    setAssistantGateway(
      new StubGateway(async (request) => ({
        kind: 'text',
        // An id nobody is waiting for: a late answer to an old question.
        requestId: `${request.requestId}-stale`,
        promptVersion: 'correct-1',
        operation: 'correct',
        text: 'Устаревший ответ',
        changeSummary: '',
      })),
    );

    await openEditorWith(user, 'Актуальный текст');
    await user.click(await screen.findByTestId('writing-op-correct'));

    await waitFor(() => expect(useWritingStore.getState().assistantBusy).toBe(false));
    expect(useWritingStore.getState().draft?.assistantCandidate).toBeNull();
    expect(useWritingStore.getState().draft?.workingText).toBe('Актуальный текст');
  });

  it('builds a text out of the answers and never out of nothing', async () => {
    const user = userEvent.setup();
    let asked = 0;
    setAssistantGateway(
      new StubGateway(async (request) => {
        if (request.operation === 'nextQuestion' || request.operation === 'replaceQuestion') {
          asked += 1;
          return {
            kind: 'question',
            requestId: request.requestId,
            promptVersion: 'question-1',
            question: {
              questionId: `q${asked}`,
              question: `Вопрос ${asked}`,
              leadIn: null,
              topic: null,
              suggestFinish: asked >= 2,
            },
          };
        }
        // Composing must only ever see the words the user actually typed.
        expect(request.conversation?.turns[0]?.answerText).toBe('Меня зацепил финал');
        return {
          kind: 'text',
          requestId: request.requestId,
          promptVersion: 'collect-1',
          operation: 'collect',
          text: 'Собранный из ответов текст',
          changeSummary: 'Собрал из твоих ответов',
        };
      }),
    );

    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });
    await user.click(await screen.findByTestId('writing-mode-conversation'));

    expect(await screen.findByTestId('writing-question')).toHaveTextContent('Вопрос 1');
    // Nothing to compose from yet.
    expect(screen.queryByTestId('writing-compose')).not.toBeInTheDocument();

    await user.type(await screen.findByTestId('writing-answer'), 'Меня зацепил финал');
    await user.click(await screen.findByTestId('writing-answer-send'));

    await user.click(await screen.findByTestId('writing-compose'));
    await new Promise((r) => setTimeout(r, 300));
    // eslint-disable-next-line no-console
    console.log(
      'DBG2',
      JSON.stringify({
        cand: useWritingStore.getState().draft?.assistantCandidate?.text ?? null,
        pending: useWritingStore.getState().draft?.pendingAssistantRequest,
        err: useWritingStore.getState().assistantError?.code ?? null,
        screenNow: useWritingStore.getState().draft?.currentScreen,
        seen: asked,
      }),
    );
    expect(await screen.findByTestId('writing-candidate')).toHaveTextContent(
      'Собранный из ответов текст',
    );
  });

  it('a skipped question sends no words at all', async () => {
    const user = userEvent.setup();
    let asked = 0;
    const gateway: StubGateway = new StubGateway(async (request) => {
      asked += 1;
      return {
        kind: 'question',
        requestId: request.requestId,
        promptVersion: 'question-1',
        question: {
          questionId: `q${asked}`,
          question: `Вопрос ${asked}`,
          leadIn: null,
          topic: null,
          suggestFinish: false,
        },
      };
    });
    setAssistantGateway(gateway);

    await startWriting();
    renderApp({ telegram: createTelegramFake(), path: `/write/${ENTRY_ID}/mode` });
    await user.click(await screen.findByTestId('writing-mode-conversation'));
    await screen.findByTestId('writing-question');

    await user.click(await screen.findByTestId('writing-skip'));

    await waitFor(() => expect(gateway.seen.length).toBeGreaterThan(1));
    const turns = useWritingStore.getState().draft?.conversation?.turns ?? [];
    expect(turns[0]?.status).toBe('skipped');
    expect(turns[0]?.answerText).toBeNull();
    // A skip contributes nothing to compose from.
    expect(gateway.seen.at(-1)?.conversation?.turns).toHaveLength(0);
  });
});
