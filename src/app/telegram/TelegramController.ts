import {
  emptyInsets,
  initialTelegramState,
  type ChromeMode,
  type FullscreenState,
  type TelegramEventName,
  type TelegramInsets,
  type TelegramState,
  type TelegramTrailEntry,
  type TelegramWebApp,
} from './telegramTypes';

/* ------------------------------------------------------------------ *
 * Pure normalization helpers (unit-tested — see TelegramController.test.ts)
 * ------------------------------------------------------------------ */

const px = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

export const normalizeInsets = (raw: Partial<TelegramInsets> | undefined): TelegramInsets => ({
  top: px(raw?.top),
  right: px(raw?.right),
  bottom: px(raw?.bottom),
  left: px(raw?.left),
});

/**
 * Telegram reports `contentSafeAreaInset` *relative to* `safeAreaInset`.
 * The app consumes one absolute number per side, so the inset is never
 * counted twice by a component that already applied `--safe-*`.
 */
export const toAbsoluteContentInsets = (
  safeArea: TelegramInsets,
  contentRelative: TelegramInsets,
): TelegramInsets => ({
  top: safeArea.top + contentRelative.top,
  right: safeArea.right + contentRelative.right,
  bottom: safeArea.bottom + contentRelative.bottom,
  left: safeArea.left + contentRelative.left,
});

/** Width to keep free on the right so our controls never sit under Telegram's. */
export const resolveControlsKeepoutRight = (input: {
  inTelegram: boolean;
  isFullscreen: boolean;
  contentTopRelative: number;
}): number => {
  if (!input.inTelegram) return 0;
  // Telegram already reserved a vertical band for its floating controls:
  // our toolbar sits below them, so no horizontal keep-out is needed.
  if (input.contentTopRelative > 0) return 0;
  // Fullscreen with no reserved band: close + menu cluster overlays the top-right.
  if (input.isFullscreen) return 96;
  // Non-fullscreen: native header is outside the WebView on modern clients,
  // a small margin still protects older ones.
  return 12;
};

export const resolveChromeMode = (input: {
  inTelegram: boolean;
  isFullscreen: boolean;
}): ChromeMode => (input.inTelegram && !input.isFullscreen ? 'telegram' : 'custom');

export const resolveViewportHeight = (input: {
  inTelegram: boolean;
  viewportStableHeight: number;
  viewportHeight: number;
  windowInnerHeight: number;
}): number => {
  const candidates = input.inTelegram
    ? [input.viewportStableHeight, input.viewportHeight, input.windowInnerHeight]
    : [input.windowInnerHeight];
  const height = candidates.find((value) => Number.isFinite(value) && value > 1);
  return Math.round(height ?? 0);
};

/** Platform values a real Telegram client reports. */
const TELEGRAM_PLATFORMS = [
  'android',
  'android_x',
  'ios',
  'macos',
  'tdesktop',
  'weba',
  'webk',
  'unigram',
];

/**
 * telegram-web-app.js is loaded on every page, so `window.Telegram.WebApp`
 * exists in a plain browser too — with an *empty* initData and platform
 * "unknown". Treating that as Telegram hid our own back button and left the
 * browser with no way back at all.
 */
export const detectInTelegram = (app: TelegramWebApp | undefined): boolean => {
  if (!app) return false;
  if (typeof app.initData === 'string' && app.initData.length > 0) return true;
  return TELEGRAM_PLATFORMS.includes(String(app.platform ?? '').toLowerCase());
};

export const isVersionAtLeast = (current: string, target: string): boolean => {
  const parse = (value: string) => value.split('.').map((part) => Number(part) || 0);
  const [currentMajor = 0, currentMinor = 0] = parse(current);
  const [targetMajor = 0, targetMinor = 0] = parse(target);
  if (currentMajor !== targetMajor) return currentMajor > targetMajor;
  return currentMinor >= targetMinor;
};

/* ------------------------------------------------------------------ *
 * Controller
 * ------------------------------------------------------------------ */

export type TelegramStateListener = (state: TelegramState) => void;

export interface TelegramControllerOptions {
  webApp?: TelegramWebApp | undefined;
  root?: HTMLElement;
  /** Injected for tests. */
  window?: Window & typeof globalThis;
}

const SYSTEM_COLOR = '#000000';
const FULLSCREEN_MIN_VERSION = '8.0';

/**
 * The single owner of the Telegram WebApp API.
 *
 * Everything the UI needs is published as normalized state + CSS variables.
 * No component may import `window.Telegram`.
 */
