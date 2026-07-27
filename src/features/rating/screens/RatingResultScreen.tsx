import { useCallback, useState } from 'react';
import { calculateResult, quickResult, formatScore } from '@domain/rating/rating.calculation';
import { resultPhrase } from '@domain/rating/rating.constants';
import { StorageError } from '@shared/storage/db';
import { Button } from '@shared/ui/Button/Button';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { useJournalStore } from '@features/journal/model/journal.store';
import { useRatingStore } from '../model/rating.store';
import { useRatingFlow, useRatingRouteGuard } from '../model/useRatingFlow';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { OverallStars } from '../components/OverallStars';
import { RatingBreakdown } from '../components/RatingBreakdown';
import styles from './RatingResultScreen.module.css';

export interface RatingResultScreenProps {
  filmId: number;
}

/**
 * The result and the save (spec §11).
 *
 * The total is computed, never editable. Saving is local-first: the entry is
 * committed to IndexedDB, sync is queued, and the Diary opens immediately.
 */
export const RatingResultScreen = ({ filmId }: RatingResultScreenProps) => {
  const guard = useRatingRouteGuard(filmId, 'result');
  const { draft, navigation, goBack, haptics } = useRatingFlow(filmId);

  const discard = useRatingStore((state) => state.discard);
  const saveFromDraft = useJournalStore((state) => state.saveFromDraft);
  const showSnackbar = useSnackbarStore((state) => state.show);
  const watchlist = useWatchlistStore((state) => state.entries);
  const toggleWatchlist = useWatchlistStore((state) => state.toggle);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);

  const detailed = draft?.mode === 'detailed';

  const onSave = useCallback(async () => {
    // A second tap while the first is in flight must not create a second entry.
    if (!draft || saving) return;
    setSaving(true);
    setError(null);

    try {
      await saveFromDraft(draft);
      haptics.trigger('ratingSaved', `save:${draft.film.filmId}`);

      const wasInWatchlist = Boolean(watchlist[draft.film.filmId]);
      if (wasInWatchlist) {
        const summary = {
          id: draft.film.filmId,
          title: draft.film.title,
          year: draft.film.releaseYear ? String(draft.film.releaseYear) : '',
          posterPath: draft.film.posterPath ?? '',
          accent: { hex: '#6f2a35', rgb: draft.film.dominantColor ?? '111, 42, 53' },
        };
        // A failing watchlist write must not undo a saved rating.
        await toggleWatchlist(summary as never).catch(() => undefined);
        showSnackbar('Оценка сохранена. Фильм убран из «Посмотреть позже»', 6000);
      } else {
        showSnackbar('Оценка сохранена');
      }

      /*
       * Navigate first, clear the draft second. The route guard on this screen
       * redirects whenever there is no draft for this film — clearing it while
       * the result screen is still mounted would bounce the user straight back
       * into the flow instead of into the Diary. The entry is already committed
       * locally, so the draft is safe to drop right after the route changes.
       */
      navigation.showJournal();
      await discard();
    } catch (caught) {
      haptics.trigger('storageWarning', 'save-failed');
      setError(caught instanceof StorageError ? caught : new StorageError('unknown', caught));
    } finally {
      setSaving(false);
    }
  }, [
    draft,
    saving,
    saveFromDraft,
    discard,
    haptics,
    watchlist,
    toggleWatchlist,
    showSnackbar,
    navigation,
  ]);

  if (guard === 'redirecting' || !draft) return null;

  const result = detailed ? calculateResult(draft.aspects) : quickResult(draft.quickScore ?? 0);

  return (
    <RatingFlowShell
      onBack={() => goBack(draft)}
      accentRgb={draft.film.dominantColor}
      footer={
        <>
          {error ? (
            <p className={styles.error} role="alert">
              Не получилось сохранить оценку на устройстве.
            </p>
          ) : null}
          <Button
            variant="primary"
            block
            disabled={saving}
            onClick={() => void onSave()}
            data-testid="result-save"
          >
            {saving ? 'Сохраняем' : error ? 'Повторить' : 'Сохранить оценку'}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <FilmIdentity film={draft.film} size="hero" />

        <div className={styles.score}>
          <OverallStars
            displayScore={result.displayScore}
            size="large"
            rawScore={result.rawAverage}
            showNumber
          />
          <p className={styles.phrase}>{resultPhrase(result.displayScore)}</p>
          <p className={styles.sr}>
            {formatScore(result.rawAverage)} из 5 — {resultPhrase(result.displayScore)}
          </p>
        </div>

        {/* Breakdown belongs to the detailed path only. */}
        {detailed ? <RatingBreakdown aspects={draft.aspects} /> : null}
      </div>
    </RatingFlowShell>
  );
};
