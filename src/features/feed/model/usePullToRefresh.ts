import { useRef, useState } from 'react';
import type React from 'react';
import type { RefObject } from 'react';

/**
 * Pull to refresh, on the feed root only (P0.4 §21).
 *
 * It starts only at the very top and only on a downward intent, and it never
 * calls `preventDefault` before the gesture is unambiguous — fighting the
 * platform for a scroll that was never ours is how a Mini App ends up feeling
 * broken. If the gesture is not clearly a pull, the page keeps it.
 */

export type PullState = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'settling';

/** How far the marker travels before the release means anything. */
const THRESHOLD = 72;
/** Resistance: the pull is deliberate, not accidental. */
const RESISTANCE = 0.45;
const MAX_PULL = 120;

export interface PullToRefreshOptions {
  scrollRef: RefObject<HTMLElement | null>;
  onRefresh: () => Promise<unknown>;
  onArmed?: () => void;
  disabled?: boolean;
}

export const usePullToRefresh = ({
  scrollRef,
  onRefresh,
  onArmed,
  disabled,
}: PullToRefreshOptions) => {
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<PullState>('idle');

  const pointerId = useRef<number | null>(null);
  const startY = useRef(0);
  const claimed = useRef(false);
  const armedOnce = useRef(false);

  const reset = () => {
    pointerId.current = null;
    claimed.current = false;
    armedOnce.current = false;
    setProgress(0);
    setState('idle');
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (disabled || state === 'refreshing') return;
    // Only from the very top (§21.2).
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return;
    pointerId.current = event.pointerId;
    startY.current = event.clientY;
    claimed.current = false;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (pointerId.current !== event.pointerId) return;
    const delta = event.clientY - startY.current;

    if (!claimed.current) {
      // Upward, or sideways, or the list has scrolled: not our gesture.
      if (delta <= 8) {
        if (delta < 0) pointerId.current = null;
        return;
      }
      if ((scrollRef.current?.scrollTop ?? 0) > 0) {
        pointerId.current = null;
        return;
      }
      claimed.current = true;
      setState('pulling');
    }

    const pulled = Math.min(MAX_PULL, delta * RESISTANCE);
    setProgress(pulled);

    const armed = pulled >= THRESHOLD;
    if (armed && !armedOnce.current) {
      // Exactly one haptic per gesture, on first crossing (§21.4).
      armedOnce.current = true;
      onArmed?.();
    }
    setState(armed ? 'armed' : 'pulling');
  };

  const finish = async (event: React.PointerEvent<HTMLElement>) => {
    if (pointerId.current !== event.pointerId) return;
    const armed = progress >= THRESHOLD;
    pointerId.current = null;
    claimed.current = false;
    armedOnce.current = false;

    if (!armed) {
      // Below the line: no refresh, no haptic, no message (§21.5).
      setProgress(0);
      setState('idle');
      return;
    }

    setState('refreshing');
    setProgress(THRESHOLD * 0.6);
    try {
      await onRefresh();
    } finally {
      setState('settling');
      setProgress(0);
      // The marker settles rather than snapping away.
      setTimeout(() => setState('idle'), 240);
    }
  };

  return {
    progress,
    state,
    /** True while the marker should be visible at all. */
    active: state !== 'idle',
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => void finish(event),
      onPointerCancel: () => reset(),
    },
  };
};