export class TelegramController {
  private readonly webApp: TelegramWebApp | undefined;
  private readonly root: HTMLElement;
  private readonly win: Window & typeof globalThis;
  private readonly listeners = new Set<TelegramStateListener>();
  private readonly backHandlers = new Set<() => void>();
  private readonly boundEvents: Array<[TelegramEventName, () => void]> = [];

  private state: TelegramState = initialTelegramState();
  private started = false;
  private fullscreenRequested = false;
  private layoutHeight = 0;
  private readonly startedAt = Date.now();
  /** Newest first, bounded — a diagnostic trail, not a log sink. */
  private trail: TelegramTrailEntry[] = [];

  constructor(options: TelegramControllerOptions = {}) {
    this.win = options.window ?? (globalThis as unknown as Window & typeof globalThis);
    this.webApp = options.webApp ?? this.win.Telegram?.WebApp;
    this.root = options.root ?? this.win.document.documentElement;
  }

  getState(): TelegramState {
    return this.state;
  }

  subscribe(listener: TelegramStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Step 1-4 of the startup sequence: ready → expand → sync → render. */
  start(): void {
    if (this.started) return;
    this.started = true;

    const app = this.webApp;
    const inTelegram = detectInTelegram(app);

    this.layoutHeight = this.win.innerHeight;

    // The SDK stub exists in a plain browser too; only drive it for real.
    if (app && inTelegram) {
      safeCall(() => app.ready?.());
      safeCall(() => app.expand?.());
      safeCall(() => app.setHeaderColor?.(SYSTEM_COLOR));
      safeCall(() => app.setBackgroundColor?.(SYSTEM_COLOR));
      safeCall(() => app.setBottomBarColor?.(SYSTEM_COLOR));
      // Prevents Telegram from closing the app on a downward scroll gesture.
      safeCall(() => app.disableVerticalSwipes?.());
      this.mark(`ready+expand · ${app.platform ?? '?'} v${app.version ?? '?'}`);
    } else {
      this.mark('browser fallback (no Telegram initData)');
    }

    this.state = {
      ...this.state,
      inTelegram,
      version: inTelegram ? (app?.version ?? '0.0') : '0.0',
      platform: inTelegram ? (app?.platform ?? 'unknown') : 'browser',
      // Outside Telegram the stub's colorScheme means nothing; the OS decides.
      colorScheme: inTelegram ? (app?.colorScheme ?? 'dark') : this.systemColorScheme(),
      hapticsAvailable: Boolean(inTelegram && app?.HapticFeedback),
      fullscreen: this.initialFullscreenState(inTelegram),
    };

    const events: TelegramEventName[] = [
      'viewportChanged',
      'safeAreaChanged',
      'contentSafeAreaChanged',
      'activated',
    ];
    events.forEach((event) => this.bind(event, () => this.sync()));
    this.bind('fullscreenChanged', () => {
      this.fullscreenRequested = false;
      this.mark(`fullscreenChanged → ${this.webApp?.isFullscreen ? 'on' : 'off'}`);
      this.sync({ fullscreen: this.webApp?.isFullscreen ? 'fullscreen' : 'expanded' });
    });
    this.bind('fullscreenFailed', () => {
      this.fullscreenRequested = false;
      this.mark('fullscreenFailed');
      this.sync({ fullscreen: 'failed' });
    });
    this.bind('themeChanged', () => {
      this.sync();
      this.emitThemeChange();
    });

    this.win.addEventListener('resize', this.handleWindowChange);
    this.win.addEventListener('orientationchange', this.handleWindowChange);
    this.win.visualViewport?.addEventListener('resize', this.handleWindowChange);
    this.win.visualViewport?.addEventListener('scroll', this.handleWindowChange);
    this.win.document.addEventListener('focusin', this.handleWindowChange);
    this.win.document.addEventListener('focusout', this.handleWindowChange);

    this.webApp?.BackButton?.onClick(this.handleTelegramBack);

    this.sync();
  }

  destroy(): void {
    this.boundEvents.forEach(([event, handler]) => this.webApp?.offEvent?.(event, handler));
    this.boundEvents.length = 0;
    this.win.removeEventListener('resize', this.handleWindowChange);
    this.win.removeEventListener('orientationchange', this.handleWindowChange);
    this.win.visualViewport?.removeEventListener('resize', this.handleWindowChange);
    this.win.visualViewport?.removeEventListener('scroll', this.handleWindowChange);
    this.win.document.removeEventListener('focusin', this.handleWindowChange);
    this.win.document.removeEventListener('focusout', this.handleWindowChange);
    this.webApp?.BackButton?.offClick(this.handleTelegramBack);
    this.listeners.clear();
    this.backHandlers.clear();
    this.started = false;
  }

  /* --- fullscreen --------------------------------------------------- */

  get fullscreenSupported(): boolean {
    return Boolean(
      this.state.inTelegram &&
      this.webApp?.requestFullscreen &&
      isVersionAtLeast(this.state.version, FULLSCREEN_MIN_VERSION),
    );
  }

  /**
   * Requested exactly once, after the first deliberate user action.
   * Never called in a loop, never on startup — that is what caused the
   * layout jump in the previous prototype.
   */
  requestFullscreenOnce(): void {
    if (this.fullscreenRequested) return;
    if (this.state.fullscreen === 'fullscreen') return;
    if (!this.fullscreenSupported) {
      this.mark(
        this.state.inTelegram
          ? `fullscreen unsupported (v${this.state.version} < ${FULLSCREEN_MIN_VERSION})`
          : 'fullscreen unavailable (browser)',
      );
      this.sync({ fullscreen: this.state.inTelegram ? this.state.fullscreen : 'unavailable' });
      return;
    }
    this.fullscreenRequested = true;
    this.mark('requestFullscreen() called');
    this.sync({ fullscreen: 'requesting' });
    try {
      this.webApp?.requestFullscreen?.();
    } catch {
      this.fullscreenRequested = false;
      this.mark('requestFullscreen() threw');
      this.sync({ fullscreen: 'failed' });
    }
  }

  /* --- back button -------------------------------------------------- */

  /**
   * Chrome mode A shows our own button, mode B shows Telegram's.
   * Two back buttons can never be visible at the same time.
   */
  setBackButtonVisible(visible: boolean): void {
    const shouldShowTelegramBack = visible && this.state.chromeMode === 'telegram';
    const button = this.webApp?.BackButton;
    if (button) {
      safeCall(() => (shouldShowTelegramBack ? button.show() : button.hide()));
    }
    if (this.state.backButtonVisible !== shouldShowTelegramBack) {
      this.publish({ ...this.state, backButtonVisible: shouldShowTelegramBack });
    }
  }

  onBackPressed(handler: () => void): () => void {
    this.backHandlers.add(handler);
    return () => {
      this.backHandlers.delete(handler);
    };
  }

  /* --- haptics ------------------------------------------------------ */

  impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): boolean {
    const feedback = this.webApp?.HapticFeedback;
    if (!feedback) return false;
    return safeCall(() => feedback.impactOccurred(style));
  }

