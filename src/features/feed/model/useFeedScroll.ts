import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useFeedStore } from './feed.store';

/**
 * Header hide/reveal, exact scroll restoration and insertion without a jump
 * (P0.4 §18, §22, §23).
 *
 * The header follows the scroll, not a timer, and it refuses to flicker: it
 * only changes state after a deliberate movement. Position is remembered as an
 * *anchor item plus its offset*, because a raw scrollTop means something
 * different as soon as anything above it changes height.
 */

/** Below this a movement is a jitter, not an intention (§18.5). */
const HEADER_THRESHOLD = 24;
/** The header always returns near the top, whatever the gesture was. */
const ALWAYS_VISIBLE_ABOVE = 80;

export const useFeedScroll = (scrollRef: RefObject<HTMLElement | null>) => {
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastY = useRef(0);
  const anchorY = useRef(0);
  const savePosition = useFeedStore((state) => state.savePosition);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let raf: number | null = null;

    const read = () => {
      raf = null;
      const y = element.scrollTop;

      if (y <= ALWAYS_VISIBLE_ABOVE) {
        setHeaderVisible(true);
        anchorY.current = y;
        lastY.current = y;
        return;
      }

      const delta = y - anchorY.current;
      if (Math.abs(delta) >= HEADER_THRESHOLD) {
        setHeaderVisible(delta < 0);
        anchorY.current = y;
      }
      // A change of direction restarts the measurement, so a small wobble
      // never accumulates into a state change.
      if ((y - lastY.current) * delta < 0) anchorY.current = y;
      lastY.current = y;
    };

    const onScroll = () => {
      if (raf === null) raf = requestAnimationFrame(read);
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  /** The topmost item still on screen, and how far it sits from the top. */
  const currentAnchor = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return null;

    const containerTop = element.getBoundingClientRect().top;
    const cards = element.querySelectorAll<HTMLElement>('[data-item-id]');
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom - containerTop > 0) {
        return {
          anchorItemId: card.dataset.itemId ?? null,
          anchorOffset: Math.round(rect.top - containerTop),
          scrollTopFallback: Math.round(element.scrollTop),
        };
      }
    }
    return {
      anchorItemId: null,
      anchorOffset: 0,
      scrollTopFallback: Math.round(element.scrollTop),
    };
  }, [scrollRef]);

  /** Called before leaving for the Film Page (§22.2). */
  const rememberPosition = useCallback(async () => {
    const anchor = currentAnchor();
    if (anchor) await savePosition(anchor);
  }, [currentAnchor, savePosition]);

  /**
   * Puts the anchor back where it was, before the frame is painted. No smooth
   * scrolling: this is a restoration, not a journey (§22.3).
   */
  const restorePosition = useCallback(
    (position: {
      anchorItemId: string | null;
      anchorOffset: number;
      scrollTopFallback: number;
    }) => {
      const element = scrollRef.current;
      if (!element) return;

      if (position.anchorItemId) {
        const card = element.querySelector<HTMLElement>(
          `[data-item-id="${CSS.escape(position.anchorItemId)}"]`,
        );
        if (card) {
          const containerTop = element.getBoundingClientRect().top;
          const delta = card.getBoundingClientRect().top - containerTop - position.anchorOffset;
          element.scrollTop += delta;
          return;
        }
      }
      // The anchor is gone: the raw offset is the honest fallback (§22.5).
      element.scrollTop = position.scrollTopFallback;
    },
    [scrollRef],
  );

  /**
   * Keeps what the user is looking at exactly where it is while items are
   * inserted above it (§23.3). Measured, not guessed: the anchor's distance
   * from the top of the container is restored after the DOM has changed.
   */
  const preserveDuringUpdate = useCallback(
    <T>(apply: () => T): T => {
      const element = scrollRef.current;
      const anchor = currentAnchor();
      const result = apply();
      if (!element || !anchor?.anchorItemId) return result;

      requestAnimationFrame(() => {
        const card = element.querySelector<HTMLElement>(
          `[data-item-id="${CSS.escape(anchor.anchorItemId!)}"]`,
        );
        if (!card) return;
        const containerTop = element.getBoundingClientRect().top;
        const delta = card.getBoundingClientRect().top - containerTop - anchor.anchorOffset;
        if (Math.abs(delta) > 0.5) element.scrollTop += delta;
      });
      return result;
    },
    [currentAnchor, scrollRef],
  );

  const scrollToTop = useCallback(
    (smooth: boolean) => {
      scrollRef.current?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    },
    [scrollRef],
  );

  const atTop = useCallback(() => (scrollRef.current?.scrollTop ?? 0) <= 4, [scrollRef]);

  return {
    headerVisible,
    rememberPosition,
    restorePosition,
    preserveDuringUpdate,
    scrollToTop,
    atTop,
    currentAnchor,
  };
};
