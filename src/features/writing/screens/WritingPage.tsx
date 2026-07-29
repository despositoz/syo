import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { diaryTextFromDraft, hasMeaningfulText } from '@domain/diary/diary.text';
import { TEXT_LIMIT, TEXT_WARN_AT, type WritingScreen } from '@domain/writing/writing.types';
import { StorageError } from '@shared/storage/db';
import { Button } from '@shared/ui/Button/Button';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { RatingFlowShell } from '@features/rating/components/RatingFlowShell';
import { ExitDraftSheet } from '@features/rating/components/ExitDraftSheet';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { useWritingStore } from '../model/writing.store';
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
  const { draft, navigation, openScreen, leave } = useWritingFlow(entryId, screen);

  if (guard === 'redirecting' || !draft) return null;

  const accentRgb = draft.film.dominantColor ?? undefined;

  return (
    <RatingFlowShell onBack={() => leave()} accentRgb={accentRgb}>
      {screen === 'mode' ? <ModeScreen entryId={entryId} onPick={openScreen} /> : null}
      {screen === 'editor' ? (
        <EditorScreen entryId={entryId} onPreview={() => openScreen('preview')} onLeave={leave} />
      ) : null}
      {screen === 'preview' ? (
        <PreviewScreen entryId={entryId} onBack={() => openScreen('editor')} />
      ) : null}
      {screen === 'conversation' || screen === 'aiResult' || screen === 'processing' ? (
        // Filled in with the assistant flow; the offline branch never lands here.
        <ConversationPlaceholder
          onBack={() => openScreen('mode')}
          navigateAway={navigation.goBack}
        />
      ) : null}
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
  onPreview,
  onLeave,
}: {
  entryId: string;
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

const ConversationPlaceholder = ({
  onBack,
  navigateAway,
}: {
  onBack: () => void;
  navigateAway: () => void;
}) => (
  <div className={styles.content} data-testid="writing-conversation">
    <h1 className={styles.question}>Разговор с SYO</h1>
    <p className={styles.lead}>Пока недоступен — можно написать текст самому.</p>
    <Button variant="primary" block onClick={onBack}>
      Выбрать другой способ
    </Button>
    <Button variant="ghost" block onClick={navigateAway}>
      Закрыть
    </Button>
  </div>
);
