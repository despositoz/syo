import { useEffect, useRef } from 'react';
import { usePerformanceStore } from '@app/performance/PerformanceController';

/**
 * Parallax driven by the card's own position in the viewport (P0.4 §19).
 *
 * Not by global scrollTop: a card halfway up the screen should be halfway
 * through its travel regardless of how far the feed has scrolled. The image
 * layer moves slower than its frame, which is what reads as depth.
 *
 * Nothing here touches React state. One rAF, one transform, and an
 * IntersectionObserver so offscreen cards cost nothing.
 */

export interface CardParallaxOptions {
  /** Total travel of the image layer, in px. 0 disables it. */
  travel?: number;
  /** Slight scale so the edges never enter the frame. */
  overscan?: number;
}

export const useCardParallax = <T extends HTMLElement>(options: CardParallaxOptions = {}) => {
  const frameRef = useRef<T>(null);
  const layerRef = useRef<HTMLElement>(null);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);
  const tier = usePerformanceStore((state) => state.tier);

  useEffect(() => {
    const frame = frameRef.current;
    const layer = layerRef.current;
    if (!frame || !layer) return;

    /*
     * Reduce Motion keeps a hint of depth rather than none — the spec allows
     * 6–10px — and a device that cannot hold 60fps gets none at all (§19.6,
     * §19.7). Function is identical either way.
     */
    const travel = reducedMotion ? 8 : tier === 'minimal' ? 0 : (options.travel ?? 64);

    if (travel === 0) {
      layer.style.transform = '';
      return;
    }

    const overscan = options.overscan ?? 1.08;
    let raf: number | null = null;
    let visible = false;

    const apply = () => {
      raf = null;
      const rect = frame.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      // -1 below the fold, 0 at centre, 1 above it.
      const centre = rect.top + rect.height / 2;
      const progress = Math.max(-1, Math.min(1, (viewport / 2 - centre) / (viewport / 2)));
      layer.style.transform = `translate3d(0, ${(progress * travel) / 2}px, 0) scale(${overscan})`;
    };

    const schedule = () => {
      if (!visible || raf !== null) return;
      raf = requestAnimationFrame(apply);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) schedule();
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(frame);

    // Passive: the feed's scrolling is never blocked by its own decoration.
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    apply();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      if (raf !== null) cancelAnimationFrame(raf);
      // No permanent will-change is left behind (§45).
      layer.style.transform = '';
    };
  }, [options.travel, options.overscan, reducedMotion, tier]);

  return { frameRef, layerRef };
};
