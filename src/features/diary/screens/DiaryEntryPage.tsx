import { useCallback, useEffect, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { resultPhrase } from '@domain/rating/rating.constants';
import { formatEntryDate } from '@domain/diary/diary.schema';
import { selectedText } from '@domain/diary/diary.text';
import type { DiaryText } from '@domain/diary/diary.text';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { RatingMode } from '@domain/rating/rating.types';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BackIcon, MenuIcon } from '@shared/ui/icons';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useTelegram } from '@app/telegram/telegramStore';
import { RatingSummary } from '@features/rating/components/RatingSummary';
import { RatingBreakdown } from '@features/rating/components/RatingBreakdown';
import { FilmIdentity } from '@features/rating/components/FilmIdentity';
import {
  openDraftRoute,
  replaceDraft,
  replaceWithWritingDraft,
  requestDraft,
  requestWritingDraft,
  useActiveDraft,
} from '@features/drafts/draftCoordinator';
import { DraftConflictSheet } from '@features/rating/components/DraftConflictSheet';
import { useDiaryStore } from '../model/diary.store';
import { diaryRepository } from '../repositories/diary.repository';
import styles from './DiaryEntryPage.module.css';

export interface DiaryEntryPageProps {
  entryId: string;
}

/** Undo stays available this long after a delete (spec §37). */
const UNDO_WINDOW_MS = 6000;

/**
 * A saved rating (spec §35).
 *
 * Quieter than the Film Page: poster, personal stars, title. Quick shows only
 * the overall; deep adds the five aspects as a plain list — no charts.
 */
