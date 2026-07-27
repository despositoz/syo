import { describe, expect, it } from 'vitest';
import {
  calculateProvisional,
  calculateResult,
  completedAspectCount,
  formatScore,
  isComplete,
  quickResult,
  toDisplayScore,
} from './rating.calculation';
import { emptyAspects, type AspectScores, type RatingValue } from './rating.types';

const aspects = (
  story: RatingValue | null,
  performance: RatingValue | null,
  directionVisual: RatingValue | null,
  soundMusic: RatingValue | null,
  aftertaste: RatingValue | null,
): AspectScores => ({ story, performance, directionVisual, soundMusic, aftertaste });

describe('rating formula', () => {
  it('all zeros is a real result, not a missing one', () => {
    const result = calculateResult(aspects(0, 0, 0, 0, 0));
    expect(result.rawAverage).toBe(0);
    expect(result.displayScore).toBe(0);
    expect(result.formulaVersion).toBe(1);
  });

  it('all fives', () => {
    expect(calculateResult(aspects(5, 5, 5, 5, 5))).toMatchObject({
      rawAverage: 5,
      displayScore: 5,
    });
  });

  it('4,3,5,4,5 → raw 4.2, display 4.0', () => {
    expect(calculateResult(aspects(4, 3, 5, 4, 5))).toMatchObject({
      rawAverage: 4.2,
      displayScore: 4,
    });
  });

  it('5,4,5,4,5 → raw 4.6, display 4.5', () => {
    expect(calculateResult(aspects(5, 4, 5, 4, 5))).toMatchObject({
      rawAverage: 4.6,
      displayScore: 4.5,
    });
  });

  it('rounds to the nearest half star', () => {
    expect(toDisplayScore(4.2)).toBe(4);
    expect(toDisplayScore(4.25)).toBe(4.5);
    expect(toDisplayScore(4.6)).toBe(4.5);
    expect(toDisplayScore(4.75)).toBe(5);
    expect(toDisplayScore(2.5)).toBe(2.5);
  });

  it('refuses to produce a final result while an aspect is unrated', () => {
    expect(() => calculateResult(aspects(5, 5, 5, 5, null))).toThrow();
    expect(isComplete(aspects(5, 5, 5, 5, null))).toBe(false);
  });

  it('counts a zero as rated and a null as not', () => {
    expect(completedAspectCount(aspects(0, null, null, null, null))).toBe(1);
    expect(completedAspectCount(emptyAspects())).toBe(0);
    expect(isComplete(aspects(0, 0, 0, 0, 0))).toBe(true);
  });

  it('quick score is its own result', () => {
    expect(quickResult(4)).toMatchObject({ rawAverage: 4, displayScore: 4, formulaVersion: 1 });
    expect(quickResult(0)).toMatchObject({ rawAverage: 0, displayScore: 0 });
  });
});

describe('provisional overall', () => {
  it('averages only what is already rated', () => {
    const provisional = calculateProvisional(aspects(4, 5, null, null, null));
    expect(provisional.completed).toBe(2);
    expect(provisional.rawAverage).toBe(4.5);
    expect(provisional.displayScore).toBe(4.5);
  });

  it('includes a deliberate zero in the average', () => {
    // Two aspects rated 4 and 0 → 2.0, not 4.0 with the zero skipped.
    const provisional = calculateProvisional(aspects(4, 0, null, null, null));
    expect(provisional.completed).toBe(2);
    expect(provisional.rawAverage).toBe(2);
  });

  it('grows more confident with each aspect', () => {
    const confidences = [
      calculateProvisional(emptyAspects()).confidence,
      calculateProvisional(aspects(4, null, null, null, null)).confidence,
      calculateProvisional(aspects(4, 4, null, null, null)).confidence,
      calculateProvisional(aspects(4, 4, 4, null, null)).confidence,
      calculateProvisional(aspects(4, 4, 4, 4, null)).confidence,
      calculateProvisional(aspects(4, 4, 4, 4, 4)).confidence,
    ];
    expect(confidences).toEqual([0.3, 0.5, 0.6, 0.72, 0.84, 1]);
  });

  it('shows nothing before the first aspect', () => {
    const provisional = calculateProvisional(emptyAspects());
    expect(provisional.completed).toBe(0);
    expect(provisional.displayScore).toBe(0);
  });
});

describe('score formatting', () => {
  it('uses a decimal comma and drops a trailing zero', () => {
    expect(formatScore(4.2)).toBe('4,2');
    expect(formatScore(4)).toBe('4');
    expect(formatScore(4.5)).toBe('4,5');
    expect(formatScore(0)).toBe('0');
  });
});
