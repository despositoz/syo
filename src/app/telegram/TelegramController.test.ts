import { describe, expect, it, beforeEach } from 'vitest';
import { TelegramController } from './TelegramController';
import {
  detectInTelegram,
  isVersionAtLeast,
  normalizeInsets,
  resolveChromeMode,
  resolveControlsKeepoutRight,
  resolveViewportHeight,
  toAbsoluteContentInsets,
} from './TelegramController';
import type { TelegramWebApp } from './telegramTypes';

describe('inset normalization', () => {
  it('clamps garbage to zero', () => {
    expect(normalizeInsets({ top: -8, right: Number.NaN, bottom: 34.6, left: undefined })).toEqual({
      top: 0,
      right: 0,
      bottom: 35,
      left: 0,
    });
  });

  it('treats a missing payload as no inset', () => {
    expect(normalizeInsets(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('adds the Telegram content inset on top of the device safe area exactly once', () => {
    const safeArea = { top: 59, right: 0, bottom: 34, left: 0 };
    const contentRelative = { top: 46, right: 0, bottom: 0, left: 0 };

    expect(toAbsoluteContentInsets(safeArea, contentRelative)).toEqual({
      top: 105,
      right: 0,
      bottom: 34,
      left: 0,
    });
  });
});

describe('controls keep-out', () => {
  it('is zero outside Telegram', () => {
    expect(
      resolveControlsKeepoutRight({ inTelegram: false, isFullscreen: true, contentTopRelative: 0 }),
    ).toBe(0);
  });

  it('is zero when Telegram already reserved a vertical band', () => {
    expect(
      resolveControlsKeepoutRight({ inTelegram: true, isFullscreen: true, contentTopRelative: 46 }),
    ).toBe(0);
  });

  it('reserves horizontal room for the floating close/menu cluster', () => {
    expect(
      resolveControlsKeepoutRight({ inTelegram: true, isFullscreen: true, contentTopRelative: 0 }),
    ).toBeGreaterThanOrEqual(88);
  });
});

describe('chrome mode', () => {
  it('uses Telegram chrome only inside Telegram and outside fullscreen', () => {
    expect(resolveChromeMode({ inTelegram: true, isFullscreen: false })).toBe('telegram');
    expect(resolveChromeMode({ inTelegram: true, isFullscreen: true })).toBe('custom');
    expect(resolveChromeMode({ inTelegram: false, isFullscreen: false })).toBe('custom');
  });
});

describe('viewport height', () => {
  it('prefers the stable height inside Telegram', () => {
    expect(
      resolveViewportHeight({
        inTelegram: true,
        viewportStableHeight: 812,
        viewportHeight: 750,
        windowInnerHeight: 900,
      }),
    ).toBe(812);
  });

  it('falls back through viewportHeight to the window', () => {
    expect(
      resolveViewportHeight({
        inTelegram: true,
        viewportStableHeight: 0,
        viewportHeight: 700,
        windowInnerHeight: 900,
      }),
    ).toBe(700);
    expect(
      resolveViewportHeight({
        inTelegram: false,
        viewportStableHeight: 812,
        viewportHeight: 812,
        windowInnerHeight: 640,
      }),
    ).toBe(640);
  });
});

describe('Telegram detection', () => {
  it('is false without a WebApp object', () => {
    expect(detectInTelegram(undefined)).toBe(false);
  });

  it('is false for the SDK stub loaded in a plain browser', () => {
    // telegram-web-app.js always defines WebApp: empty initData, platform "unknown".
    expect(detectInTelegram({ initData: '', platform: 'unknown', version: '6.0' })).toBe(false);
  });

  it('is true with real initData', () => {
    expect(detectInTelegram({ initData: 'user=1&hash=x', platform: 'unknown' })).toBe(true);
  });

  it('is true for a known Telegram platform even without initData', () => {
    expect(detectInTelegram({ initData: '', platform: 'tdesktop' })).toBe(true);
    expect(detectInTelegram({ initData: '', platform: 'ios' })).toBe(true);
  });
});

describe('version comparison', () => {
  it('compares major and minor parts', () => {
    expect(isVersionAtLeast('8.0', '8.0')).toBe(true);
    expect(isVersionAtLeast('8.1', '8.0')).toBe(true);
    expect(isVersionAtLeast('7.10', '8.0')).toBe(false);
    expect(isVersionAtLeast('6.9', '8.0')).toBe(false);
  });
});

/* --- controller behaviour --------------------------------------------- */

const createWebApp = (
  overrides: Partial<TelegramWebApp> = {},
): TelegramWebApp & {
  calls: string[];
  handlers: Map<string, () => void>;
} => {
  const calls: string[] = [];
  const handlers = new Map<string, () => void>();
  return {
    calls,
    handlers,
    initData: 'user=1',
    version: '8.0',
    platform: 'ios',
    colorScheme: 'dark',
    isExpanded: true,
    isFullscreen: false,
    viewportHeight: 800,
    viewportStableHeight: 812,
    safeAreaInset: { top: 59, bottom: 34, left: 0, right: 0 },
    contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
    ready: () => calls.push('ready'),
    expand: () => calls.push('expand'),
    requestFullscreen: () => calls.push('requestFullscreen'),
    isVersionAtLeast: () => true,
    disableVerticalSwipes: () => calls.push('disableVerticalSwipes'),
    onEvent: (event, handler) => handlers.set(event, handler),
    offEvent: (event) => handlers.delete(event),
    BackButton: {
      isVisible: false,
      show: () => calls.push('back.show'),
      hide: () => calls.push('back.hide'),
      onClick: () => calls.push('back.onClick'),
      offClick: () => {},
    },
    HapticFeedback: {
      impactOccurred: () => calls.push('haptic.impact'),
      notificationOccurred: () => calls.push('haptic.notification'),
      selectionChanged: () => calls.push('haptic.selection'),
    },
    ...overrides,
  };
};

describe('TelegramController', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('calls ready and expand exactly once at startup', () => {
    const webApp = createWebApp();
    const controller = new TelegramController({ webApp, root });
    controller.start();
    controller.start();

    expect(webApp.calls.filter((call) => call === 'ready')).toHaveLength(1);
    expect(webApp.calls.filter((call) => call === 'expand')).toHaveLength(1);
    controller.destroy();
  });

  it('publishes absolute content insets as CSS variables', () => {
    const controller = new TelegramController({ webApp: createWebApp(), root });
    controller.start();

    expect(root.style.getPropertyValue('--safe-top')).toBe('59px');
    expect(root.style.getPropertyValue('--content-safe-top')).toBe('105px');
    expect(root.style.getPropertyValue('--tg-viewport-height')).toBe('812px');
    controller.destroy();
  });

  it('uses env() insets outside Telegram instead of Telegram numbers', () => {
    const controller = new TelegramController({ webApp: undefined, root });
    controller.start();

    expect(root.style.getPropertyValue('--safe-top')).toBe('env(safe-area-inset-top, 0px)');
    expect(controller.getState().inTelegram).toBe(false);
    expect(controller.getState().fullscreen).toBe('unavailable');
    controller.destroy();
  });

  it('requests fullscreen only once, and only after being asked', () => {
    const webApp = createWebApp();
    const controller = new TelegramController({ webApp, root });
    controller.start();

    expect(webApp.calls).not.toContain('requestFullscreen');

    controller.requestFullscreenOnce();
    controller.requestFullscreenOnce();
    controller.requestFullscreenOnce();

    expect(webApp.calls.filter((call) => call === 'requestFullscreen')).toHaveLength(1);
    expect(controller.getState().fullscreen).toBe('requesting');
    controller.destroy();
  });

  it('marks fullscreen as failed when Telegram reports a failure', () => {
    const webApp = createWebApp();
    const controller = new TelegramController({ webApp, root });
    controller.start();
    controller.requestFullscreenOnce();

    webApp.handlers.get('fullscreenFailed')?.();

    expect(controller.getState().fullscreen).toBe('failed');
    controller.destroy();
  });

  it('never shows the Telegram back button in custom chrome mode', () => {
    const webApp = createWebApp({ isFullscreen: true });
    const controller = new TelegramController({ webApp, root });
    controller.start();

    controller.setBackButtonVisible(true);

    expect(controller.getState().chromeMode).toBe('custom');
    expect(controller.getState().backButtonVisible).toBe(false);
    expect(webApp.calls).toContain('back.hide');
    expect(webApp.calls).not.toContain('back.show');
    controller.destroy();
  });

  it('shows the Telegram back button in Telegram chrome mode', () => {
    const webApp = createWebApp({ isFullscreen: false });
    const controller = new TelegramController({ webApp, root });
    controller.start();

    controller.setBackButtonVisible(true);

    expect(controller.getState().chromeMode).toBe('telegram');
    expect(controller.getState().backButtonVisible).toBe(true);
    expect(webApp.calls).toContain('back.show');
    controller.destroy();
  });

  it('reports haptics as unavailable outside Telegram', () => {
    const controller = new TelegramController({ webApp: undefined, root });
    controller.start();

    expect(controller.getState().hapticsAvailable).toBe(false);
    expect(controller.selection()).toBe(false);
    controller.destroy();
  });
});
