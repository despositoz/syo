import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RatingValue } from '@domain/rating/rating.types';
import { StarShape } from '@shared/ui/Star/StarShape';
import {
  fractionFromPosition,
  measureGeometry,
  stepValue,
  valueFromPosition,
  type StarGeometry,
} from './starGeometry';
import styles from './StarRatingControl.module.css';

export type RatingSource = 'tap' | 'drag' | 'keyboard';

export interface StarRatingControlProps {
  /** null means "not rated yet". 0 is a real, deliberate score. */
  value: RatingValue | null;
  /** Fires on every new integer while dragging — cheap, never persisted. */
  onPreview?: (value: RatingValue, source: RatingSource) => void;
  /** Fires when a value is settled. This is what the draft stores. */
  onCommit: (value: RatingValue, source: RatingSource) => void;
  /** Enter / explicit confirmation, used by the keyboard path. */
  onConfirm?: () => void;
  /** What is being rated — becomes the slider's accessible name. */
  label: string;
  /** Word for the current value, e.g. "Захватил". */
  stateLabel: string;
  /** Extremes shown under the stars. */
  lowLabel?: string;
  highLabel?: string;
  disabled?: boolean;
  reducedMotion?: boolean;
  /** Semantic haptic, throttled by the HapticManager upstream. */
  onHaptic?: (value: RatingValue, reachedMaximum: boolean) => void;
  size?: 'large' | 'compact';
}

const STARS = [1, 2, 3, 4, 5] as const;

/** Group scale per value (spec §9.13) — inside a reserved box, so no jump. */
const GROUP_SCALE = [0.96, 0.975, 0.99, 1, 1.02, 1.035] as const;

/**
 * The interactive star control (spec §9).
 *
 * One focusable root with `role="slider"`, one pointer surface, one mapping
 * function for tap, drag and keyboard. It knows nothing about drafts or
 * storage: it reports preview and commit, and the caller decides what to
 * persist.
 */
