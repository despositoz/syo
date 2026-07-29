import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/*
 * The default 1s is a race, not an assertion: with every suite running in
 * parallel a slow machine loses a render to the scheduler, and a passing test
 * fails for reasons that have nothing to do with the code.
 */
configure({ asyncUtilTimeout: 10_000 });

// jsdom has no matchMedia; motion + theme code depends on it.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!window.IntersectionObserver) {
  class TestIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver =
    TestIntersectionObserver as unknown as typeof window.IntersectionObserver;
}

// jsdom has no ResizeObserver; layout code that publishes its own size needs one.
if (!window.ResizeObserver) {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(
      () => callback(performance.now()),
      16,
    ) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as unknown as typeof window.cancelAnimationFrame;
}

// jsdom does not implement HTMLImageElement.decode().
if (!HTMLImageElement.prototype.decode) {
  HTMLImageElement.prototype.decode = () => Promise.resolve();
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
});
