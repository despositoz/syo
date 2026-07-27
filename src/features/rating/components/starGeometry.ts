import type { RatingValue } from '@domain/rating/rating.types';

/**
 * Pointer → value mapping (spec §9.9).
 *
 * Dividing the track into five equal rectangles is wrong when gaps exist: the
 * pointer would light up a star while sitting visibly between two. We map to
 * the *actual* star centres instead, so the chosen star is always the one under
 * the finger, and the space before the first centre is the zero lead-in.
 */

export interface StarGeometry {
  /** Centre x of each star, in the same coordinate space as the pointer. */
  centers: number[];
}

const clampValue = (value: number): RatingValue =>
  Math.min(5, Math.max(0, Math.round(value))) as RatingValue;

/**
 * Half the distance between neighbouring centres — the magnet radius, and the
 * width of the zero lead-in before the first star.
 */
const halfStep = (centers: number[]): number => {
  const first = centers[0];
  const last = centers[centers.length - 1];
  if (first === undefined || last === undefined || centers.length < 2) return 16;
  return (last - first) / (centers.length - 1) / 2;
};

/**
 * Nearest-centre mapping with an explicit zero zone. Every x resolves to a
 * value: gaps never produce a dead spot.
 */
export const valueFromPosition = (x: number, geometry: StarGeometry): RatingValue => {
  const { centers } = geometry;
  const first = centers[0];
  if (first === undefined) return 0;

  // Lead-in before the first star means a deliberate zero.
  if (x < first - halfStep(centers)) return 0;

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
  return clampValue(bestIndex + 1);
};

/**
 * Continuous position of the pointer along the track, in stars. Drives the
 * visual follow only — the committed value is always an integer.
 */
export const fractionFromPosition = (x: number, geometry: StarGeometry): number => {
  const { centers } = geometry;
  const first = centers[0];
  const last = centers[centers.length - 1];
  if (first === undefined || last === undefined || last === first) return 0;
  const step = (last - first) / (centers.length - 1);
  return Math.min(5, Math.max(0, (x - first) / step + 1));
};

/** Reads star centres from their rendered boxes, relative to the viewport. */
export const measureGeometry = (stars: readonly HTMLElement[]): StarGeometry => ({
  centers: stars.map((star) => {
    const rect = star.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }),
});

/** Keyboard steps, keeping the result inside 0-5. */
export const stepValue = (current: RatingValue | null, delta: number): RatingValue =>
  clampValue((current ?? 0) + delta);
