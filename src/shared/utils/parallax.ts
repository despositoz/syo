import { useEffect, type RefObject } from 'react';

/**
 * Parallax runs on rAF and writes transforms straight to the DOM.
 * React state is never updated per frame (spec §20/§28).
 */

export interface ParallaxLayer {
  ref: RefObject<HTMLElement | null>;
  /**
   * Fraction of the natural scroll movement this layer keeps.
   * 1 = moves with the text, 0.4 = clearly slower, >1 = faster.
   */
  speed: number;
  /** Extra px of vertical drift applied on top, for ambient light. */
  drift?: number;
  /**
   * Scale the layer already has from CSS overscan. The JS transform replaces
   * the CSS one entirely, so it has to carry the scale along.
   */
  baseScale?: number;
  /** Extra scale added at a full pull-down. 0 disables the stretch. */
  stretch?: number;
}

/** Pull, in px, that buys the first full unit of stretch. */
const PULL_SOFTNESS = 180;

/**
 * Rubber-band response with no ceiling (and no visible one).
 *
 * A linear ramp clamped at some distance has a wall: past it the image stops
 * growing and the pull suddenly feels dead. This is logarithmic instead — it
 * keeps giving forever, but each further millimetre of growth costs
 * disproportionately more pull, so it just feels stiffer the further you go.
 *
 * Normalised so that the old full-pull distance still produces exactly the old
 * amount of stretch: the first, most-used part of the gesture is unchanged, and
 * only the part that used to hit the wall behaves differently.
 *
 *   180px → 1.00 unit      720px → 2.32 units
 *   360px → 1.58 units    1440px → 3.17 units
 */
export const pullGrowth = (pull: number): number => Math.log1p(pull / PULL_SOFTNESS) / Math.LN2;

const applyTransform = (element: HTMLElement, y: number, scale: number): void => {
  element.style.transform =
    scale === 1
      ? `translate3d(0, ${y.toFixed(2)}px, 0)`
      : `translate3d(0, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
};

/**
 * Film Page depth: the backdrop lags behind, text scrolls normally, and pulling
 * the page down past the top grows the backdrop a little — the standard
 * rubber-band feedback.
 *
 * The pull is read from two sources because they do not coexist: iOS WebViews
 * report a negative scrollTop (elastic overscroll), Android clamps at 0 and
 * only the finger tells us anything.
 */
export const useScrollParallax = (
  scrollRef: RefObject<HTMLElement | null>,
  layers: ParallaxLayer[],
  enabled = true,
): void => {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !enabled) return;

    let frame = 0;
    let lastSignature = '';
    let touchStartY = 0;
    let touchPull = 0;
    let tracking = false;

    const render = () => {
      frame = 0;
      const rawScrollTop = scroller.scrollTop;
      const scrollTop = Math.max(0, rawScrollTop);
      const pull = Math.max(touchPull, -rawScrollTop, 0);
      const signature = `${scrollTop}:${pull.toFixed(1)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const growth = pull > 0 ? pullGrowth(pull) : 0;

      for (const layer of layers) {
        const element = layer.ref.current;
        if (!element) continue;
        const offset = scrollTop * (1 - layer.speed) + (layer.drift ?? 0) * (scrollTop / 400);
        const scale = (layer.baseScale ?? 1) + (layer.stretch ?? 0) * growth;
        applyTransform(element, offset, scale);
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(render);
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      tracking = scroller.scrollTop <= 0;
      touchStartY = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (!tracking) {
        // The finger may reach the top mid-gesture; start measuring from there.
        if (scroller.scrollTop > 0) return;
        tracking = true;
        touchStartY = touch.clientY;
      }
      const delta = touch.clientY - touchStartY;
      const next = delta > 0 ? delta : 0;
      if (next === touchPull) return;
      touchPull = next;
      onScroll();
    };

    const onTouchEnd = () => {
      tracking = false;
      if (touchPull === 0) return;
      touchPull = 0;
      onScroll();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: true });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    render();

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      if (frame) cancelAnimationFrame(frame);
      for (const layer of layers) {
        const element = layer.ref.current;
        if (element) element.style.transform = '';
      }
    };
  }, [scrollRef, layers, enabled]);
};

/**
 * Feed depth: computed from the card's position inside the viewport, not from
 * scrollTop alone, so the effect is visible on the very first card too.
 */
export const useCardParallax = (
  scrollRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  layerRef: RefObject<HTMLElement | null>,
  options: { amplitude?: number; enabled?: boolean } = {},
): void => {
  const { amplitude = 26, enabled = true } = options;

  useEffect(() => {
    const scroller = scrollRef.current;
    const card = cardRef.current;
    const layer = layerRef.current;
    if (!scroller || !card || !layer || !enabled) return;

    let frame = 0;

    const render = () => {
      frame = 0;
      const viewportHeight = scroller.clientHeight || 1;
      const rect = card.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const cardCenter = rect.top - scrollerRect.top + rect.height / 2;
      // -1 (card above the fold) … +1 (card below the fold)
      const position = (cardCenter - viewportHeight / 2) / (viewportHeight / 2);
      const clamped = Math.max(-1.6, Math.min(1.6, position));
      applyTransform(layer, -clamped * amplitude, 1);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(render);
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    render();

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      layer.style.transform = '';
    };
  }, [scrollRef, cardRef, layerRef, amplitude, enabled]);
};
