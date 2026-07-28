import { useCallback, useEffect, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { resumeTarget } from '@domain/rating/rating.machine';
import type { RatingDraft } from '@domain/rating/rating.types';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { Button } from '@shared/ui/Button/Button';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { GridIcon, ListIcon } from '@shared/ui/icons';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useDiaryStore } from '../model/diary.store';
import { DiaryEntryCard } from '../components/DiaryEntryCard';
import { ActiveDraftCard } from '../components/ActiveDraftCard';
import styles from './DiaryPage.module.css';

/** Undo stays available this long after deleting a draft (spec §37). */
const UNDO_WINDOW_MS = 6000;

/**
 * The Diary (spec §32-34): saved ratings, most recently added or edited first.
 * Not analytics, not a second Feed.
 */
export const DiaryPage = () => {
  const navigation = useNavigationController();
  const { haptics } = useServices();

  const entries = useDiaryStore((state) => state.entries);
  const hydrated = useDiaryStore((state) => state.hydrated);
  const hydrate = useDiaryStore((state) => state.hydrate);
  const view = useDiaryStore((state) => state.view);
  const setView = useDiaryStore((state) => state.setView);
  const highlightedId = useDiaryStore((state) => state.highlightedId);
  const clearHighlight = useDiaryStore((state) => state.clearHighlight);

  const draft = useRatingStore((state) => state.draft);
  const discard = useRatingStore((state) => state.discard);
  const startDraft = useRatingStore((state) => state.start);
  const showSnackbar = useSnackbarStore((state) => state.show);

  const [pendingDraft, setPendingDraft] = useState<RatingDraft | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(clearHighlight, 1600);
    return () => clearTimeout(timer);
  }, [highlightedId, clearHighlight]);

  const openEntry = useCallback(
    (entry: DiaryEntry) => navigation.openDiaryEntry(entry.id),
    [navigation],
  );

  const continueDraft = useCallback(() => {
    if (!draft) return;
    const target = resumeTarget(draft);
    switch (target.screen) {
      case 'deep':
        navigation.openRating({ kind: 'rateDeep', filmId: draft.filmId, step: target.step });
        return;
      case 'quick':
        navigation.openRating({ kind: 'rateQuick', filmId: draft.filmId });
        return;
      case 'result':
        navigation.openRating({ kind: 'rateResult', filmId: draft.filmId });
        return;
      case 'mode':
        navigation.openRating({ kind: 'rateMode', filmId: draft.filmId });
    }
  }, [draft, navigation]);

  /**
   * Deleting a draft is undoable: the copy is held for the window and written
   * back untouched if the user says so. Nothing is destroyed silently.
   */
  const deleteDraft = useCallback(async () => {
    if (!draft) return;
    const snapshot = draft;
    setPendingDraft(snapshot);
    await discard().catch(() => undefined);
    haptics.trigger('diaryEntryDeleted', `draft:${snapshot.id}`);

    showSnackbar('Черновик удалён', UNDO_WINDOW_MS, {
      label: 'Вернуть',
      onAction: () => {
        // If a new draft has appeared meanwhile, restoring would create a
        // second active one — the newer intent wins.
        if (useRatingStore.getState().draft) {
          showSnackbar('Уже начата другая оценка');
          setPendingDraft(null);
          return;
        }
        void startDraft({
          film: {
            filmId: snapshot.filmId,
            filmTitle: snapshot.filmTitle,
            posterPath: snapshot.posterPath,
            backdropPath: snapshot.backdropPath,
            releaseYear: snapshot.releaseYear,
            dominantColor: snapshot.dominantColor,
          },
          mode: snapshot.mode,
          quickRating: snapshot.quickRating,
          aspects: snapshot.aspects,
          ...(snapshot.editingEntryId ? { editingEntryId: snapshot.editingEntryId } : {}),
        }).then(() => {
          haptics.trigger('undoDelete', `draft:${snapshot.id}`);
          setPendingDraft(null);
        });
      },
    });
  }, [draft, discard, haptics, showSnackbar, startDraft]);

  const empty = hydrated && entries.length === 0 && !draft && !pendingDraft;

  return (
    <div className={styles.page}>
      <div className={`${styles.scroll} scroll-y`}>
        <main className={styles.content}>
          <header className={styles.header}>
            <h1 className={styles.title}>Дневник</h1>
            {entries.length ? <span className={styles.count}>{entries.length}</span> : null}

            {entries.length ? (
              <div className={styles.viewToggle} role="group" aria-label="Вид списка">
                <IconButton
                  label="Сетка"
                  variant="plain"
                  aria-pressed={view === 'grid'}
                  onClick={() => void setView('grid')}
                  data-testid="view-grid"
                >
                  <GridIcon />
                </IconButton>
                <IconButton
                  label="Список"
                  variant="plain"
                  aria-pressed={view === 'list'}
                  onClick={() => void setView('list')}
                  data-testid="view-list"
                >
                  <ListIcon />
                </IconButton>
              </div>
            ) : null}
          </header>

          {draft ? (
            <ActiveDraftCard
              draft={draft}
              onContinue={continueDraft}
              onDelete={() => void deleteDraft()}
            />
          ) : null}

          {empty ? (
            <div className={styles.empty}>
              <h2 className={styles.emptyTitle}>Здесь будут фильмы, которые ты оценил</h2>
              <p className={styles.emptyText}>
                Начни с фильма из Ленты или найди тот, который уже посмотрел
              </p>
              <Button variant="primary" onClick={() => navigation.openPicker()}>
                Выбрать фильм
              </Button>
            </div>
          ) : null}

          {entries.length ? (
            <ul className={styles.list} data-view={view}>
              {entries.map((entry) => (
                <li key={entry.id}>
                  <DiaryEntryCard
                    entry={entry}
                    view={view}
                    highlighted={entry.id === highlightedId}
                    onOpen={openEntry}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </main>
      </div>
    </div>
  );
};
