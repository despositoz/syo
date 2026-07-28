import { useCallback, useEffect, useRef, useState } from 'react';
import {
  aspectAtStep,
  CURRENT_TOTAL_LABEL,
  DEEP_STEP_COUNT,
} from '@domain/rating/rating.constants';
import { calculateDeepResult } from '@domain/rating/rating.calculator';
import { nextStep } from '@domain/rating/rating.machine';
import type { RatingValue } from '@domain/rating/rating.types';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { StarRating } from '@shared/ui/StarRating/StarRating';
import { useRatingStore } from '../model/rating.store';
import { useRatingFlow, useRatingRouteGuard } from '../model/useRatingFlow';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { RatingProgress } from '../components/RatingProgress';
import { RatingSummary } from '../components/RatingSummary';
import { ExitDraftSheet } from '../components/ExitDraftSheet';
import styles from './DeepRatingPage.module.css';

export interface DeepRatingPageProps {
  filmId: number;
  step: number;
}

/** Settle before moving on, so the confirmed star is actually seen (spec §23). */
const AUTO_ADVANCE_MS = 380;
const AUTO_ADVANCE_REDUCED_MS = 140;

/**
 * The five aspects (spec §16-23).
 *
 * One question at a time; the running total stays put and only fills in.
 * Nothing advances until a value is committed by pointer, and a new touch
 * cancels a pending advance.
 */
export const DeepRatingPage = ({ filmId, step }: DeepRatingPageProps) => {
  const guard = useRatingRouteGuard(filmId, 'deep', step);
  const { draft, navigation, goBack, onStarHaptic, canOpen, haptics } = useRatingFlow(
    filmId,
    'deep',
  );

  const setAspect = useRatingStore((state) => state.setAspect);
  const goToStep = useRatingStore((state) => state.goToStep);
  const discard = useRatingStore((state) => state.discard);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);

  const [exitOpen, setExitOpen] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const cancelAdvance = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancelAdvance, [cancelAdvance, step]);

  const moveTo = useCallback(
    (next: number, how: 'forward' | 'back') => {
      cancelAdvance();
      setDirection(how);
      void goToStep(next).catch(() => undefined);
      navigation.openRating({ kind: 'rateDeep', filmId, step: next }, true);
    },
    [goToStep, navigation, filmId, cancelAdvance],
  );

  const proceed = useCallback(() => {
    cancelAdvance();
    const current = useRatingStore.getState().draft;
    if (!current) return;

    const next = nextStep(current);
    if (next === 'result') {
      haptics.trigger('ratingStepComplete', 'result');
      navigation.openRating({ kind: 'rateResult', filmId }, true);
      return;
    }
    if (next !== current.currentStep) {
      haptics.trigger('ratingStepComplete', `step:${next}`);
      moveTo(next, 'forward');
    }
  }, [navigation, filmId, cancelAdvance, moveTo, haptics]);

  const aspect = aspectAtStep(step);

  const onCommit = useCallback(
    (value: RatingValue) => {
      if (!aspect) return;
      cancelAdvance();
      void setAspect(aspect.id, value).then(
        () => {
          timer.current = setTimeout(
            proceed,
            reducedMotion ? AUTO_ADVANCE_REDUCED_MS : AUTO_ADVANCE_MS,
          );
        },
        () => {
          // The answer never reached storage: stay here beside the retry
          // instead of moving past a value that exists only in memory.
        },
      );
    },
    [setAspect, aspect, proceed, cancelAdvance, reducedMotion],
  );

  if (guard === 'redirecting' || !draft || !aspect) return null;

  const value = draft.aspects[aspect.id];
  const running = calculateDeepResult(draft.aspects);

  return (
    <RatingFlowShell
      onBack={() => goBack(draft)}
      onClose={() => setExitOpen(true)}
      accentRgb={draft.dominantColor ?? undefined}
      headerCenter={
        <RatingProgress
          aspects={draft.aspects}
          currentStep={step}
          canOpen={canOpen}
          onSelect={(next) => moveTo(next, next < step ? 'back' : 'forward')}
        />
      }
    >
      <div className={styles.content}>
        <div className={styles.top}>
          <FilmIdentity
            film={{
              filmId: draft.filmId,
              filmTitle: draft.filmTitle,
              posterPath: draft.posterPath,
              backdropPath: draft.backdropPath,
              releaseYear: draft.releaseYear,
            }}
          />
          {/* The running total holds one position for the whole flow. */}
          <RatingSummary
            overallRating={running?.overallRating ?? null}
            preciseRating={running?.preciseRating}
            label={CURRENT_TOTAL_LABEL}
            showNumber={Boolean(running)}
          />
        </div>

        <div
          className={styles.panel}
          key={aspect.id}
          ref={panelRef}
          data-direction={direction}
          data-reduced={reducedMotion || undefined}
        >
          <h1 className={styles.title}>{aspect.title}</h1>
          <p className={styles.subtitle}>{aspect.subtitle}</p>

          <StarRating
            value={value}
            onCommit={onCommit}
            onInteractionStart={cancelAdvance}
            label={aspect.title}
            reducedMotion={reducedMotion}
            onHaptic={onStarHaptic}
          />

          <div className={styles.extremes} aria-hidden="true">
            <span>{aspect.lowLabel}</span>
            <span>{aspect.highLabel}</span>
          </div>
        </div>

        <p className="sr-only">
          Шаг {step + 1} из {DEEP_STEP_COUNT}
        </p>
      </div>

      <ExitDraftSheet
        open={exitOpen}
        editing={Boolean(draft.editingEntryId)}
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
