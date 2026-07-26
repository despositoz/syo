/**
 * Minimal typing of the Telegram WebApp surface we actually use, plus the
 * normalized state the rest of the app consumes.
 *
 * Nothing outside src/app/telegram may import `TelegramWebApp`.
 */

export interface TelegramInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type FullscreenState = 'unavailable' | 'expanded' | 'requesting' | 'fullscreen' | 'failed';

/** A — custom chrome (our back button). B — Telegram chrome (Telegram BackButton). */
export type ChromeMode = 'custom' | 'telegram';

export interface TelegramState {
  /** Running inside a real Telegram WebView (initData present). */
  inTelegram: boolean;
  /** Bot API version reported by the client, e.g. "8.0". */
  version: string;
  platform: string;
  fullscreen: FullscreenState;
  isFullscreen: boolean;
  chromeMode: ChromeMode;
  /** Telegram colorScheme, or the browser's preference outside Telegram. */
  colorScheme: 'light' | 'dark';
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  safeArea: TelegramInsets;
  contentSafeArea: TelegramInsets;
  keyboardHeight: number;
  hapticsAvailable: boolean;
  /** Whether Telegram's own BackButton is currently shown. */
  backButtonVisible: boolean;
  /**
   * Last few Telegram lifecycle events, newest first. Exists so fullscreen can
   * be *proven* on a real device instead of inferred from the code: the Profile
   * screen renders this trail, and a screenshot of it inside Telegram shows
   * whether requestFullscreen() was called and whether fullscreenChanged came
   * back.
   */
  trail: readonly TelegramTrailEntry[];
}

export interface TelegramTrailEntry {
  /** ms since app start, rounded. */
  at: number;
  label: string;
}

export type TelegramEventName =
  | 'viewportChanged'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged'
  | 'fullscreenChanged'
  | 'fullscreenFailed'
  | 'themeChanged'
  | 'activated'
  | 'deactivated';

export interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

export interface TelegramWebApp {
  initData?: string;
  version?: string;
  platform?: string;
  colorScheme?: 'light' | 'dark';
  isExpanded?: boolean;
  isFullscreen?: boolean;
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: Partial<TelegramInsets>;
  contentSafeAreaInset?: Partial<TelegramInsets>;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  onEvent?: (event: TelegramEventName, handler: () => void) => void;
  offEvent?: (event: TelegramEventName, handler: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const emptyInsets = (): TelegramInsets => ({ top: 0, right: 0, bottom: 0, left: 0 });

export const initialTelegramState = (): TelegramState => ({
  inTelegram: false,
  version: '0.0',
  platform: 'unknown',
  fullscreen: 'unavailable',
  isFullscreen: false,
  chromeMode: 'custom',
  colorScheme: 'dark',
  viewportHeight: 0,
  viewportStableHeight: 0,
  isExpanded: false,
  safeArea: emptyInsets(),
  contentSafeArea: emptyInsets(),
  keyboardHeight: 0,
  hapticsAvailable: false,
  backButtonVisible: false,
  trail: [],
});
