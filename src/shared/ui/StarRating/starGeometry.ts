import type { RatingValue } from '@domain/rating/rating.types';

/**
 * Pointer → value mapping (spec §12).
 *
 * Dividing the track into five equal rectangles is wrong when gaps exist: the
 * pointer would light up a star while sitting visibly between two. We map to
 * the *actual* star centres instead, so the chosen star is always the one under
 * the finger.
 *
 * There is no zero here. The scale is 1-5, and a pointer left of the first star
 * simply means the first star.
 */

export interface StarGeometry {
  /** Centre x of each star, in the same coordinate space as the pointer. */
  centers: number[];
}

const clamp = (value: number): RatingValue =>
  Math.min(5, Math.max(1, Math.round(value))) as RatingValue;

/** Nearest-centre mapping. Every x resolves to a star: gaps are never dead. */
export const valueFromPosition = (x: number, geometry: StarGeometry): RatingValue => {
  const { centers } = geometry;
  if (!centers.length) return 1;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index];
    if (center === undefined) continue;
    const distance = Math.abs(x - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return clamp(bestIndex + 1);
};

/** Reads star centres from their rendered boxes, relative to the viewport. */
export const measureGeometry = (stars: readonly HTMLElement[]): StarGeometry => ({
  centers: stars.map((star) => {
    const rect = star.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }),
});

/**
 * Keyboard stepping. An unrated control steps to 1 on the way up and stays at 1
 * on the way down — there is no zero to fall into.
 */
export const stepValue = (current: RatingValue | null, delta: number): RatingValue =>
  current === null ? (delta > 0 ? 1 : 1) : clamp(current + delta);

/**
 * Axis lock (spec §12): a gesture is horizontal only once it has travelled far
 * enough *and* clearly more sideways than down. Until then the page may scroll.
 */
export const AXIS_LOCK_DISTANCE = 9;
export const AXIS_LOCK_RATIO = 1.2;

export const resolveAxis = (dx: number, dy: number): 'horizontal' | 'vertical' | 'undecided' => {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < AXIS_LOCK_DISTANCE && absY < AXIS_LOCK_DISTANCE) return 'undecided';
  if (absX > absY * AXIS_LOCK_RATIO) return 'horizontal';
  if (absY >= absX) return 'vertical';
  return 'undecided';
};
