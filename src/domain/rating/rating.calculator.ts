import { ASPECT_IDS, DEEP_STEP_COUNT } from './rating.constants';
import type { AspectScores, RatingValue } from './rating.types';

/**
 * The rating maths (spec §24). Pure — nothing recomputes this inline.
 *
 *   preciseRating = mean of the rated aspects
 *   overallRating = preciseRating rounded to the nearest whole star, 1-5
 *
 * There are no half stars anywhere. The fraction lives only in
 * `preciseRating`, which the UI shows as a secondary number.
 */

export interface RatingResult {
  /** Mean of the aspects, two decimals. */
  preciseRating: number;
  /** Whole stars, 1-5. In deep mode the user can never edit this by hand. */
  overallRating: RatingValue;
  /** How many of the five aspects are in. */
  completed: number;
  /** True once all five are rated — only then may it be saved as final. */
  complete: boolean;
}

const filled = (aspects: AspectScores): RatingValue[] =>
  ASPECT_IDS.map((id) => aspects[id]).filter((value): value is RatingValue => value !== null);

export const completedAspectCount = (aspects: AspectScores): number => filled(aspects).length;

export const isComplete = (aspects: AspectScores): boolean =>
  completedAspectCount(aspects) === DEEP_STEP_COUNT;

const roundPrecise = (value: number): number => Math.round(value * 100) / 100;

/** Rounds to a whole star and clamps into the 1-5 scale. */
export const toOverall = (precise: number): RatingValue =>
  Math.min(5, Math.max(1, Math.round(precise))) as RatingValue;

/**
 * The result over whatever is rated so far. With nothing rated there is no
 * result at all, so the caller must not present a number.
 */
export const calculateDeepResult = (aspects: AspectScores): RatingResult | null => {
  const values = filled(aspects);
  if (!values.length) return null;

  const precise = roundPrecise(
    values.reduce<number>((sum, value) => sum + value, 0) / values.length,
  );
  return {
    preciseRating: precise,
    overallRating: toOverall(precise),
    completed: values.length,
    complete: values.length === DEEP_STEP_COUNT,
  };
};

/** A quick rating is its own result: the chosen star, nothing averaged. */
export const calculateQuickResult = (value: RatingValue): RatingResult => ({
  preciseRating: value,
  overallRating: value,
  completed: DEEP_STEP_COUNT,
  complete: true,
});

/** "4,2" — Russian decimal comma. A whole number keeps no trailing ",0". */
export const formatPrecise = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
};
