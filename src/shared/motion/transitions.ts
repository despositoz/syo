import { prefersReducedMotion } from './reducedMotion';

/**
 * Temporary page transitions (spec §11).
 *
 * The Film Page leaves with a 6–10 px shift to the right and a fade.
 * Scale is always 1, the screen underneath is never zoomed, blur never changes,
 * no poster is cloned and no gesture is involved.
 *
 * This is NOT an Apple TV-like transition, and must not be described as one.
 */

export const PAGE_ENTER_MS = 220;
export const PAGE_EXIT_MS = 190;
/** Within the 6–10 px window the spec allows. */
export const PAGE_EXIT_SHIFT_PX = 8;

export interface TransitionOptions {
  reducedMotion?: boolean;
  /**
   * How much of the designed duration to run, 0–1 (Master §48). The in-app
   * 'calm' choice shortens the transition; it never removes it.
   */
  scale?: number;
}

export const pageEnterKeyframes = (): Keyframe[] => [
  { opacity: 0, transform: `translate3d(${PAGE_EXIT_SHIFT_PX}px, 0, 0)` },
  { opacity: 1, transform: 'translate3d(0, 0, 0)' },
];

export const pageExitKeyframes = (): Keyframe[] => [
  { opacity: 1, transform: 'translate3d(0, 0, 0)' },
  { opacity: 0, transform: `translate3d(${PAGE_EXIT_SHIFT_PX}px, 0, 0)` },
];

export const pageTimings = (
  direction: 'enter' | 'exit',
  options: TransitionOptions = {},
): KeyframeAnimationOptions => {
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  if (reduced) {
    // Reduce Motion: a very short fade, no movement.
    return { duration: 90, easing: 'linear', fill: 'both' };
  }
  const scale = options.scale ?? 1;
  return {
    duration: (direction === 'enter' ? PAGE_ENTER_MS : PAGE_EXIT_MS) * scale,
    easing:
      direction === 'enter' ? 'cubic-bezier(0.32, 0.72, 0, 1)' : 'cubic-bezier(0.4, 0, 0.6, 1)',
    fill: 'both',
  };
};

/**
 * Runs a page transition with the Web Animations API and resolves when it ends.
 * Falls back to an immediate resolve where WAAPI is unavailable.
 */
export const runPageTransition = (
  element: HTMLElement | null,
  direction: 'enter' | 'exit',
  options: TransitionOptions = {},
): Promise<void> => {
  if (!element || typeof element.animate !== 'function') return Promise.resolve();

  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const keyframes = reduced
    ? direction === 'enter'
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 1 }, { opacity: 0 }]
    : direction === 'enter'
      ? pageEnterKeyframes()
      : pageExitKeyframes();

  const animation = element.animate(
    keyframes,
    pageTimings(direction, { reducedMotion: reduced, scale: options.scale }),
  );
  return animation.finished.catch(() => undefined).then(() => undefined);
};
