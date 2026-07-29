import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { diaryTextFromDraft, hasMeaningfulText } from '@domain/diary/diary.text';
import {
  acceptCandidate,
  answeredTurns,
  canCompose,
  editCandidateManually,
  keepOriginal,
  shouldOfferCompose,
} from '@domain/writing/writing.machine';
import {
  ANSWER_LIMIT,
  TEXT_LIMIT,
  TEXT_WARN_AT,
  type TextOperation,
  type WritingScreen,
} from '@domain/writing/writing.types';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { StorageError } from '@shared/storage/db';
import { Button } from '@shared/ui/Button/Button';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { RatingFlowShell } from '@features/rating/components/RatingFlowShell';
import { ExitDraftSheet } from '@features/rating/components/ExitDraftSheet';
import { useDiaryEntry, useDiaryStore } from '@features/diary/model/diary.store';
import { useWritingStore } from '../model/writing.store';
import {
  answerQuestion,
  askNextQuestion,
  cancelAssistant,
  composeFromConversation,
  runTextOperation,
  skipCurrentQuestion,
} from '../model/assistant.actions';
import { assistantBusyText, assistantErrorText, revisionLabel } from '../model/assistantMessages';
import { useWritingFlow, useWritingRouteGuard } from '../model/useWritingFlow';
import styles from './WritingPage.module.css';

export interface WritingPageProps {
  entryId: string;
  screen: WritingScreen;
}

/**
 * The writing flow (spec §9-§11).
 *
 * One page for every screen, because they share a draft, a shell and a back
 * behaviour — switching screens must never remount the editor and lose the
 * caret. Nothing here talks to the assistant: the whole flow works offline.
 */
export const WritingPage = ({ entryId, screen }: WritingPageProps) => {
  const guard = useWritingRouteGuard(entryId, screen);
  const { draft, openScreen, leave } = useWritingFlow(entryId, screen);
  const entry = useDiaryEntry(entryId);
  const busy = useWritingStore((state) => state.assistantBusy);

  /*
   * A candidate arriving is what opens the result screen — not the tap that
   * asked for it. The request may finish while the user is elsewhere in the
   * flow, and the answer must not be shown behind the editor.
   */
  const candidate = draft?.assistantCandidate ?? null;
  const shownCandidate = useRef<string | null>(null);
  useEffect(() => {
    if (!candidate) return;
    // Only a *new* candidate opens the screen. "Оставить свой вариант" keeps
    // the candidate in the draft, and without this the flow would drag the
    // user straight back to a decision they had already made.
    if (shownCandidate.current === candidate.id) return;
    shownCandidate.current = candidate.id;
    if (screen !== 'aiResult') openScreen('aiResult');
  }, [candidate, screen, openScreen]);

  if (guard === 'redirecting' || !draft) return null;

  const accentRgb = draft.film.dominantColor ?? undefined;
  /*
   * A text operation takes over the screen: it is long, and the user must be
   * able to see it and cancel it. A question does not — the conversation shows
   * its own quiet loading state, because swapping the whole screen out and
   * back would unmount it and lose what is on it.
   */
  const pending = draft.pendingAssistantRequest;
  const showProcessing =
    busy &&
    pending !== null &&
    pending.operation !== 'nextQuestion' &&
    pending.operation !== 'replaceQuestion';

  return (
    <RatingFlowShell onBack={() => leave()} accentRgb={accentRgb}>
      {showProcessing ? (
        <ProcessingScreen operation={pending?.operation ?? ''} />
      ) : (
        <>
          {screen === 'mode' ? <ModeScreen entryId={entryId} onPick={openScreen} /> : null}
          {screen === 'editor' ? (
            <EditorScreen
              entryId={entryId}
              entry={entry}
              onPreview={() => openScreen('preview')}
              onLeave={leave}
            />
          ) : null}
          {screen === 'preview' ? (
            <PreviewScreen entryId={entryId} onBack={() => openScreen('editor')} />
          ) : null}
          {screen === 'conversation' ? (
            <ConversationScreen entry={entry} onEditor={() => openScreen('editor')} />
          ) : null}
          {screen === 'aiResult' || screen === 'processing' ? (
            <AiResultScreen onEditor={() => openScreen('editor')} />
          ) : null}
        </>
      )}
    </RatingFlowShell>
  );
};

