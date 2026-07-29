import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RatingValue } from '@domain/rating/rating.types';
import { StarShape } from '@shared/ui/Star/StarShape';
import {
  measureGeometry,
  resolveAxis,
  stepValue,
  valueFromPosition,
  type StarGeometry,
} from './starGeometry';
import styles from './StarRating.module.css';

export type RatingSource = 'tap' | 'drag' | 'keyboard';

export interface StarRatingProps {
  /** null means "not rated yet". The scale itself is 1-5. */
  value: RatingValue | null;
  /** Fires on every new whole star while dragging — cheap, never persisted. */
  onPreview?: (value: RatingValue) => void;
  /** Fires when a value is settled. This is what the draft stores. */
  onCommit: (value: RatingValue, source: RatingSource) => void;
  /** What is being rated — names the radio group. */
  label: string;
  disabled?: boolean;
  reducedMotion?: boolean;
  /** One subtle selection per new whole star, throttled upstream. */
  onHaptic?: (value: RatingValue) => void;
  /** Fired on pointerdown so the parent can cancel pending timers. */
  onInteractionStart?: () => void;
  size?: 'large' | 'compact';
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * The interactive star control (spec §12-14).
 *
 * A radio group: five radios, one checked. Tap, horizontal drag and keyboard
 * all go through one mapping function. It knows nothing about drafts or
 * storage — it reports preview and commit, and the caller decides what to keep.
 */
export const StarRating = ({
  value,
  onPreview,
  onCommit,
  label,
  disabled = false,
  reducedMotion = false,
  onHaptic,
  onInteractionStart,
  size = 'large',
}: StarRatingProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const starRefs = useRef<(HTMLElement | null)[]>([]);
  const geometry = useRef<StarGeometry>({ centers: [] });

  /** What is shown right now: the drag preview while dragging, else the prop. */
  const [preview, setPreview] = useState<RatingValue | null>(value);
  const [dragging, setDragging] = useState(false);

  const pointerId = useRef<number | null>(null);
  /** Which star has focus, so Space and Enter know what to select. */
  const focusedStar = useRef<RatingValue | null>(null);
  const frame = useRef<number | null>(null);
  const pendingX = useRef<number | null>(null);
  const lastValue = useRef<RatingValue | null>(value);
  /**
   * The last value this control itself reported. The store is async, so the
   * prop lags a tick behind fast input; without this the sync effect below
   * would reset the working value to a stale prop and swallow keystrokes.
   */
  const lastEmitted = useRef<RatingValue | null>(value);
  const axis = useRef<'undecided' | 'horizontal' | 'vertical'>('undecided');
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const instanceId = useId();

  useEffect(() => {
    // Only adopt a value that came from outside, not our own change echoing back.
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setPreview(value);
    lastValue.current = value;
  }, [value]);

  const shown = dragging ? preview : value;

  const applyValue = useCallback(
    (
      next: RatingValue,
      source: RatingSource,
      commit: boolean,
      /**
       * The first press is silent: until the axis is proven horizontal the
       * gesture may still be a scroll, and buzzing for a value the user never
       * chose is worse than buzzing late.
       */
      haptic = true,
    ) => {
      const changed = lastValue.current !== next;
      if (changed) {
        lastValue.current = next;
        lastEmitted.current = next;
        setPreview(next);
        onPreview?.(next);
      }
      if (haptic && (changed || commit)) onHaptic?.(next);
      if (commit) onCommit(next, source);
    },
    [onCommit, onPreview, onHaptic],
  );

  /* --- pointer ---------------------------------------------------------- */

  const processFrame = useCallback(() => {
    frame.current = null;
    const x = pendingX.current;
    if (x === null) return;
    pendingX.current = null;
    applyValue(valueFromPosition(x, geometry.current), 'drag', false);
  }, [applyValue]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const stars = starRefs.current.filter((star): star is HTMLElement => star !== null);
    geometry.current = measureGeometry(stars);

    pointerId.current = event.pointerId;
    startPoint.current = { x: event.clientX, y: event.clientY };
    axis.current = event.pointerType === 'mouse' ? 'horizontal' : 'undecided';
    setDragging(true);

    /*
     * A mouse gesture is horizontal from the first pixel, so capture it at
     * once: without capture a drag that leaves the control stops updating and
     * the button-up never arrives — the control stays stuck mid-drag. Touch
     * captures only once the axis is decided, so a vertical scroll is still
     * the page's to keep.
     */
    if (event.pointerType === 'mouse') {
      trackRef.current?.setPointerCapture?.(event.pointerId);
    }

    // Touching the control cancels whatever the parent had pending, such as an
    // auto-advance timer — the screen must not move out from under the finger.
    onInteractionStart?.();
    applyValue(valueFromPosition(event.clientX, geometry.current), 'tap', false, false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || pointerId.current !== event.pointerId) return;

    if (axis.current === 'undecided') {
      const start = startPoint.current;
      if (!start) return;
      const resolved = resolveAxis(event.clientX - start.x, event.clientY - start.y);
      if (resolved === 'undecided') return;
      if (resolved === 'vertical') {
        // The page is scrolling: hand the gesture back untouched.
        axis.current = 'vertical';
        setDragging(false);
        setPreview(value);
        lastValue.current = value;
        pointerId.current = null;
        return;
      }
      axis.current = 'horizontal';
      trackRef.current?.setPointerCapture?.(event.pointerId);
      onHaptic?.(lastValue.current ?? 1);
    }

    if (axis.current !== 'horizontal') return;
    // Now that the gesture is ours, the page must not scroll under it.
    event.preventDefault();
    pendingX.current = event.clientX;
    // One update per frame, never one per pointer pixel.
    if (frame.current === null) frame.current = requestAnimationFrame(processFrame);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    startPoint.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pendingX.current = null;
    setDragging(false);

    if (cancelled) {
      // A cancelled gesture decides nothing: back to the confirmed value.
      setPreview(value);
      lastValue.current = value;
      return;
    }
    if (axis.current === 'vertical') return;

    applyValue(
      valueFromPosition(event.clientX, geometry.current),
      axis.current === 'horizontal' ? 'drag' : 'tap',
      true,
    );
  };

  /* --- keyboard --------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = lastValue.current;

    const commit = (next: RatingValue) => {
      event.preventDefault();
      applyValue(next, 'keyboard', true);
    };

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        return commit(stepValue(current, 1));
      case 'ArrowLeft':
      case 'ArrowDown':
        return commit(stepValue(current, -1));
      case 'Home':
        return commit(1);
      case 'End':
        return commit(5);
      // The standard radio keys: they select what is focused (P0.3.1 §11.1).
      case ' ':
      case 'Spacebar':
      case 'Enter':
        return commit(current ?? focusedStar.current ?? 1);
      default: {
        const digit = Number(event.key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= 5) commit(digit as RatingValue);
      }
    }
  };

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <div
      ref={trackRef}
      className={styles.group}
      role="radiogroup"
      aria-label={label}
      data-size={size}
      data-dragging={dragging || undefined}
      data-reduced={reducedMotion || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      // Capture lost to the browser (a system gesture, another element): the
      // control must not stay in a dragging state nobody can end.
      onLostPointerCapture={(event) => endDrag(event, true)}
      onKeyDown={onKeyDown}
      data-testid="star-rating"
    >
      {STARS.map((star) => {
        const checked = shown === star;
        return (
          <span
            key={star}
            className={styles.star}
            role="radio"
            aria-checked={checked}
            aria-label={`${star} из 5`}
            // Roving tabindex: the group is one stop, arrows move within it.
            tabIndex={disabled ? -1 : checked || (shown === null && star === 1) ? 0 : -1}
            data-filled={shown !== null && shown >= star ? true : undefined}
            data-current={checked || undefined}
            onFocus={() => {
              focusedStar.current = star;
            }}
            ref={(node) => {
              starRefs.current[star - 1] = node;
            }}
          >
            <StarShape
              fill={shown !== null && shown >= star ? 1 : 0}
              className={styles.shape}
              id={`${instanceId}-${star}`}
            />
          </span>
        );
      })}
    </div>
  );
};
