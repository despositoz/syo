import { useCallback, useState } from 'react';
import { QUICK_QUESTION, quickReaction } from '@domain/rating/rating.constants';
import type { RatingValue } from '@domain/rating/rating.types';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { Button } from '@shared/ui/Button/Button';
import { StarRating } from '@shared/ui/StarRating/StarRating';
import { useRatingStore } from '../model/rating.store';
import { useRatingFlow, useRatingRouteGuard } from '../model/useRatingFlow';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { ExitDraftSheet } from '../components/ExitDraftSheet';
import styles from './QuickRatingPage.module.css';

export interface QuickRatingPageProps {
  filmId: number;
}

/**
 * One question, five stars (spec §15).
 *
 * Nothing is preselected, and choosing does not jump ahead: the CTA enables so
 * the user can see what they picked before moving on.
 */
export const QuickRatingPage = ({ filmId }: QuickRatingPageProps) => {
  const guard = useRatingRouteGuard(filmId, 'quick');
  const { draft, navigation, goBack, onStarHaptic } = useRatingFlow(filmId, 'quick');

  const setQuick = useRatingStore((state) => state.setQuick);
  const discard = useRatingStore((state) => state.discard);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);

  const [exitOpen, setExitOpen] = useState(false);

  const value = draft?.quickRating ?? null;
  const editing = Boolean(draft?.editingEntryId);

  const onCommit = useCallback(
    (next: RatingValue) => {
      void setQuick(next).catch(() => {
        // The storage banner in the shell already says so; stay put.
      });
    },
    [setQuick],
  );

  const onContinue = useCallback(() => {
    navigation.openRating({ kind: 'rateResult', filmId }, true);
  }, [navigation, filmId]);

  if (guard === 'redirecting' || !draft) return null;

  return (
    <RatingFlowShell
      onBack={() => goBack(draft)}
      onClose={() => (value === null ? navigation.goBack() : setExitOpen(true))}
      accentRgb={draft.dominantColor ?? undefined}
      footer={
        <Button
          variant="primary"
          block
          disabled={value === null}
          onClick={onContinue}
          data-testid="quick-continue"
        >
          Продолжить
        </Button>
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
        />

        <h1 className={styles.question}>{QUICK_QUESTION}</h1>

        <StarRating
          value={value}
          onCommit={onCommit}
          label={QUICK_QUESTION}
          reducedMotion={reducedMotion}
          onHaptic={onStarHaptic}
        />

        {/* Live reaction, never a judgement of the user. */}
        <p className={styles.reaction} aria-live="polite">
          {value === null ? ' ' : quickReaction(value)}
        </p>

        {editing ? <p className={styles.editing}>Меняешь сохранённую оценку</p> : null}
      </div>

      <ExitDraftSheet
        open={exitOpen}
        editing={editing}
        onClose={() => setExitOpen(false)}
        onLeave={() => {
          setExitOpen(false);
          navigation.goBack();
        }}
        onDiscard={async () => {
          setExitOpen(false);
          await discard().catch(() => undefined);
          navigation.goBack();
        }}
      />
    </RatingFlowShell>
  );
};
