import { useCallback, useEffect, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { resultPhrase } from '@domain/rating/rating.constants';
import { resumeTarget } from '@domain/rating/rating.machine';
import { formatEntryDate } from '@domain/diary/diary.schema';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { RatingDraft, RatingMode } from '@domain/rating/rating.types';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BackIcon, MenuIcon } from '@shared/ui/icons';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useTelegram } from '@app/telegram/telegramStore';
import { RatingSummary } from '@features/rating/components/RatingSummary';
import { RatingBreakdown } from '@features/rating/components/RatingBreakdown';
import { FilmIdentity } from '@features/rating/components/FilmIdentity';
import { useRatingStore } from '@features/rating/model/rating.store';
import { replaceDraft, requestDraft } from '@features/rating/model/draftCoordinator';
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
  const activeDraft = useRatingStore((state) => state.draft);

  const [entry, setEntry] = useState<DiaryEntry | null>(
    () => entries.find((item) => item.id === entryId) ?? null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [conflictMode, setConflictMode] = useState<RatingMode | null>(null);

  useEffect(() => {
    const found = entries.find((item) => item.id === entryId);
    if (found) {
      setEntry(found);
      return;
    }
    // Deep link or a cold start: read it straight from storage.
    let active = true;
    void diaryRepository.getById(entryId).then((stored) => {
      // A soft-deleted entry must not be reachable by URL.
      if (active && stored && !stored.deletedAt) setEntry(stored);
    });
    return () => {
      active = false;
    };
  }, [entries, entryId]);

  const openDraft = useCallback(
    (draft: RatingDraft) => {
      const target = resumeTarget(draft);
      const filmId = draft.filmId;
      if (target.screen === 'deep') {
        navigation.openRating({ kind: 'rateDeep', filmId, step: target.step });
      } else if (target.screen === 'quick') {
        navigation.openRating({ kind: 'rateQuick', filmId });
      } else if (target.screen === 'result') {
        navigation.openRating({ kind: 'rateResult', filmId });
      } else {
        navigation.openRating({ kind: 'rateMode', filmId });
      }
    },
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

      <Sheet open={menuOpen} title="Запись" onClose={() => setMenuOpen(false)}>
        <div className={styles.menu}>
          <Button variant="secondary" block onClick={() => void edit()} data-testid="entry-edit">
            Изменить оценку
          </Button>
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
