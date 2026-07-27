import { describe, expect, it } from 'vitest';
import { pullGrowth } from './parallax';

/**
 * The pull curve is the whole point of the gesture: it must never present the
 * user with a wall, and it must get harder the further they go.
 */
describe('pull-to-stretch response', () => {
  it('starts at nothing', () => {
    expect(pullGrowth(0)).toBe(0);
  });

  it('keeps growing however far the page is pulled', () => {
    const distances = [50, 180, 400, 900, 2000, 5000, 20000];
    let previous = pullGrowth(0);
    for (const distance of distances) {
      const current = pullGrowth(distance);
      // Strictly increasing: there is no ceiling to bump into.
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('gets stiffer: equal extra pull buys less and less', () => {
    const first = pullGrowth(180) - pullGrowth(0);
    const second = pullGrowth(360) - pullGrowth(180);
    const third = pullGrowth(540) - pullGrowth(360);

    expect(second).toBeLessThan(first);
    expect(third).toBeLessThan(second);
    // …and noticeably so, not by a rounding error.
    expect(second).toBeLessThan(first * 0.7);
  });

  it('needs several times the pull to double the stretch', () => {
    const single = pullGrowth(180);
    // Doubling costs far more than twice the distance — that is the resistance.
    expect(pullGrowth(360)).toBeLessThan(single * 2);
    expect(pullGrowth(540)).toBeCloseTo(single * 2, 1);
  });

  it('leaves the familiar part of the gesture unchanged', () => {
    // Calibrated so the old full-pull distance still yields exactly one unit.
    expect(pullGrowth(180)).toBeCloseTo(1, 5);
    // Near the start it is still effectively linear, as a rubber band should be.
    expect(pullGrowth(18)).toBeCloseTo(0.137, 2);
  });
});
