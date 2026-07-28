import { useCallback, useEffect, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { formatScore } from '@domain/rating/rating.calculation';
import { resultPhrase } from '@domain/rating/rating.constants';
import { resumeTarget } from '@domain/rating/rating.machine';
import { isActiveEntry, type JournalEntry } from '@domain/journal/journal.types';
import type { RatingDraft } from '@domain/rating/rating.types';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BackIcon, MenuIcon } from '@shared/ui/icons';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useTelegram } from '@app/telegram/telegramStore';
import { OverallStars } from '@features/rating/components/OverallStars';
import { RatingBreakdown } from '@features/rating/components/RatingBreakdown';
import { FilmIdentity } from '@features/rating/components/FilmIdentity';
import { useRatingStore } from '@features/rating/model/rating.store';
import { replaceDraft, requestDraft } from '@features/rating/model/draftCoordinator';
import { DraftConflictSheet } from '@features/rating/components/DraftConflictSheet';
import { useJournalStore } from '../model/journal.store';
import { journalRepository } from '../repositories/journal.repository';
import styles from './JournalEntryScreen.module.css';

export interface JournalEntryScreenProps {
  entryId: string;
}

/** How long Undo stays available after a delete (spec §19.4). */
const UNDO_WINDOW_MS = 6500;

/**
 * A saved rating (spec §17).
 *
 * Quieter than the Film Page: poster, personal stars, title. No empty review
 * block, no AI, no TMDB score beside the personal one, no watch date.
 */