  notification(type: 'error' | 'success' | 'warning'): boolean {
    const feedback = this.webApp?.HapticFeedback;
    if (!feedback) return false;
    return safeCall(() => feedback.notificationOccurred(type));
  }

  selection(): boolean {
    const feedback = this.webApp?.HapticFeedback;
    if (!feedback) return false;
    return safeCall(() => feedback.selectionChanged());
  }

  /* --- internals ---------------------------------------------------- */

  private bind(event: TelegramEventName, handler: () => void): void {
    if (!this.webApp?.onEvent) return;
    this.webApp.onEvent(event, handler);
    this.boundEvents.push([event, handler]);
  }

  private readonly handleTelegramBack = (): void => {
    this.backHandlers.forEach((handler) => handler());
  };

  private readonly handleWindowChange = (): void => {
    this.sync();
  };

  private initialFullscreenState(inTelegram: boolean): FullscreenState {
    if (!inTelegram) return 'unavailable';
    if (this.webApp?.isFullscreen) return 'fullscreen';
    return 'expanded';
  }

  private systemColorScheme(): 'light' | 'dark' {
    return this.win.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  private measureKeyboardHeight(viewportHeight: number): number {
    const active = this.win.document.activeElement;
    const editing =
      active instanceof this.win.HTMLInputElement ||
      active instanceof this.win.HTMLTextAreaElement ||
      (active instanceof this.win.HTMLElement && active.isContentEditable);
    if (!editing) {
      this.layoutHeight = Math.max(this.win.innerHeight, viewportHeight);
      return 0;
    }
    return Math.max(0, Math.round(this.layoutHeight - viewportHeight));
  }

  /** Records one diagnostic line. Cheap enough to keep on in production. */
  private mark(label: string): void {
    this.trail = [{ at: Date.now() - this.startedAt, label }, ...this.trail].slice(0, 8);
  }

  private sync(patch: Partial<TelegramState> = {}): void {
    const app = this.webApp;
    const inTelegram = this.state.inTelegram;

    const safeArea = inTelegram ? normalizeInsets(app?.safeAreaInset) : emptyInsets();
    const contentRelative = inTelegram ? normalizeInsets(app?.contentSafeAreaInset) : emptyInsets();
    const contentSafeArea = toAbsoluteContentInsets(safeArea, contentRelative);

    const isFullscreen = Boolean(inTelegram && app?.isFullscreen);
    const viewportHeight = resolveViewportHeight({
      inTelegram,
      viewportStableHeight: Number(app?.viewportStableHeight ?? 0),
      viewportHeight: Number(app?.viewportHeight ?? 0),
      windowInnerHeight: this.win.innerHeight,
    });
    const visualHeight = this.win.visualViewport?.height ?? this.win.innerHeight;

    const next: TelegramState = {
      ...this.state,
      ...patch,
      isFullscreen,
      chromeMode: resolveChromeMode({ inTelegram, isFullscreen }),
      colorScheme: inTelegram ? (app?.colorScheme ?? this.state.colorScheme) : this.state.colorScheme,
      isExpanded: Boolean(app?.isExpanded ?? !inTelegram),
      viewportHeight,
      viewportStableHeight: Math.round(Number(app?.viewportStableHeight ?? viewportHeight)),
      safeArea,
      contentSafeArea,
      keyboardHeight: this.measureKeyboardHeight(visualHeight),
      trail: this.trail,
    };

    if (patch.fullscreen === undefined) {
      next.fullscreen = isFullscreen
        ? 'fullscreen'
        : this.state.fullscreen === 'requesting'
          ? 'requesting'
          : inTelegram
            ? 'expanded'
            : 'unavailable';
    }

    this.writeCssVariables(next, contentRelative);
    this.publish(next);
  }

  private writeCssVariables(state: TelegramState, contentRelative: TelegramInsets): void {
    const style = this.root.style;
    const set = (name: string, value: string) => style.setProperty(name, value);

    // Outside Telegram the browser's own env() insets are authoritative.
    const inset = (side: 'top' | 'right' | 'bottom' | 'left', value: number) =>
      state.inTelegram ? `${value}px` : `env(safe-area-inset-${side}, 0px)`;

    if (state.viewportHeight > 1) {
      set('--tg-viewport-height', state.inTelegram ? `${state.viewportHeight}px` : '100dvh');
      set(
        '--tg-viewport-stable-height',
        state.inTelegram ? `${state.viewportStableHeight}px` : '100dvh',
      );
    }

    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
      set(`--safe-${side}`, inset(side, state.safeArea[side]));
      set(`--content-safe-${side}`, inset(side, state.contentSafeArea[side]));
    });

