import { ASPECT_COUNT, ASPECT_IDS } from './rating.constants';
import type { AspectScores, RatingResult, RatingValue } from './rating.types';

/**
 * The formula (spec §3.6). Pure — the UI never recomputes this inline.
 *
 *   rawAverage   = sum(aspects) / 5
 *   displayScore = round(rawAverage * 2) / 2
 *
 * `0` is a real score and always counts. `null` means "not rated" and is
 * excluded — never treat either with a falsy check.
 */

export const FORMULA_VERSION = 1 as const;

/** Values that were actually given, ignoring the untouched ones. */
const filledValues = (aspects: AspectScores): RatingValue[] =>
  ASPECT_IDS.map((id) => aspects[id]).filter((value): value is RatingValue => value !== null);

export const completedAspectCount = (aspects: AspectScores): number => filledValues(aspects).length;

export const isComplete = (aspects: AspectScores): boolean =>
  completedAspectCount(aspects) === ASPECT_COUNT;

/** Rounds to the nearest half star. */
export const toDisplayScore = (rawAverage: number): number => Math.round(rawAverage * 2) / 2;

/** Two decimals, so the stored raw value survives a round-trip. */
const roundRaw = (value: number): number => Math.round(value * 100) / 100;

/**
 * The final result. Requires all five aspects: an incomplete set has no result,
 * only a provisional one.
 */
export const calculateResult = (aspects: AspectScores): RatingResult => {
  if (!isComplete(aspects)) {
    throw new Error('calculateResult requires all five aspects');
  }
  const total = filledValues(aspects).reduce<number>((sum, value) => sum + value, 0);
  const rawAverage = roundRaw(total / ASPECT_COUNT);
  return { rawAverage, displayScore: toDisplayScore(rawAverage), formulaVersion: FORMULA_VERSION };
};

export interface ProvisionalResult extends RatingResult {
  completed: number;
  /** How sure the running total is — drives opacity, never the only signal. */
  confidence: number;
}

/** Opacity per completed count (spec §8.4). Index = number of aspects done. */
const CONFIDENCE_BY_COMPLETED = [0.3, 0.5, 0.6, 0.72, 0.84, 1] as const;

/**
 * The running overall shown during the detailed flow: average of what is
 * already rated. Zero counts, null does not.
 */
export const calculateProvisional = (aspects: AspectScores): ProvisionalResult => {
  const values = filledValues(aspects);
  const completed = values.length;
  const confidence = CONFIDENCE_BY_COMPLETED[completed] ?? 1;

  if (completed === 0) {
    return {
      rawAverage: 0,
      displayScore: 0,
      formulaVersion: FORMULA_VERSION,
      completed,
      confidence,
    };
  }

  const rawAverage = roundRaw(values.reduce<number>((sum, value) => sum + value, 0) / completed);
  return {
    rawAverage,
    displayScore: toDisplayScore(rawAverage),
    formulaVersion: FORMULA_VERSION,
    completed,
    confidence,
  };
};

/** A quick score is its own result: whole stars, no averaging. */
export const quickResult = (score: RatingValue): RatingResult => ({
  rawAverage: score,
  displayScore: score,
  formulaVersion: FORMULA_VERSION,
});

/** "4,2" — Russian decimal comma, one digit. Trailing ",0" is kept off. */
export const formatScore = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
};