/* --- mode ------------------------------------------------------------- */

const ModeScreen = ({
  entryId,
  onPick,
}: {
  entryId: string;
  onPick: (screen: WritingScreen) => void;
}) => {
  const chooseMode = useWritingStore((state) => state.chooseMode);
  const draft = useWritingStore((state) => state.draft);

  const pick = useCallback(
    async (mode: 'free' | 'conversation') => {
      await chooseMode(mode).catch(() => undefined);
      onPick(mode === 'free' ? 'editor' : 'conversation');
    },
    [chooseMode, onPick],
  );

  return (
    <div className={styles.content} data-testid="writing-mode" data-entry={entryId}>
      <h1 className={styles.question}>Как расскажешь о фильме?</h1>
      <p className={styles.lead}>Оценка уже сохранена. Текст — по желанию и в любой момент.</p>

      <div className={styles.options}>
        <button
          type="button"
          className={styles.option}
          data-variant="primary"
          onClick={() => void pick('conversation')}
          data-testid="writing-mode-conversation"
        >
          <span className={styles.optionTitle}>Поговорить с SYO</span>
          <span className={styles.optionHint}>
            Несколько вопросов о фильме — из твоих ответов соберётся текст.
          </span>
        </button>

        <button
          type="button"
          className={styles.option}
          data-variant="secondary"
          onClick={() => void pick('free')}
          data-testid="writing-mode-free"
        >
          <span className={styles.optionTitle}>Написать самому</span>
          <span className={styles.optionHint}>
            Чистый лист. SYO поможет, только если попросишь.
          </span>
        </button>
      </div>

      {/* Switching modes later never destroys what the other one produced. */}
      {draft && hasMeaningfulText(draft.workingText) ? (
        <button
          type="button"
          className={styles.option}
          data-variant="secondary"
          onClick={() => onPick('editor')}
          data-testid="writing-resume-text"
        >
          <span className={styles.optionTitle}>Вернуться к тексту</span>
          <span className={styles.optionHint}>Черновик сохранён — продолжишь с того же места.</span>
        </button>
      ) : null}
    </div>
  );
};

/* --- free editor ------------------------------------------------------ */