    set(
      '--tg-controls-keepout-right',
      `${resolveControlsKeepoutRight({
        inTelegram: state.inTelegram,
        isFullscreen: state.isFullscreen,
        contentTopRelative: contentRelative.top,
      })}px`,
    );
    set('--keyboard-height', `${state.keyboardHeight}px`);
  }

  private emitThemeChange(): void {
    this.win.dispatchEvent(new CustomEvent('syo:telegram-theme', { detail: this.state }));
  }

  /**
   * Publishes only when something actually changed.
   *
   * sync() runs on focusin/focusout among other things, and it builds a fresh
   * state object every time. Emitting that unconditionally re-rendered every
   * subscriber on each focus change — and a dialog that moves focus on mount
   * then turned into an endless render loop. Equal state is now a no-op.
   */
  private publish(next: TelegramState): void {
    if (sameTelegramState(this.state, next)) return;
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }
}

const sameInsets = (left: TelegramInsets, right: TelegramInsets): boolean =>
  left.top === right.top &&
  left.right === right.right &&
  left.bottom === right.bottom &&
  left.left === right.left;

const sameTelegramState = (left: TelegramState, right: TelegramState): boolean =>
  left.inTelegram === right.inTelegram &&
  left.version === right.version &&
  left.platform === right.platform &&
  left.fullscreen === right.fullscreen &&
  left.isFullscreen === right.isFullscreen &&
  left.chromeMode === right.chromeMode &&
  left.colorScheme === right.colorScheme &&
  left.viewportHeight === right.viewportHeight &&
  left.viewportStableHeight === right.viewportStableHeight &&
  left.isExpanded === right.isExpanded &&
  left.keyboardHeight === right.keyboardHeight &&
  left.hapticsAvailable === right.hapticsAvailable &&
  left.backButtonVisible === right.backButtonVisible &&
  left.trail === right.trail &&
  sameInsets(left.safeArea, right.safeArea) &&
  sameInsets(left.contentSafeArea, right.contentSafeArea);

/** Old Telegram clients throw on unsupported methods; never break the app for it. */
const safeCall = (action: () => unknown): boolean => {
  try {
    action();
    return true;
  } catch {
    return false;
  }
};
