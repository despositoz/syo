import { describe, expect, it } from 'vitest';
import { fractionFromPosition, stepValue, valueFromPosition } from './starGeometry';

/**
 * The real layout: a 44px zero anchor on the left, then five stars.
 * Centres at 80, 140, 200, 260, 320 — so the magnet radius is 30 and the zero
 * lead-in covers everything left of x = 50, which is the anchor itself.
 */
const geometry = { centers: [80, 140, 200, 260, 320] };

describe('pointer → value mapping', () => {
  it('maps each star centre to its own value', () => {
    expect(valueFromPosition(80, geometry)).toBe(1);
    expect(valueFromPosition(140, geometry)).toBe(2);
    expect(valueFromPosition(200, geometry)).toBe(3);
    expect(valueFromPosition(260, geometry)).toBe(4);
    expect(valueFromPosition(320, geometry)).toBe(5);
  });

  it('resolves the gap between two stars to the nearer one', () => {
    // 110 sits exactly between centres 80 and 140 — no dead zone either way.
    expect(valueFromPosition(109, geometry)).toBe(1);
    expect(valueFromPosition(111, geometry)).toBe(2);
  });

  it('treats the lead-in before the first star as a deliberate zero', () => {
    expect(valueFromPosition(0, geometry)).toBe(0);
    expect(valueFromPosition(49, geometry)).toBe(0);
    // …but the first star's own left half is still a 1.
    expect(valueFromPosition(60, geometry)).toBe(1);
  });

  it('clamps beyond the ends', () => {
    expect(valueFromPosition(9999, geometry)).toBe(5);
    expect(valueFromPosition(-9999, geometry)).toBe(0);
  });

  it('survives a control that has not been measured yet', () => {
    expect(valueFromPosition(100, { centers: [] })).toBe(0);
  });
});

describe('continuous follow position', () => {
  it('tracks the pointer between stars', () => {
    expect(fractionFromPosition(80, geometry)).toBeCloseTo(1);
    expect(fractionFromPosition(110, geometry)).toBeCloseTo(1.5);
    expect(fractionFromPosition(320, geometry)).toBeCloseTo(5);
  });

  it('stays inside 0-5', () => {
    expect(fractionFromPosition(-500, geometry)).toBe(0);
    expect(fractionFromPosition(500, geometry)).toBe(5);
  });
});

describe('keyboard stepping', () => {
  it('steps within bounds', () => {
    expect(stepValue(3, 1)).toBe(4);
    expect(stepValue(5, 1)).toBe(5);
    expect(stepValue(0, -1)).toBe(0);
  });

  it('treats an unrated control as zero-based, so +1 lands on the first star', () => {
    expect(stepValue(null, 1)).toBe(1);
    expect(stepValue(null, -1)).toBe(0);
  });
});
