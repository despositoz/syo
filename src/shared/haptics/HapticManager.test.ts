import { describe, expect, it } from 'vitest';
import { HapticManager, noopHapticDriver, type HapticDriver } from './HapticManager';

const createDriver = () => {
  const calls: string[] = [];
  let available = true;
  const driver: HapticDriver = {
    impact: (style) => {
      calls.push(`impact:${style}`);
      return true;
    },
    notification: (type) => {
      calls.push(`notification:${type}`);
      return true;
    },
    selection: () => {
      calls.push('selection');
      return true;
    },
    isAvailable: () => available,
  };
  return {
    driver,
    calls,
    setAvailable: (value: boolean) => {
      available = value;
    },
  };
};

describe('HapticManager', () => {
  it('maps semantic events to patterns', () => {
    const { driver, calls } = createDriver();
    let now = 0;
    const haptics = new HapticManager(driver, () => now);

    haptics.trigger('tabSelection');
    now += 500;
    haptics.trigger('movieOpen');
    now += 500;
    haptics.trigger('criticalError');

    expect(calls).toEqual(['selection', 'impact:light', 'notification:error']);
  });

  it('deduplicates the same logical action fired by two projections', () => {
    const { driver, calls } = createDriver();
    let now = 0;
    const haptics = new HapticManager(driver, () => now);

    haptics.trigger('bookmarkAdd', 'watchlist:1');
    now += 50;
    haptics.trigger('bookmarkAdd', 'watchlist:1');

    expect(calls).toHaveLength(1);
  });

  it('enforces a per-event cooldown', () => {
    const { driver, calls } = createDriver();
    let now = 0;
    const haptics = new HapticManager(driver, () => now);

    haptics.trigger('tabSelection', 'feed');
    now += 30;
    haptics.trigger('tabSelection', 'diary');
    now += 500;
    haptics.trigger('tabSelection', 'profile');

    expect(calls).toHaveLength(2);
  });

  it('is silent when the system has no haptics', () => {
    const { driver, calls, setAvailable } = createDriver();
    const haptics = new HapticManager(driver, () => 0);
    setAvailable(false);

    expect(haptics.trigger('movieOpen')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('is silent when the user turned haptics off', () => {
    const { driver, calls } = createDriver();
    const haptics = new HapticManager(driver, () => 0);
    haptics.setEnabled(false);

    expect(haptics.trigger('movieOpen')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports nothing fired with the no-op driver', () => {
    const haptics = new HapticManager(noopHapticDriver, () => 0);
    expect(haptics.trigger('movieOpen')).toBe(false);
  });
});