export const JournalEntryScreen = ({ entryId }: JournalEntryScreenProps) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();
  const chromeMode = useTelegram().chromeMode;

  const entries = useJournalStore((state) => state.entries);
  const remove = useJournalStore((state) => state.remove);
  const restore = useJournalStore((state) => state.restore);
  const showSnackbar = useSnackbarStore((state) => state.show);

  const [entry, setEntry] = useState<JournalEntry | null>(
    () => entries.find((item) => item.id === entryId) ?? null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [conflict, setConflict] = useState<{
    reason: 'film' | 'mode';
    mode: 'quick' | 'detailed';
  } | null>(null);
  const activeDraft = useRatingStore((state) => state.draft);

  useEffect(() => {
    const found = entries.find((item) => item.id === entryId);
    if (found) {
      setEntry(found);
      return;
    }
    // Deep link or a cold start: read it straight from storage.
    let active = true;
    void journalRepository.getById(entryId).then((stored) => {
      // A tombstone is not an entry: a direct link to a deleted rating must not
      // resurrect it on screen.
      if (active && stored && isActiveEntry(stored)) setEntry(stored);
    });
    return () => {
      active = false;
    };
  }, [entries, entryId]);

  const openDraft = useCallback(
    (draft: RatingDraft, filmId: number) => {
      const target = resumeTarget(draft);
      if (target.screen === 'aspect') {
        navigation.openRating({ kind: 'rateAspect', filmId, aspectId: target.aspectId });
      } else if (target.screen === 'quick') {
        navigation.openRating({ kind: 'rateQuick', filmId });
      } else {
        navigation.openRating({ kind: 'rateResult', filmId });
      }
    },
    [navigation],
  );

  const editOptions = useCallback(
    (mode: 'quick' | 'detailed') => ({
      film: entry!.film,
      mode,
      editingEntryId: entry!.id,
      quickScore: mode === 'quick' ? entry!.quickScore : null,
      ...(mode === 'detailed' && entry!.aspects ? { aspects: entry!.aspects } : {}),
      ...(mode === 'detailed' && entry!.mode === 'quick'
        ? { previousQuickScore: entry!.quickScore }
        : {}),
    }),
    [entry],
  );

  /**
   * Editing goes through the same coordinator as any other start: an unfinished
   * rating of a *different* film must not be destroyed just because the user
   * tapped "изменить" here.
   */
  const edit = useCallback(
    async (mode: 'quick' | 'detailed') => {
      if (!entry) return;
      setMenuOpen(false);

      const outcome = await requestDraft(editOptions(mode));
      if (outcome.kind === 'conflict' || outcome.kind === 'modeConflict') {
        setConflict({ reason: outcome.kind === 'modeConflict' ? 'mode' : 'film', mode });
        return;
      }
      openDraft(outcome.draft, entry.filmId);
    },
    [entry, editOptions, openDraft],
  );

  const editAfterConfirm = useCallback(async () => {
    if (!entry || !conflict) return;
    setConflict(null);
    openDraft(await replaceDraft(editOptions(conflict.mode)), entry.filmId);
  }, [entry, conflict, editOptions, openDraft]);

  const confirmDelete = useCallback(async () => {
    if (!entry) return;
    setDeleteOpen(false);
    setMenuOpen(false);

    await remove(entry.id);
    haptics.trigger('entryDeleted', `delete:${entry.id}`);
    navigation.goBack();

    // The tombstone survives, so Undo restores the same row in its old place.
    showSnackbar('Оценка удалена', UNDO_WINDOW_MS, {
      label: 'Вернуть',
      onAction: () => {
        void restore(entry.id);
        haptics.trigger('entryRestored', `restore:${entry.id}`);
      },
    });
  }, [entry, remove, restore, haptics, navigation, showSnackbar]);

  if (!entry) return null;

  return (
    <section
      className={styles.screen}
      style={
        entry.film.dominantColor
          ? { ['--film-accent-rgb' as string]: entry.film.dominantColor }
          : undefined
      }
    >
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
        <FilmIdentity film={entry.film} size="hero" />

        <div className={styles.score}>
          <OverallStars
            displayScore={entry.displayScore}
            size="large"
            rawScore={entry.rawScore}
            showNumber
          />
          <p className={styles.phrase}>{resultPhrase(entry.displayScore)}</p>
          <p className="sr-only">Твоя оценка {formatScore(entry.rawScore)} из 5</p>
        </div>

        {entry.mode === 'detailed' && entry.aspects ? (
          <RatingBreakdown aspects={entry.aspects} />
        ) : null}
      </div>

      <DraftConflictSheet
        open={conflict !== null && activeDraft !== null}
        draft={activeDraft}
        reason={conflict?.reason ?? 'film'}
        onClose={() => setConflict(null)}
        onContinue={() => {
          setConflict(null);
          if (activeDraft) openDraft(activeDraft, activeDraft.film.filmId);
        }}
        onDiscard={editAfterConfirm}
      />

      <Sheet open={menuOpen} title="Запись" onClose={() => setMenuOpen(false)}>
        <div className={styles.menu}>
          <Button variant="secondary" block onClick={() => void edit(entry.mode)}>
            Изменить оценку
          </Button>
          {entry.mode === 'quick' ? (
            <Button variant="secondary" block onClick={() => void edit('detailed')}>
              Разобрать впечатление
            </Button>
          ) : null}
          <Button
            variant="secondary"
            block
            onClick={() => {
              setMenuOpen(false);
              navigation.openFilm({ filmId: entry.filmId, title: entry.film.title });
            }}
          >
            Открыть страницу фильма
          </Button>
          <Button
            variant="destructive"
            block
            onClick={() => {
              setMenuOpen(false);
              setDeleteOpen(true);
            }}
            data-testid="entry-delete"
          >
            Удалить запись
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={deleteOpen}
        title={`Удалить оценку «${entry.film.title}»?`}
        onClose={() => setDeleteOpen(false)}
      >
        <p className={styles.deleteText}>
          Фильм исчезнет из Дневника. Сразу после удаления его можно вернуть.
        </p>
        <div className={styles.menu}>
          <Button variant="secondary" block onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            block
            onClick={() => void confirmDelete()}
            data-testid="entry-delete-confirm"
          >
            Удалить
          </Button>
        </div>
      </Sheet>
    </section>
  );
};
