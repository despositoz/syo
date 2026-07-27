import { useCallback, useState } from 'react';
import { QUICK_STATES, UNRATED_LABEL } from '@domain/rating/rating.constants';
import type { RatingValue } from '@domain/rating/rating.types';
import { Button } from '@shared/ui/Button/Button';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { useRatingStore } from '../model/rating.store';
import { useRatingFlow, useRatingRouteGuard } from '../model/useRatingFlow';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { StarRatingControl } from '../components/StarRatingControl';
import { ExitDraftSheet } from '../components/ExitDraftSheet';
import styles from './QuickRatingScreen.module.css';

export interface QuickRatingScreenProps {
  filmId: number;
}

/**
 * One score, five whole stars (spec §7).
 *
 * Nothing is preselected: before the first deliberate action the stars are
 * empty, the label invites a gesture, and Save is genuinely disabled.
 */
export const QuickRatingScreen = ({ filmId }: QuickRatingScreenProps) => {
  const guard = useRatingRouteGuard(filmId, 'quick');
  const { draft, navigation, goBack, onStarHaptic } = useRatingFlow(filmId);

  const setQuick = useRatingStore((state) => state.setQuick);
  const switchToDetailed = useRatingStore((state) => state.switchToDetailed);
  const advance = useRatingStore((state) => state.advance);
  const discard = useRatingStore((state) => state.discard);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);

  const [exitOpen, setExitOpen] = useState(false);

  const score = draft?.quickScore ?? null;
  const editing = Boolean(draft?.editingEntryId);

  const onCommit = useCallback((value: RatingValue) => void setQuick(value), [setQuick]);

  const onContinue = useCallback(async () => {
    const next = await advance();
    if (next) navigation.openRating({ kind: 'rateResult', filmId }, true);
  }, [advance, navigation, filmId]);

  const onDetailed = useCallback(async () => {
    // Switching modes never saves a quick entry behind the user's back.
    await switchToDetailed();
    navigation.openRating({ kind: 'rateAspect', filmId, aspectId: 'story' }, true);
  }, [switchToDetailed, navigation, filmId]);

  const onClose = useCallback(() => {
    if (score === null) {
      navigation.goBack();
      return;
    }
    setExitOpen(true);
  }, [score, navigation]);

  if (guard === 'redirecting' || !draft) return null;

  return (
    <RatingFlowShell
      onBack={() => goBack(draft)}
      accentRgb={draft.film.dominantColor}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            block
            disabled={score === null}
            onClick={() => void onContinue()}
            data-testid="quick-save"
          >
            {editing ? 'Сохранить изменения' : 'Сохранить оценку'}
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => void onDetailed()}
            data-testid="quick-to-detailed"
          >
            Разобрать впечатление
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <FilmIdentity film={draft.film} />

        <div className={styles.stage}>
          <StarRatingControl
            value={score}
            onCommit={onCommit}
            label="Оценка фильма"
            stateLabel={score === null ? '' : QUICK_STATES[score]}
            reducedMotion={reducedMotion}
            onHaptic={onStarHaptic}
          />

          <p className={styles.state} aria-live="polite">
            {score === null ? UNRATED_LABEL : QUICK_STATES[score]}
          </p>

          {/* The number is secondary and only exists once a value does. */}
          {score !== null ? <p className={styles.number}>{score} из 5</p> : null}
        </div>
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
          await discard();
          navigation.goBack();
        }}
      />
    </RatingFlowShell>
  );
};