const EditorScreen = ({
  entryId,
  entry,
  onPreview,
  onLeave,
}: {
  entryId: string;
  entry: DiaryEntry | null;
  onPreview: () => void;
  onLeave: () => void;
}) => {
  const draft = useWritingStore((state) => state.draft);
  const dirty = useWritingStore((state) => state.dirty);
  const setText = useWritingStore((state) => state.setText);
  const rememberCursor = useWritingStore((state) => state.rememberCursor);
  const flush = useWritingStore((state) => state.flush);
  const discard = useWritingStore((state) => state.discard);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Recovery comfort: coming back puts the caret where it was, not at the top.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !draft) return;
    const at = draft.selectionStart ?? draft.workingText.length;
    area.setSelectionRange(at, draft.selectionEnd ?? at);
    if (draft.editorScrollTop !== undefined) area.scrollTop = draft.editorScrollTop;
    // Only on mount: moving the caret while typing would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * A backgrounded WebView may never run another timer, so the debounce is
   * flushed the moment the app goes away. This is the difference between
   * losing the last sentence and losing nothing.
   */
  useEffect(() => {
    const write = () => void flush();
    window.addEventListener('pagehide', write);
    document.addEventListener('visibilitychange', write);
    return () => {
      window.removeEventListener('pagehide', write);
      document.removeEventListener('visibilitychange', write);
      write();
    };
  }, [flush]);

  if (!draft) return null;

  const length = draft.workingText.length;
  const nearLimit = length >= TEXT_WARN_AT;

  return (
    <div className={styles.content} data-testid="writing-editor" data-entry={entryId}>
      <div className={styles.editor}>
        <textarea
          ref={areaRef}
          className={styles.textarea}
          value={draft.workingText}
          maxLength={TEXT_LIMIT}
          placeholder="О чём этот фильм для тебя?"
          aria-label="Текст о фильме"
          autoCapitalize="sentences"
          spellCheck
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => {
            rememberCursor({
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
              scrollTop: event.target.scrollTop,
            });
            void flush();
          }}
          data-testid="writing-textarea"
        />

        <div className={styles.editorFoot}>
          <span className={styles.saveState} data-testid="writing-save-state">
            {dirty ? 'Сохраняем…' : length > 0 ? 'Сохранено' : ''}
          </span>
          {/* The counter appears only when the ceiling is actually close. */}
          {nearLimit ? (
            <span className={styles.counter} data-warn="true" data-testid="writing-counter">
              {length} / {TEXT_LIMIT}
            </span>
          ) : null}
        </div>
      </div>

      <AssistantBar entry={entry} area={areaRef} />

      {/* Every version stays reachable, including the very first one. */}
      {draft.revisions.length > 1 ? (
        <Button
          variant="ghost"
          block
          onClick={() => setVersionsOpen(true)}
          data-testid="writing-versions"
        >
          Версии текста ({draft.revisions.length})
        </Button>
      ) : null}

      <Button
        variant="primary"
        block
        disabled={!hasMeaningfulText(draft.workingText)}
        onClick={() => {
          void flush();
          onPreview();
        }}
        data-testid="writing-to-preview"
      >
        Дальше
      </Button>

      <Button variant="ghost" block onClick={() => setExitOpen(true)} data-testid="writing-exit">
        Выйти
      </Button>

      <VersionsSheet open={versionsOpen} onClose={() => setVersionsOpen(false)} />

      <ExitDraftSheet
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        onLeave={() => {
          setExitOpen(false);
          onLeave();
        }}
        onDiscard={async () => {
          setExitOpen(false);
          await discard().catch(() => undefined);
          onLeave();
        }}
      />
    </div>
  );
};

/* --- preview and save -------------------------------------------------- */

