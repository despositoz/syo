import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigationController } from '@app/appServices';
import { groupByMonth } from '@domain/journal/journal.validation';
import { resumeTarget } from '@domain/rating/rating.machine';
import type { JournalEntry } from '@domain/journal/journal.types';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { Button } from '@shared/ui/Button/Button';
import { Poster } from '@shared/ui/Poster/Poster';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { GridIcon, ListIcon } from '@shared/ui/icons';
import { plural } from '@shared/utils/text';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useJournalStore } from '../model/journal.store';
import { JournalCard } from '../components/JournalCard';
import { ActiveDraftCard } from '../components/ActiveDraftCard';
import styles from './JournalScreen.module.css';

/**
 * The Diary (spec §16).
 *
 * Local entries render immediately — there is no skeleton over data that is
 * already on the device. Order: header, active draft, watch later, history.
 */
export const JournalScreen = () => {
  const navigation = useNavigationController();

  const entries = useJournalStore((state) => state.entries);
  const hydrated = useJournalStore((state) => state.hydrated);
  const view = useJournalStore((state) => state.view);
  const setView = useJournalStore((state) => state.setView);
  const hydrate = useJournalStore((state) => state.hydrate);
  const highlightedId = useJournalStore((state) => state.highlightedId);
  const clearHighlight = useJournalStore((state) => state.clearHighlight);

  const draft = useRatingStore((state) => state.draft);
  const discardDraft = useRatingStore((state) => state.discard);
  const watchlist = useWatchlistStore((state) => state.entries);
  const showSnackbar = useSnackbarStore((state) => state.show);

  const [months, setMonths] = useState<ReturnType<typeof groupByMonth>>([]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setMonths(groupByMonth(entries));
  }, [entries]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(clearHighlight, 1600);
    return () => clearTimeout(timer);
  }, [highlightedId, clearHighlight]);

  const watchlistItems = useMemo(
    () => Object.values(watchlist).sort((left, right) => right.addedAt - left.addedAt),
    [watchlist],
  );

  const openEntry = useCallback(
    (entry: JournalEntry) => navigation.openJournalEntry(entry.id),
    [navigation],
  );

  const continueDraft = useCallback(() => {
    if (!draft) return;
    const target = resumeTarget(draft);
    const filmId = draft.film.filmId;
    if (target.screen === 'aspect') {
      navigation.openRating({ kind: 'rateAspect', filmId, aspectId: target.aspectId });
    } else if (target.screen === 'quick') {
      navigation.openRating({ kind: 'rateQuick', filmId });
    } else {
      navigation.openRating({ kind: 'rateResult', filmId });
    }
  }, [draft, navigation]);

  const isEmpty = hydrated && entries.length === 0 && !draft;

  return (
    <div className={styles.page}>
      <div className={`${styles.scroll} scroll-y`}>
        <main className={styles.content}>
          <header className={styles.header}>
            <h1 className={styles.title}>Дневник</h1>

            {entries.length > 0 ? (
              <div className={styles.viewToggle} role="group" aria-label="Вид списка">
                <button
                  type="button"
                  className={styles.viewButton}
                  aria-pressed={view === 'grid'}
                  aria-label="Сеткой"
                  onClick={() => void setView('grid')}
                  data-testid="view-grid"
                >
                  <GridIcon />
                </button>
                <button
                  type="button"
                  className={styles.viewButton}
                  aria-pressed={view === 'list'}
                  aria-label="Списком"
                  onClick={() => void setView('list')}
                  data-testid="view-list"
                >
                  <ListIcon />
                </button>
              </div>
            ) : null}
          </header>

          {draft ? (
            <ActiveDraftCard
              draft={draft}
              onContinue={continueDraft}
              onDelete={() => {
                void discardDraft();
                showSnackbar('Черновик удалён');
              }}
            />
          ) : null}

          {watchlistItems.length ? (
            <section aria-labelledby="watchlist-title">
              <h2 className={styles.sectionTitle} id="watchlist-title">
                Посмотреть позже · {watchlistItems.length}{' '}
                {plural(watchlistItems.length, ['фильм', 'фильма', 'фильмов'])}
              </h2>
              <ul className={styles.watchlist}>
                {watchlistItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={styles.watchlistItem}
                      onClick={() => navigation.openFilm({ filmId: item.id, title: item.title })}
                    >
                      <Poster
                        title={item.title}
                        year={item.year}
                        posterPath={item.posterPath}
                        accent={item.accent}
                        width={56}
                        decorative
                      />
                      <span className={styles.watchlistTitle}>{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {isEmpty ? (
            <section className={styles.empty}>
              <h2 className={styles.emptyTitle}>Пока ни одного фильма</h2>
              <p className={styles.emptyText}>Оцени фильм — он появится здесь.</p>
              <Button variant="primary" onClick={() => navigation.openPicker()}>
                Оценить фильм
              </Button>
            </section>
          ) : null}

          {months.map((month) => (
            <section key={month.key} aria-labelledby={`month-${month.key}`}>
              <h2 className={styles.sectionTitle} id={`month-${month.key}`}>
                {month.label}
              </h2>
              <div className={styles.items} data-view={view}>
                {month.entries.map((entry) => (
                  <JournalCard
                    key={entry.id}
                    entry={entry}
                    view={view}
                    highlighted={entry.id === highlightedId}
                    onOpen={openEntry}
                  />
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
};
