import { useRef, useState } from 'react';
import type React from 'react';

/**
 * Horizontal swipe on a feed card (P0.4 §20).
 *
 * The hard part is not the animation, it is deciding whose gesture this is.
 * Until the direction is clear the feed keeps scrolling and nothing is
 * prevented; only once the movement is decisively horizontal does the card
 * claim the pointer. A vertical flick must never cost a haptic or a bookmark.
 */

export type SwipeDirection = 'left' | 'right';

export interface CardSwipeOptions {
  onCommit: (direction: SwipeDirection) => void;
  /** Fired once, the first time the gesture crosses the commit distance. */
  onThreshold?: (direction: SwipeDirection) => void;
  /** Right swipe is disabled for something already bookmarked (§20.2). */
  allowRight?: boolean;
  allowLeft?: boolean;
  disabled?: boolean;
}

/** Below this the axis is nobody's — the page still scrolls (§20.4). */
const AXIS_SLOP = 10;
/** Horizontal has to beat vertical by this much to claim the gesture. */
const AXIS_RATIO = 1.6;
/** Share of the card's width that commits the action (§20.6). */
const COMMIT_RATIO = 0.26;
/** A fast flick commits earlier, but never from nothing. */
const FLICK_VELOCITY = 0.6;
const FLICK_MIN_DISTANCE = 40;

export interface CardSwipeState {
  offset: number;
  direction: SwipeDirection | null;
  armed: boolean;
  dragging: boolean;
}

export const useCardSwipe = (options: CardSwipeOptions) => {
  const [state, setState] = useState<CardSwipeState>({
    offset: 0,
    direction: null,
    armed: false,
    dragging: false,
  });

  const pointerId = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const axis = useRef<'undecided' | 'horizontal' | 'vertical'>('undecided');
  const width = useRef(1);
  const armedOnce = useRef(false);
  const frame = useRef<number | null>(null);
  const pendingOffset = useRef(0);

  const allowed = (direction: SwipeDirection): boolean =>
    direction === 'right' ? options.allowRight !== false : options.allowLeft !== false;

  const reset = () => {
    pointerId.current = null;
    start.current = null;
    axis.current = 'undecided';
    armedOnce.current = false;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setState({ offset: 0, direction: null, armed: false, dragging: false });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (options.disabled) return;
    // A mouse is decisive from the first pixel; a finger is not.
    pointerId.current = event.pointerId;
    start.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    axis.current = event.pointerType === 'mouse' ? 'undecided' : 'undecided';
    width.current = event.currentTarget.getBoundingClientRect().width || 1;
    armedOnce.current = false;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (options.disabled || pointerId.current !== event.pointerId || !start.current) return;

    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;

    if (axis.current === 'undecided') {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) {
        // The feed is scrolling. Hand the gesture back untouched — no
        // preventDefault, no haptic, no state (§20.4).
        axis.current = 'vertical';
        pointerId.current = null;
        return;
      }
      axis.current = 'horizontal';
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    if (axis.current !== 'horizontal') return;

    const direction: SwipeDirection = dx > 0 ? 'right' : 'left';
    if (!allowed(direction)) {
      // Nothing to do in that direction: the card resists rather than lying.
      pendingOffset.current = dx * 0.12;
    } else {
      // 1:1 with a little resistance past the commit point.
      const commit = width.current * COMMIT_RATIO;
      pendingOffset.current =
        Math.abs(dx) <= commit ? dx : Math.sign(dx) * (commit + (Math.abs(dx) - commit) * 0.4);
    }

    event.preventDefault();

    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const offset = pendingOffset.current;
        const armed =
          allowed(offset > 0 ? 'right' : 'left') &&
          Math.abs(offset) >= width.current * COMMIT_RATIO;

        // One haptic per gesture, the first time the line is crossed (§20.7).
        if (armed && !armedOnce.current) {
          armedOnce.current = true;
          options.onThreshold?.(offset > 0 ? 'right' : 'left');
        }

        setState({
          offset,
          direction: offset === 0 ? null : offset > 0 ? 'right' : 'left',
          armed,
          dragging: true,
        });
      });
    }
  };

  const finish = (event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (pointerId.current !== event.pointerId) return;
    const started = start.current;
    const offset = pendingOffset.current;
    pendingOffset.current = 0;

    const horizontal = axis.current === 'horizontal';
    const direction: SwipeDirection = offset > 0 ? 'right' : 'left';
    const distance = Math.abs(offset);
    const elapsed = started ? Math.max(1, event.timeStamp - started.at) : 1;
    const velocity = distance / elapsed;

    const commits =
      !cancelled &&
      horizontal &&
      allowed(direction) &&
      (distance >= width.current * COMMIT_RATIO ||
        (velocity >= FLICK_VELOCITY && distance >= FLICK_MIN_DISTANCE));

    reset();
    if (commits) options.onCommit(direction);
  };

  return {
    ...state,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: React.PointerEvent<HTMLElement>) => finish(event, true),
      // Capture taken away by the browser must not leave the card mid-drag.
      onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => finish(event, true),
    },
  };
};