const PreviewScreen = ({ entryId, onBack }: { entryId: string; onBack: () => void }) => {
  const draft = useWritingStore((state) => state.draft);
  const addRevision = useWritingStore((state) => state.addRevision);
  const discard = useWritingStore((state) => state.discard);
  const apply = useWritingStore((state) => state.apply);
  const saveText = useDiaryStore((state) => state.saveText);
  const showSnackbar = useSnackbarStore((state) => state.show);
  const { haptics } = useServices();
  // The parent already owns the flow's back handling; this screen only needs
  // to be able to leave once the text is saved.
  const navigation = useNavigationController();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);

  const onSave = useCallback(async () => {
    // A second tap while the first is in flight must not save twice.
    if (!draft || saving) return;
    setSaving(true);
    setError(null);

    try {
      // The words on screen become a revision first, so the saved text and the
      // history can never disagree about what the user actually wrote.
      await addRevision({ text: draft.workingText, kind: 'user', origin: 'manual' });
      const current = useWritingStore.getState().draft;
      const text = current ? diaryTextFromDraft(current) : null;

      const stored = await saveText(entryId, text);
      if (!stored) throw new StorageError('unknown', new Error('entry is gone'));

      haptics.trigger('ratingSaved', `text:${entryId}`);
      showSnackbar('Текст сохранён');
      // Navigate first, clear the draft second: the guard on this screen
      // redirects whenever there is no draft.
      navigation.closeWriting(entryId);
      await discard().catch(() => undefined);
    } catch (caught) {
      haptics.trigger('storageWarning', 'text-save-failed');
      setError(caught instanceof StorageError ? caught : new StorageError('unknown', caught));
    } finally {
      setSaving(false);
    }
  }, [draft, saving, addRevision, saveText, entryId, haptics, showSnackbar, navigation, discard]);

  if (!draft) return null;

  return (
    <div className={styles.content} data-testid="writing-preview">
      <h1 className={styles.question}>Так и сохраним?</h1>

      {/* Plain text. Never dangerouslySetInnerHTML, never rendered markdown. */}
      <p className={styles.preview} data-testid="writing-preview-text">
        {draft.workingText}
      </p>

      <label className={styles.spoiler}>
        <input
          type="checkbox"
          checked={draft.spoiler}
          onChange={(event) => {
            const spoiler = event.target.checked;
            void apply((current) => ({ ...current, spoiler })).catch(() => undefined);
          }}
          data-testid="writing-spoiler"
        />
        В тексте есть спойлеры
      </label>

      {error ? (
        <p className={styles.error} role="alert">
          Не получилось сохранить текст на устройстве.
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        disabled={saving}
        onClick={() => void onSave()}
        data-testid="writing-save"
      >
        {saving ? 'Сохраняем' : error ? 'Повторить' : 'Сохранить текст'}
      </Button>

      <Button variant="ghost" block onClick={onBack} data-testid="writing-back-to-editor">
        Вернуться к тексту
      </Button>
    </div>
  );
};

/* --- SYO operations on an existing text --------------------------------- */

const OPERATIONS: { id: TextOperation; label: string }[] = [
  { id: 'correct', label: 'Проверить' },
  { id: 'shorten', label: 'Сократить' },
  { id: 'connect', label: 'Связать' },
];

/**
 * SYO's help, always on request (spec §15.1). Nothing here runs by itself, and
 * every operation produces a candidate the user still has to accept.
 */
const AssistantBar = ({
  entry,
  area,
}: {
  entry: DiaryEntry | null;
  area: RefObject<HTMLTextAreaElement | null>;
}) => {
  const draft = useWritingStore((state) => state.draft);
  const error = useWritingStore((state) => state.assistantError);
  const retry = useWritingStore((state) => state.assistantRetry);
  const setError = useWritingStore((state) => state.setAssistantError);
  const flush = useWritingStore((state) => state.flush);

  const ask = useCallback(
    async (operation: TextOperation, requestId?: string) => {
      if (!entry) return;
      // What is on screen is written down before anything is sent: a request
      // must never be the reason a sentence was lost.
      await flush();

      const element = area.current;
      const selection =
        element && element.selectionEnd > element.selectionStart
          ? { start: element.selectionStart, end: element.selectionEnd }
          : undefined;

      await runTextOperation({
        entry,
        operation,
        ...(requestId ? { requestId } : {}),
        ...(selection ? { selection } : {}),
      });
    },
    [entry, flush, area],
  );

  if (!draft) return null;
  const disabled = !entry || !hasMeaningfulText(draft.workingText);
  // Questions are retried from the conversation, not from here.
  const retryOperation =
    retry && retry.operation !== 'nextQuestion' && retry.operation !== 'replaceQuestion'
      ? (retry.operation as TextOperation)
      : null;

  return (
    <div className={styles.assistant}>
      <div className={styles.assistantRow} role="group" aria-label="Помощь SYO">
        {OPERATIONS.map((operation) => (
          <button
            key={operation.id}
            type="button"
            className={styles.assistantButton}
            disabled={disabled}
            onClick={() => void ask(operation.id)}
            data-testid={`writing-op-${operation.id}`}
          >
            {operation.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className={styles.assistantError} role="alert" data-testid="writing-assistant-error">
          <span>{assistantErrorText(error)}</span>
          {error.retriable && retryOperation ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                // The same requestId: a retry is the same request, not a second.
                void ask(retryOperation, retry!.requestId);
              }}
              data-testid="writing-assistant-retry"
            >
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/* --- waiting ------------------------------------------------------------ */

/**
 * The one screen that must never look stuck: it says what is happening and it
 * can always be cancelled, and cancelling costs the user nothing (spec §20).
 */
const ProcessingScreen = ({ operation }: { operation: string }) => (
  <div className={styles.content} data-testid="writing-processing">
    <p className={styles.question} aria-live="polite">
      {assistantBusyText(operation)}
    </p>
    <p className={styles.lead}>Твой текст сохранён. Это ничего не изменит без твоего согласия.</p>
    <Button variant="ghost" block onClick={() => cancelAssistant()} data-testid="writing-cancel-ai">
      Отменить
    </Button>
  </div>
);

/* --- conversation ------------------------------------------------------- */

const ConversationScreen = ({
  entry,
  onEditor,
}: {
  entry: DiaryEntry | null;
  onEditor: () => void;
}) => {
  const draft = useWritingStore((state) => state.draft);
  const error = useWritingStore((state) => state.assistantError);
  const setError = useWritingStore((state) => state.setAssistantError);
  const busy = useWritingStore((state) => state.assistantBusy);
  const [answer, setAnswer] = useState('');

  const question = draft?.conversation?.currentQuestion ?? null;
  const answered = draft ? answeredTurns(draft).length : 0;

  /*
   * Only the very first question is asked automatically. Every later one is
   * requested by answering, skipping or replacing — an effect that asks
   * whenever no question happens to be on screen would fire again on every
   * commit and throw away the question that just arrived.
   */
  useEffect(() => {
    if (!entry || !draft || question || busy) return;
    if (draft.pendingAssistantRequest || (draft.conversation?.turns.length ?? 0) > 0) return;
    // A failed attempt is not retried by itself: retrying in an effect turns
    // one dead network into an endless stream of requests.
    if (draft.conversation?.status === 'error') return;
    void askNextQuestion(entry);
  }, [entry, draft, question, busy]);

  if (!draft) return null;

  const submit = async () => {
    if (!entry || !answer.trim()) return;
    const words = answer;
    setAnswer('');
    await answerQuestion(entry, words);
  };

  return (
    <div className={styles.content} data-testid="writing-conversation">
      {question ? (
        <>
          {question.leadIn ? <p className={styles.lead}>{question.leadIn}</p> : null}
          <h1 className={styles.question} data-testid="writing-question">
            {question.question}
          </h1>

          <textarea
            className={styles.textarea}
            value={answer}
            maxLength={ANSWER_LIMIT}
            placeholder="Своими словами"
            aria-label="Ответ на вопрос"
            onChange={(event) => setAnswer(event.target.value)}
            data-testid="writing-answer"
          />

          <Button
            variant="primary"
            block
            disabled={!answer.trim()}
            onClick={() => void submit()}
            data-testid="writing-answer-send"
          >
            Ответить
          </Button>

          <div className={styles.assistantRow}>
            <button
              type="button"
              className={styles.assistantButton}
              onClick={() => entry && void skipCurrentQuestion(entry)}
              data-testid="writing-skip"
            >
              Пропустить
            </button>
            <button
              type="button"
              className={styles.assistantButton}
              onClick={() => entry && void askNextQuestion(entry, true)}
              data-testid="writing-another-question"
            >
              Другой вопрос
            </button>
          </div>
        </>
      ) : (
        <p className={styles.lead} aria-live="polite" data-testid="writing-question-loading">
          {busy
            ? 'SYO думает над вопросом'
            : answered
              ? `Ответов: ${answered}`
              : 'SYO готовит первый вопрос'}
        </p>
      )}

      {/* Composing from nothing would be inventing an opinion (spec §13.10). */}
      {canCompose(draft) ? (
        <Button
          variant={shouldOfferCompose(draft) ? 'primary' : 'secondary'}
          block
          onClick={() => entry && void composeFromConversation(entry)}
          data-testid="writing-compose"
        >
          Собрать текст из ответов
        </Button>
      ) : null}

      {error ? (
        <div className={styles.assistantError} role="alert" data-testid="writing-assistant-error">
          <span>{assistantErrorText(error)}</span>
          {error.retriable && entry ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                void askNextQuestion(entry);
              }}
              data-testid="writing-assistant-retry"
            >
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}

      <Button variant="ghost" block onClick={onEditor} data-testid="writing-to-editor">
        Написать самому
      </Button>
    </div>
  );
};

/* --- what SYO proposed --------------------------------------------------- */

/**
 * A candidate, never a replacement (spec §21).
 *
 * The original is one tap away and stays the default: accepting is a choice,
 * not the path of least resistance.
 */
const AiResultScreen = ({ onEditor }: { onEditor: () => void }) => {
  const draft = useWritingStore((state) => state.draft);
  const apply = useWritingStore((state) => state.apply);
  const [showOriginal, setShowOriginal] = useState(false);

  const candidate = draft?.assistantCandidate ?? null;

  if (!draft || !candidate) return null;

  return (
    <div className={styles.content} data-testid="writing-ai-result">
      <h1 className={styles.question}>SYO предлагает</h1>
      {candidate.changeSummary ? (
        <p className={styles.lead} data-testid="writing-change-summary">
          {candidate.changeSummary}
        </p>
      ) : null}

      <p className={styles.preview} data-testid="writing-candidate">
        {candidate.text}
      </p>

      {/* Both versions are readable side by side before anything is decided. */}
      {draft.workingText.trim() ? (
        <>
          <Button
            variant="ghost"
            block
            onClick={() => setShowOriginal((open) => !open)}
            data-testid="writing-toggle-original"
          >
            {showOriginal ? 'Скрыть твой вариант' : 'Показать твой вариант'}
          </Button>
          {showOriginal ? (
            <p className={styles.original} data-testid="writing-original">
              {draft.workingText}
            </p>
          ) : null}
        </>
      ) : null}

      <Button
        variant="primary"
        block
        onClick={() => {
          void apply(acceptCandidate).then(onEditor);
        }}
        data-testid="writing-accept"
      >
        Принять
      </Button>
      <Button
        variant="secondary"
        block
        onClick={() => {
          void apply(keepOriginal).then(onEditor);
        }}
        data-testid="writing-keep-original"
      >
        Оставить свой вариант
      </Button>
      <Button
        variant="ghost"
        block
        onClick={() => {
          void apply(editCandidateManually).then(onEditor);
        }}
        data-testid="writing-edit-candidate"
      >
        Редактировать вручную
      </Button>
    </div>
  );
};

/* --- versions ------------------------------------------------------------ */

/** Every version ever saved, including the user's first one (spec §21.7). */
const VersionsSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const draft = useWritingStore((state) => state.draft);
  const apply = useWritingStore((state) => state.apply);

  if (!draft) return null;

  return (
    <Sheet open={open} title="Версии текста" onClose={onClose}>
      <div className={styles.versions}>
        {[...draft.revisions].reverse().map((revision) => (
          <button
            key={revision.id}
            type="button"
            className={styles.version}
            data-selected={revision.id === draft.selectedRevisionId || undefined}
            onClick={() => {
              void apply((current) => ({
                ...current,
                selectedRevisionId: revision.id,
                workingText: revision.text,
                updatedAt: new Date().toISOString(),
                revision: current.revision + 1,
              })).then(onClose);
            }}
            data-testid={`writing-version-${revision.id}`}
          >
            <span className={styles.versionTitle}>
              {revisionLabel(revision.origin, revision.kind)}
            </span>
            <span className={styles.versionExcerpt}>{revision.text.slice(0, 120)}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
};