export const StarRatingControl = ({
  value,
  onPreview,
  onCommit,
  onConfirm,
  label,
  stateLabel,
  lowLabel,
  highLabel,
  disabled = false,
  reducedMotion = false,
  onHaptic,
  size = 'large',
}: StarRatingControlProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const starRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const geometry = useRef<StarGeometry>({ centers: [] });

  /** Value shown right now: the drag preview while dragging, else the prop. */
  const [preview, setPreview] = useState<RatingValue | null>(value);
  const [dragging, setDragging] = useState(false);

  const pointerId = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const pendingX = useRef<number | null>(null);
  const lastValue = useRef<RatingValue | null>(value);
  /** Horizontal intent is undecided until the finger moves enough. */
  const intent = useRef<'undecided' | 'horizontal' | 'vertical'>('undecided');
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  /** The maximum flourish plays once per interaction, not per pointermove. */
  const maximumFired = useRef(false);
  const instanceId = useId();

  useEffect(() => {
    setPreview(value);
    lastValue.current = value;
  }, [value]);

  const shown = dragging ? preview : value;

  /** Writes the continuous follow position without a React render. */
  const writeFollow = useCallback((fraction: number) => {
    rootRef.current?.style.setProperty('--star-follow', fraction.toFixed(3));
  }, []);

  const applyValue = useCallback(
    (next: RatingValue, source: RatingSource, commit: boolean) => {
      const changed = lastValue.current !== next;
      if (changed) {
        lastValue.current = next;
        setPreview(next);
        onPreview?.(next, source);
        if (next !== 5) maximumFired.current = false;
        const reachedMaximum = next === 5 && !maximumFired.current;
        if (reachedMaximum) maximumFired.current = true;
        onHaptic?.(next, reachedMaximum);
      }
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

    writeFollow(fractionFromPosition(x, geometry.current));
    applyValue(valueFromPosition(x, geometry.current), 'drag', false);
  }, [applyValue, writeFollow]);

  const scheduleFrame = useCallback(
    (x: number) => {
      pendingX.current = x;
      // One update per frame, never one per pointer pixel (spec §9.11).
      if (frame.current === null) frame.current = requestAnimationFrame(processFrame);
    },
    [processFrame],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const stars = starRefs.current.filter((star): star is HTMLSpanElement => star !== null);
    geometry.current = measureGeometry(stars);

    pointerId.current = event.pointerId;
    startPoint.current = { x: event.clientX, y: event.clientY };
    intent.current = event.pointerType === 'mouse' ? 'horizontal' : 'undecided';
    maximumFired.current = false;
    setDragging(true);

    // Press preview is immediate: the finger must never wait for a frame.
    writeFollow(fractionFromPosition(event.clientX, geometry.current));
    applyValue(valueFromPosition(event.clientX, geometry.current), 'tap', false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || pointerId.current !== event.pointerId) return;

    if (intent.current === 'undecided') {
      const start = startPoint.current;
      if (!start) return;
      const dx = Math.abs(event.clientX - start.x);
      const dy = Math.abs(event.clientY - start.y);
      // Vertical scrolling stays possible until a horizontal drag is proven.
      if (dy > dx && dy > 6) {
        intent.current = 'vertical';
        setDragging(false);
        pointerId.current = null;
        return;
      }
      if (dx > 4) {
        intent.current = 'horizontal';
        trackRef.current?.setPointerCapture?.(event.pointerId);
      } else {
        return;
      }
    }

    if (intent.current !== 'horizontal') return;
    // Now that the gesture is ours, the page must not scroll under it.
    event.preventDefault();
    scheduleFrame(event.clientX);
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
      // Back to the last confirmed value — a cancelled gesture decides nothing.
      setPreview(value);
      lastValue.current = value;
      writeFollow(value ?? 0);
      return;
    }
    if (intent.current === 'vertical') return;

    const next = valueFromPosition(event.clientX, geometry.current);
    applyValue(next, intent.current === 'horizontal' ? 'drag' : 'tap', true);
  };

  /* --- keyboard --------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = lastValue.current;

    const commit = (next: RatingValue) => {
      event.preventDefault();
      // Keyboard commits immediately but never auto-advances (spec §8.8).
      applyValue(next, 'keyboard', true);
    };

    switch (event.key) {
      // ±1 from wherever the control is. From "not rated" that means the first
      // right press lands on 1; zero stays deliberate, via Home or a left press.
      case 'ArrowRight':
      case 'ArrowUp':
        return commit(stepValue(current, 1));
      case 'ArrowLeft':
      case 'ArrowDown':
        return commit(stepValue(current, -1));
      case 'Home':
        return commit(0);
      case 'End':
        return commit(5);
      case 'Enter':
      case ' ':
        event.preventDefault();
        onConfirm?.();
        return;
      default: {
        const digit = Number(event.key);
        if (Number.isInteger(digit) && digit >= 0 && digit <= 5) commit(digit as RatingValue);
      }
    }
  };

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const valueText =
    shown === null ? 'Оценка не выбрана' : `${shown} из 5${stateLabel ? `, ${stateLabel}` : ''}`;

  return (
    <div
      className={styles.control}
      ref={rootRef}
      data-size={size}
      data-dragging={dragging || undefined}
      data-unrated={shown === null || undefined}
      style={{ ['--star-scale' as string]: String(GROUP_SCALE[shown ?? 3] ?? 1) }}
    >
      <div
        ref={trackRef}
        className={styles.track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={5}
        // Omitted entirely until a value exists — an unrated control has no value.
        aria-valuenow={shown === null ? undefined : shown}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
        onKeyDown={onKeyDown}
        data-testid="star-rating"
      >
        {/* Zero lives inside the slider's own hit area: no nested control. */}
        <span className={styles.zero} aria-hidden="true" data-active={shown === 0 || undefined}>
          0
        </span>

        <span className={styles.stars}>
          {STARS.map((star, index) => (
            <span
              key={star}
              className={styles.star}
              ref={(node) => {
                starRefs.current[index] = node;
              }}
              data-filled={shown !== null && shown >= star ? true : undefined}
              data-current={shown === star || undefined}
            >
              <StarShape
                fill={shown !== null && shown >= star ? 1 : 0}
                className={styles.shape}
                id={`${instanceId}-${star}`}
              />
            </span>
          ))}
        </span>

        {!reducedMotion && shown === 5 ? (
          <span className={styles.wave} aria-hidden="true" key="wave" />
        ) : null}
      </div>

      {lowLabel && highLabel ? (
        <div className={styles.extremes} aria-hidden="true">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      ) : null}
    </div>
  );
};
