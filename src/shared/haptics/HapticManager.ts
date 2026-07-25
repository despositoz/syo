/**
 * The only place allowed to produce haptic feedback.
 *
 * UI dispatches *semantic* events; the mapping to Telegram's API lives here.
 * Back transitions deliberately have no haptic (spec §21).
 */

export type HapticEvent =
  | 'tabSelection'
  | 'movieOpen'
  | 'bookmarkAdd'
  | 'bookmarkRemove'
  | 'pullThreshold'
  | 'refreshNewContent'
  | 'criticalError';

export interface HapticDriver {
  impact: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => boolean;
  notification: (type: 'error' | 'success' | 'warning') => boolean;
  selection: () => boolean;
  /** System-level availability (outside Telegram, or client without haptics). */
  isAvailable: () => boolean;
}

type Pattern =
  | { type: 'selection' }
  | { type: 'impact'; style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' }
  | { type: 'notification'; style: 'error' | 'success' | 'warning' };

const PATTERNS: Record<HapticEvent, Pattern> = {
  tabSelection: { type: 'selection' },
  movieOpen: { type: 'impact', style: 'light' },
  bookmarkAdd: { type: 'impact', style: 'soft' },
  bookmarkRemove: { type: 'selection' },
  pullThreshold: { type: 'impact', style: 'soft' },
  refreshNewContent: { type: 'notification', style: 'success' },
  criticalError: { type: 'notification', style: 'error' },
};

/** Per-event cooldown, ms. Anything faster reads as buzzing, not feedback. */
const EVENT_COOLDOWN_MS = 120;
/** Global floor between any two haptics. */
const GLOBAL_COOLDOWN_MS = 40;
/** Identical event + payload inside this window is a duplicate projection. */
const DEDUPE_WINDOW_MS = 350;

export class HapticManager {
  private enabled = true;
  private lastEventAt = new Map<HapticEvent, number>();
  private lastSignature: { key: string; at: number } | null = null;
  // -Infinity, not 0: performance.now() starts near zero, and a 0 baseline
  // would swallow the very first haptic of the session.
  private lastGlobalAt = -Infinity;

  constructor(
    private readonly driver: HapticDriver,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** User preference. System availability is asked from the driver. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled && this.driver.isAvailable();
  }

  /**
   * @param dedupeKey identifies the *logical* action, so two projections of the
   * same watchlist state (hero button + toolbar bookmark) cannot double-fire.
   */
  trigger(event: HapticEvent, dedupeKey?: string): boolean {
    if (!this.isEnabled()) return false;

    const now = this.now();
    const signature = `${event}:${dedupeKey ?? ''}`;

    if (this.lastSignature && this.lastSignature.key === signature) {
      if (now - this.lastSignature.at < DEDUPE_WINDOW_MS) return false;
    }
    if (now - (this.lastEventAt.get(event) ?? -Infinity) < EVENT_COOLDOWN_MS) return false;
    if (now - this.lastGlobalAt < GLOBAL_COOLDOWN_MS) return false;

    const pattern = PATTERNS[event];
    const fired =
      pattern.type === 'selection'
        ? this.driver.selection()
        : pattern.type === 'impact'
          ? this.driver.impact(pattern.style)
          : this.driver.notification(pattern.style);

    if (!fired) return false;

    this.lastEventAt.set(event, now);
    this.lastGlobalAt = now;
    this.lastSignature = { key: signature, at: now };
    return true;
  }
}

/** Driver used in a plain browser or in tests — silently does nothing. */
export const noopHapticDriver: HapticDriver = {
  impact: () => false,
  notification: () => false,
  selection: () => false,
  isAvailable: () => false,
};
