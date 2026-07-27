import { useCallback, useEffect, useRef, useState } from 'react';
import { aspectById, aspectIndex, ASPECT_IDS } from '@domain/rating/rating.constants';
import { calculateProvisional } from '@domain/rating/rating.calculation';
import type { RatingAspectId, RatingValue } from '@domain/rating/rating.types';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { Button } from '@shared/ui/Button/Button';
import { useRatingStore } from '../model/rating.store';
import { useRatingFlow, useRatingRouteGuard } from '../model/useRatingFlow';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { StarRatingControl } from '../components/StarRatingControl';
import { AspectProgress } from '../components/AspectProgress';
import { OverallStars } from '../components/OverallStars';
import { ExitDraftSheet } from '../components/ExitDraftSheet';
import styles from './DetailedRatingScreen.module.css';

export interface DetailedRatingScreenProps {
  filmId: number;
  aspectId: RatingAspectId;
}

/** Settle before the panel moves on, so the choice is visible first. */
const AUTO_ADVANCE_MS = 480;

/**
 * The five aspects (spec §8).
 *
 * One panel is active at a time; the overall stays put and only grows more
 * confident. Nothing auto-advances until a value is committed by pointer, and
 * a new touch cancels a pending advance.
 */
export const DetailedRatingScreen = ({ filmId, aspectId }: DetailedRatingScreenProps) => {
  const guard = useRatingRouteGuard(filmId, 'aspect', aspectId);
  const { draft, navigation, goBack, onStarHaptic, canOpen, haptics } = useRatingFlow(filmId);

  const setAspect = useRatingStore((state) => state.setAspect);
  const goToAspect = useRatingStore((state) => state.goToAspect);
  const advance = useRatingStore((state) => state.advance);
  const discard = useRatingStore((state) => state.discard);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);

  const [exitOpen, setExitOpen] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Set when the move came from the keyboard. A keyboard user who confirms an
   * aspect must land on the next control — otherwise focus stays on a slider
   * that no longer exists and the flow becomes unwalkable without a pointer.
   */
  const focusOnArrival = useRef(false);

  useEffect(() => {
    if (!focusOnArrival.current) return;
    focusOnArrival.current = false;
    panelRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
  }, [aspectId]);

  const cancelAdvance = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancelAdvance, [cancelAdvance, aspectId]);

  const moveTo = useCallback(
    (next: RatingAspectId, how: 'forward' | 'back') => {
      setDirection(how);
      haptics.trigger('aspectAdvance', `aspect:${next}`);
      void goToAspect(next);
      navigation.openRating({ kind: 'rateAspect', filmId, aspectId: next }, true);
    },
    [goToAspect, navigation, filmId, haptics],
  );

  const proceed = useCallback(async () => {
    cancelAdvance();
    const next = await advance();
    if (!next) return;
    if (next.currentScreen === 'result') {
      navigation.openRating({ kind: 'rateResult', filmId }, true);
      return;
    }
    if (next.currentAspect && next.currentAspect !== aspectId) {
      setDirection('forward');
      haptics.trigger('aspectAdvance', `aspect:${next.currentAspect}`);
      navigation.openRating(
        { kind: 'rateAspect', filmId, aspectId: next.currentAspect },
        true,
      );
    }
  }, [advance, navigation, filmId, aspectId, cancelAdvance, haptics]);

  const onCommit = useCallback(
    (value: RatingValue, source: 'tap' | 'drag' | 'keyboard') => {
      void setAspect(aspectId, value);
      cancelAdvance();
      // Keyboard never auto-advances: focus must not move under the user.
      if (source === 'keyboard') return;
      timer.current = setTimeout(() => void proceed(), AUTO_ADVANCE_MS);
    },
    [setAspect, aspectId, proceed, cancelAdvance],
  );

  /* --- horizontal swipe between aspects (never a route swipe-back) ------- */

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const point = event.touches[0];
    if (!point) return;
    // A gesture that starts on the stars belongs to the stars.
    if ((event.target as HTMLElement).closest('[role="slider"]')) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: point.clientX, y: point.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const point = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !point || !draft) return;

    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    // Vertical intent wins: scrolling must never be hijacked.
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;

    const index = aspectIndex(aspectId);
    if (dx > 0) {
      const previous = ASPECT_IDS[index - 1];
      if (previous) moveTo(previous, 'back');
      return;
    }
    // Forward only once the current aspect has a value — no accidental skip.
    if (draft.aspects[aspectId] === null) return;
    void proceed();
  };

  if (guard === 'redirecting' || !draft) return null;

  const aspect = aspectById(aspectId);
  const value = draft.aspects[aspectId];
  const provisional = calculateProvisional(draft.aspects);
  const stateLabel = value === null ? '' : aspect.states[value];

  return (
    <RatingFlowShell
      onBack={() => goBack(draft)}
      accentRgb={draft.film.dominantColor}
      onClose={() => setExitOpen(true)}
      headerCenter={
        <AspectProgress
          aspects={draft.aspects}
          current={aspectId}
          canOpen={canOpen}
          onSelect={(next) =>
            moveTo(next, aspectIndex(next) < aspectIndex(aspectId) ? 'back' : 'forward')
          }
        />
      }
      footer={
        value !== null ? (
          <Button variant="secondary" block onClick={() => void proceed()} data-testid="aspect-next">
            Дальше
          </Button>
        ) : null
      }
    >
      <div className={styles.content}>
        <div className={styles.top}>
          <FilmIdentity film={draft.film} />
          {/* The overall holds one position for the whole flow. */}
          <OverallStars
            displayScore={provisional.displayScore}
            completed={provisional.completed}
            confidence={provisional.confidence}
            label="Итог"
          />
        </div>

        <div
          className={styles.panel}
          key={aspectId}
          ref={panelRef}
          data-direction={direction}
          data-reduced={reducedMotion || undefined}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <h1 className={styles.name}>{aspect.name}</h1>
          <p className={styles.question}>{aspect.question}</p>

          <StarRatingControl
            value={value}
            onCommit={onCommit}
            onConfirm={() => {
              focusOnArrival.current = true;
              void proceed();
            }}
            label={aspect.name}
            stateLabel={stateLabel}
            lowLabel={aspect.lowLabel}
            highLabel={aspect.highLabel}
            reducedMotion={reducedMotion}
            onHaptic={onStarHaptic}
          />

          <p className={styles.state} aria-live="polite">
            {value === null ? 'Проведи по звёздам' : stateLabel}
          </p>
        </div>
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
          await discard();
          navigation.goBack();
        }}
      />
    </RatingFlowShell>
  );
};
