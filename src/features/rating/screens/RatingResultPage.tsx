import { useCallback, useState } from 'react';
import { useServices } from '@app/appServices';
import { calculateDeepResult, calculateQuickResult } from '@domain/rating/rating.calculator';
import { resultPhrase } from '@domain/rating/rating.constants';
import { StorageError } from '@shared/storage/db';
import { Button } from '@shared/ui/Button/Button';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { replaceWithWritingDraft } from '@features/drafts/draftCoordinator';
import { useRatingStore } from '../model/rating.store';
import { useRatingFlow, useRatingRouteGuard } from '../model/useRatingFlow';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { RatingSummary } from '../components/RatingSummary';
import { RatingBreakdown } from '../components/RatingBreakdown';
import styles from './RatingResultPage.module.css';

export interface RatingResultPageProps {
  filmId: number;
}

/**
 * The result (spec §26).
 *
 * Stars lead, the precise number is secondary, and the deep total is computed —
 * there is nothing here to edit by hand. Saving is local-first: the network
 * never gates it.
 */
export const RatingResultPage = ({ filmId }: RatingResultPageProps) => {
  const guard = useRatingRouteGuard(filmId, 'result');
  const { draft, navigation, goBack } = useRatingFlow(filmId, 'result');
  const { haptics } = useServices();

  const discard = useRatingStore((state) => state.discard);
  const saveFromDraft = useDiaryStore((state) => state.saveFromDraft);
  const showSnackbar = useSnackbarStore((state) => state.show);
  const watchlist = useWatchlistStore((state) => state.entries);
  const toggleWatchlist = useWatchlistStore((state) => state.toggle);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);

  const deep = draft?.mode === 'deep';
  const result = draft
    ? deep
      ? calculateDeepResult(draft.aspects)
      : draft.quickRating !== null
        ? calculateQuickResult(draft.quickRating)
        : null
    : null;

  /**
   * Saves the rating, then optionally opens the writing flow on the entry it
   * just created. Text is always a separate, optional step: the rating is
   * already safe before a single word is written (spec §4.2).
   */
  const onSave = useCallback(
    async (thenWrite = false) => {
      // A second tap while the first is in flight must not create a second entry.
      if (!draft || saving) return;
      setSaving(true);
      setError(null);

      try {
        const entry = await saveFromDraft(draft);
        haptics.trigger('ratingSaved', `save:${draft.filmId}`);

        const wasInWatchlist = Boolean(watchlist[draft.filmId]);
        const summary = {
          id: draft.filmId,
          title: draft.filmTitle,
          year: draft.releaseYear ?? '',
          posterPath: draft.posterPath ?? '',
          accent: { hex: '#6f2a35', rgb: draft.dominantColor ?? '111, 42, 53' },
        };

        if (wasInWatchlist) {
          // A failing watchlist write must never undo a saved rating.
          await toggleWatchlist(summary as never).catch(() => undefined);
          showSnackbar('Оценка сохранена. Фильм убран из «Посмотреть позже»', 6000, {
            label: 'Вернуть в список',
            onAction: () => {
              // Undo restores membership only — the rating stays saved.
              void toggleWatchlist(summary as never).catch(() => undefined);
            },
          });
        } else {
          showSnackbar('Оценка сохранена');
        }

        if (thenWrite) {
          /*
           * The writing draft is created *before* navigating: the writing
           * screen redirects when it finds no draft, and creating it after the
           * push would be a race the user would see as a bounce. Replacing is
           * what frees the shared slot — the rating draft is finished here.
           */
          await replaceWithWritingDraft({
            entryId: entry.id,
            film: {
              filmId: entry.filmId,
              filmTitle: entry.filmTitle,
              posterPath: entry.posterPath,
              releaseYear: entry.releaseYear,
              dominantColor: draft.dominantColor ?? null,
            },
            source: 'ratingResult',
          });
          navigation.showSavedEntry(entry.id, {
            kind: 'write',
            entryId: entry.id,
            screen: 'mode',
          });
        } else {
          // Navigate first, clear the draft second: the route guard on this
          // screen redirects whenever there is no draft, and clearing it while
          // still mounted would bounce the user back into the flow.
          navigation.showSavedEntry(entry.id);
          await discard().catch(() => undefined);
        }
      } catch (caught) {
        haptics.trigger('storageWarning', 'save-failed');
        setError(caught instanceof StorageError ? caught : new StorageError('unknown', caught));
      } finally {
        setSaving(false);
      }
    },
    [
      draft,
      saving,
      saveFromDraft,
      discard,
      haptics,
      watchlist,
      toggleWatchlist,
      showSnackbar,
      navigation,
    ],
  );

  if (guard === 'redirecting' || !draft || !result) return null;

  return (
    <RatingFlowShell
      onBack={() => goBack(draft)}
      accentRgb={draft.dominantColor ?? undefined}
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
            onClick={() => void onSave(false)}
            data-testid="result-save"
          >
            {saving ? 'Сохраняем' : error ? 'Повторить' : 'Сохранить оценку'}
          </Button>
          {/* Offered, never required — and it saves the rating either way. */}
          <Button
            variant="ghost"
            block
            disabled={saving}
            onClick={() => void onSave(true)}
            data-testid="result-save-and-write"
          >
            Сохранить и написать текст
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <FilmIdentity
          film={{
            filmId: draft.filmId,
            filmTitle: draft.filmTitle,
            posterPath: draft.posterPath,
            backdropPath: draft.backdropPath,
            releaseYear: draft.releaseYear,
          }}
          size="hero"
        />

        <div className={styles.score}>
          <RatingSummary
            overallRating={result.overallRating}
            preciseRating={result.preciseRating}
            size="large"
            showNumber
          />
          <p className={styles.phrase}>{resultPhrase(result.overallRating)}</p>
          {!deep ? <p className={styles.mode}>Быстрая оценка</p> : null}
        </div>

        {/* Quick has no aspects, so it never shows an empty breakdown. */}
        {deep ? <RatingBreakdown aspects={draft.aspects} /> : null}
      </div>
    </RatingFlowShell>
  );
};