export const DiaryEntryPage = ({ entryId }: DiaryEntryPageProps) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();
  const chromeMode = useTelegram().chromeMode;

  const entries = useDiaryStore((state) => state.entries);
  const remove = useDiaryStore((state) => state.remove);
  const restore = useDiaryStore((state) => state.restore);
  const showSnackbar = useSnackbarStore((state) => state.show);
  const saveText = useDiaryStore((state) => state.saveText);
  const activeDraft = useActiveDraft();

  const [stored, setStored] = useState<DiaryEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [conflictMode, setConflictMode] = useState<RatingMode | null>(null);
  /** Set when starting to write hit an existing draft of something else. */
  const [textConflict, setTextConflict] = useState(false);
  const [textRevealed, setTextRevealed] = useState(false);

  const fromStore = entries.find((item) => item.id === entryId) ?? null;
  // The store wins while it has the entry; `stored` only covers a deep link.
  const entry = fromStore ?? stored;

  useEffect(() => {
    if (fromStore) return;
    // Deep link or a cold start: read it straight from storage.
    let active = true;
    void diaryRepository.getById(entryId).then((found) => {
      // A soft-deleted entry must not be reachable by URL.
      if (active && found && !found.deletedAt) setStored(found);
    });
    return () => {
      active = false;
    };
  }, [fromStore, entryId]);

  const openDraft = useCallback(
    (draft: Parameters<typeof openDraftRoute>[1]) => openDraftRoute(navigation, draft),
    [navigation],
  );

  const editOptions = useCallback(
    (mode: RatingMode) => ({
      film: {
        filmId: entry!.filmId,
        filmTitle: entry!.filmTitle,
        posterPath: entry!.posterPath,
        backdropPath: null,
        releaseYear: entry!.releaseYear,
      },
      mode,
      editingEntryId: entry!.id,
      quickRating: mode === 'quick' ? entry!.overallRating : null,
      ...(mode === 'deep' && entry!.mode === 'deep' ? { aspects: entry!.aspects } : {}),
    }),
    [entry],
  );

  /**
   * Editing goes through the same coordinator as any other start: an unfinished
   * rating of a *different* film must not be destroyed just because the user
   * tapped "изменить" here.
   */
  const edit = useCallback(async () => {
    if (!entry) return;
    setMenuOpen(false);

    const outcome = await requestDraft(editOptions(entry.mode));
    if (outcome.kind === 'conflict') {
      setConflictMode(entry.mode);
      return;
    }
    openDraft(outcome.draft);
  }, [entry, editOptions, openDraft]);

  const editAfterConfirm = useCallback(async () => {
    if (!entry || !conflictMode) return;
    setConflictMode(null);
    openDraft(await replaceDraft(editOptions(conflictMode)));
  }, [entry, conflictMode, editOptions, openDraft]);

  const writingOptions = useCallback(
    () => ({
      entryId: entry!.id,
      film: {
        filmId: entry!.filmId,
        filmTitle: entry!.filmTitle,
        posterPath: entry!.posterPath,
        releaseYear: entry!.releaseYear,
      },
      source: 'journalEntry' as const,
      // Editing starts from what is saved, and keeps the history behind it.
      initialText: entry!.text ? selectedText(entry!.text) : '',
      initialRevisions: entry!.text?.revisions ?? [],
      selectedRevisionId: entry!.text?.selectedRevisionId ?? null,
    }),
    [entry],
  );

  /** Writing goes through the same coordinator as any other draft. */
  const write = useCallback(async () => {
    if (!entry) return;
    setMenuOpen(false);

    const outcome = await requestWritingDraft(writingOptions());
    if (outcome.kind === 'conflict') {
      setTextConflict(true);
      return;
    }
    openDraft(outcome.draft);
  }, [entry, writingOptions, openDraft]);

  const writeAfterConfirm = useCallback(async () => {
    setTextConflict(false);
    openDraft(await replaceWithWritingDraft(writingOptions()));
  }, [writingOptions, openDraft]);

  /**
   * Deleting the text leaves the rating alone, and the removed text is held for
   * the Undo window so "Вернуть" restores the words, not a blank entry.
   */
  const deleteText = useCallback(async () => {
    if (!entry?.text) return;
    const snapshot: DiaryText = entry.text;
    setMenuOpen(false);

    await saveText(entry.id, null);
    haptics.trigger('diaryEntryDeleted', `text:${entry.id}`);

    showSnackbar('Текст удалён', UNDO_WINDOW_MS, {
      label: 'Вернуть',
      onAction: () => {
        void saveText(entry.id, snapshot).then(() => {
          haptics.trigger('undoDelete', `text:${entry.id}`);
        });
      },
    });
  }, [entry, saveText, haptics, showSnackbar]);

  const confirmDelete = useCallback(async () => {
    if (!entry) return;
    setDeleteOpen(false);
    setMenuOpen(false);

    await remove(entry.id);
    haptics.trigger('diaryEntryDeleted', `delete:${entry.id}`);
    navigation.goBack();

    // The tombstone survives, so Undo restores the same row in its old place.
    showSnackbar('Оценка удалена', UNDO_WINDOW_MS, {
      label: 'Вернуть',
      onAction: () => {
        void restore(entry.id);
        haptics.trigger('undoDelete', `restore:${entry.id}`);
      },
    });
  }, [entry, remove, restore, haptics, navigation, showSnackbar]);

  if (!entry) return null;

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        {chromeMode === 'custom' ? (
          <IconButton label="Назад" onClick={() => navigation.goBack()}>
            <BackIcon />
          </IconButton>
        ) : (
          <span />
        )}

        <IconButton
          label="Действия с записью"
          onClick={() => setMenuOpen(true)}
          data-testid="entry-menu"
        >
          <MenuIcon />
        </IconButton>
      </header>

      <div className={`${styles.body} scroll-y`}>
        <FilmIdentity
          film={{
            filmId: entry.filmId,
            filmTitle: entry.filmTitle,
            posterPath: entry.posterPath,
            backdropPath: null,
            releaseYear: entry.releaseYear,
          }}
          size="hero"
        />

        <div className={styles.score}>
          <RatingSummary
            overallRating={entry.overallRating}
            preciseRating={entry.preciseRating}
            size="large"
            showNumber
          />
          <p className={styles.phrase}>{resultPhrase(entry.overallRating)}</p>
          <p className={styles.meta}>
            {entry.mode === 'quick' ? 'Быстрая оценка' : 'Подробная оценка'} ·{' '}
            {formatEntryDate(entry.createdAt)}
          </p>
        </div>

        {/* Quick has no aspects, so it never shows an empty table. */}
        {entry.mode === 'deep' ? <RatingBreakdown aspects={entry.aspects} defaultOpen /> : null}

        {entry.hasText && entry.text ? (
          <div className={styles.text} data-testid="entry-text">
            {entry.text.spoiler && !textRevealed ? (
              <button
                type="button"
                className={styles.spoilerCover}
                onClick={() => setTextRevealed(true)}
                data-testid="entry-text-reveal"
              >
                В тексте есть спойлеры. Показать
              </button>
            ) : (
              /* Plain text, exactly as written — never HTML, never markdown. */
              <p className={styles.textBody} data-testid="entry-text-body">
                {selectedText(entry.text)}
              </p>
            )}
          </div>
        ) : (
          <Button variant="secondary" block onClick={() => void write()} data-testid="entry-write">
            Написать о фильме
          </Button>
        )}
      </div>

      <DraftConflictSheet
        open={conflictMode !== null && activeDraft !== null}
        draft={activeDraft}
        onClose={() => setConflictMode(null)}
        onContinue={() => {
          setConflictMode(null);
          if (activeDraft) openDraft(activeDraft);
        }}
        onDiscard={editAfterConfirm}
      />

      {/* Starting a text over unfinished work asks the very same question. */}
      <DraftConflictSheet
        open={textConflict && activeDraft !== null}
        draft={activeDraft}
        onClose={() => setTextConflict(false)}
        onContinue={() => {
          setTextConflict(false);
          if (activeDraft) openDraft(activeDraft);
        }}
        onDiscard={writeAfterConfirm}
      />

      <Sheet open={menuOpen} title="Запись" onClose={() => setMenuOpen(false)}>
        <div className={styles.menu}>
          <Button variant="secondary" block onClick={() => void edit()} data-testid="entry-edit">
            Изменить оценку
          </Button>
          <Button
            variant="secondary"
            block
            onClick={() => void write()}
            data-testid="entry-edit-text"
          >
            {entry.hasText ? 'Изменить текст' : 'Написать о фильме'}
          </Button>
          {entry.hasText ? (
            <Button
              variant="secondary"
              block
              onClick={() => void deleteText()}
              data-testid="entry-delete-text"
            >
              Удалить текст
            </Button>
          ) : null}
          <Button
            variant="secondary"
            block
            onClick={() => {
              setMenuOpen(false);
              navigation.openFilm({ filmId: entry.filmId, title: entry.filmTitle });
            }}
          >
            Открыть страницу фильма
          </Button>
          <Button
            variant="destructive"
            block
            onClick={() => setDeleteOpen(true)}
            data-testid="entry-delete"
          >
            Удалить запись
          </Button>
        </div>
      </Sheet>

      <Sheet open={deleteOpen} title="Удалить оценку?" onClose={() => setDeleteOpen(false)}>
        <p className={styles.deleteText}>Запись исчезнет из Дневника.</p>
        <div className={styles.menu}>
          <Button
            variant="destructive"
            block
            onClick={() => void confirmDelete()}
            data-testid="entry-delete-confirm"
          >
            Удалить
          </Button>
          <Button variant="secondary" block onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </section>
  );
};
