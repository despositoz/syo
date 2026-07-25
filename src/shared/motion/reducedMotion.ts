/**
 * Reduce Motion has two sources: the OS media query and the app's own
 * performance tier. Both collapse to a single boolean the UI can read.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
};

export const subscribeReducedMotion = (listener: (reduced: boolean) => void): (() => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
};
