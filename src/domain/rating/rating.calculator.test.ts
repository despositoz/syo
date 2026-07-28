import { describe, expect, it } from 'vitest';
import {
  calculateDeepResult,
  calculateQuickResult,
  completedAspectCount,
  formatPrecise,
  isComplete,
  toOverall,
} from './rating.calculator';
import { emptyAspects, type AspectScores, type RatingValue } from './rating.types';

const aspects = (
  story: RatingValue | null,
  characters: RatingValue | null,
  direction: RatingValue | null,
  sound: RatingValue | null,
  aftertaste: RatingValue | null,
): AspectScores => ({ story, characters, direction, sound, aftertaste });

describe('deep result', () => {
  it('averages the five aspects', () => {
    // 4+4+5+4+4 = 21 → 4.2
    expect(calculateDeepResult(aspects(4, 4, 5, 4, 4))).toMatchObject({
      preciseRating: 4.2,
      overallRating: 4,
      complete: true,
    });
  });

  it('rounds 4,2 down to 4 stars and 4,6 up to 5', () => {
    expect(calculateDeepResult(aspects(4, 4, 5, 4, 4))?.overallRating).toBe(4);
    // 5+4+5+4+5 = 23 → 4.6
    expect(calculateDeepResult(aspects(5, 4, 5, 4, 5))?.overallRating).toBe(5);
  });

  it('never leaves the 1-5 scale', () => {
    expect(calculateDeepResult(aspects(1, 1, 1, 1, 1))).toMatchObject({
      preciseRating: 1,
      overallRating: 1,
    });
    expect(calculateDeepResult(aspects(5, 5, 5, 5, 5))).toMatchObject({
      preciseRating: 5,
      overallRating: 5,
    });
    expect(toOverall(0.2)).toBe(1);
    expect(toOverall(9)).toBe(5);
  });

  it('averages only what is rated so far, and says it is not final', () => {
    const partial = calculateDeepResult(aspects(4, 5, null, null, null));
    expect(partial).toMatchObject({ preciseRating: 4.5, overallRating: 5, completed: 2 });
    expect(partial?.complete).toBe(false);
  });

  it('has no result at all before the first answer', () => {
    expect(calculateDeepResult(emptyAspects())).toBeNull();
    expect(completedAspectCount(emptyAspects())).toBe(0);
    expect(isComplete(emptyAspects())).toBe(false);
  });

  it('rounds a half upward, the way a person expects', () => {
    // 3+4+3+4+3 = 17 → 3.4 → 3
    expect(calculateDeepResult(aspects(3, 4, 3, 4, 3))?.overallRating).toBe(3);
    // 3+4+4+4+3 = 18 → 3.6 → 4
    expect(calculateDeepResult(aspects(3, 4, 4, 4, 3))?.overallRating).toBe(4);
    expect(toOverall(3.5)).toBe(4);
  });
});

describe('quick result', () => {
  it('is the chosen star itself, with nothing averaged', () => {
    expect(calculateQuickResult(4)).toMatchObject({
      preciseRating: 4,
      overallRating: 4,
      complete: true,
    });
    expect(calculateQuickResult(1).overallRating).toBe(1);
  });
});

describe('precise formatting', () => {
  it('uses a decimal comma and drops a trailing zero', () => {
    expect(formatPrecise(4.2)).toBe('4,2');
    expect(formatPrecise(4)).toBe('4');
    expect(formatPrecise(3.5)).toBe('3,5');
  });
});
