import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PerformanceController, usePerformanceStore } from './PerformanceController';

/**
 * The motion choice only exists if it reaches CSS: every duration token is a
 * multiple of --motion-scale, which is selected by this one attribute (§48).
 */
describe('PerformanceController motion dataset', () => {
  beforeEach(() => {
    usePerformanceStore.getState().setReducedMotion(false);
    usePerformanceStore.getState().setMotionPreference('system');
  });

  // The store and the root element are global: leaving Reduce Motion on would
  // change what a later test sees.
  afterEach(() => {
    usePerformanceStore.getState().setReducedMotion(false);
    usePerformanceStore.getState().setMotionPreference('system');
    delete document.documentElement.dataset.motion;
    delete document.documentElement.dataset.performance;
  });

  it('publishes the in-app choice, and lets Reduce Motion override it', () => {
    const controller = new PerformanceController(window);
    controller.start();
    expect(document.documentElement.dataset.motion).toBe('full');

    usePerformanceStore.getState().setMotionPreference('calm');
    expect(document.documentElement.dataset.motion).toBe('calm');

    // The system switch wins over the in-app setting, never the other way.
    usePerformanceStore.getState().setReducedMotion(true);
    expect(document.documentElement.dataset.motion).toBe('reduced');

    controller.destroy();
  });
});
