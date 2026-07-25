import { routeToPath, pathToStack } from '../routes';
import type { TelegramController } from '../telegram/TelegramController';
import { useNavigationStore } from './navigationStore';
import type { FilmRouteParams, Route, RootTab } from './navigationTypes';
import type { HapticManager } from '@shared/haptics/HapticManager';

/**
 * Owns every navigation side effect:
 *  — browser history (so the browser fallback has real back);
 *  — Telegram BackButton visibility and its press handler;
 *  — the one-shot fullscreen request after the first deliberate action;
 *  — semantic haptics.
 *
 * Pages only call these methods. They never touch history or Telegram.
 */
export class NavigationController {
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeBack: (() => void) | null = null;
  private unsubscribeTelegram: (() => void) | null = null;
  private historyDepth = 0;
  private applyingHistory = false;

  constructor(
    private readonly telegram: TelegramController,
    private readonly haptics: HapticManager,
    private readonly win: Window = window,
  ) {}

  start(): void {
    const store = useNavigationStore;
    this.historyDepth = store.getState().stack.length - 1;

    this.win.addEventListener('popstate', this.handlePopState);
    this.unsubscribeBack = this.telegram.onBackPressed(() => this.goBack());

    // BackButton visibility must follow both the stack and the chrome mode.
    this.unsubscribeStore = store.subscribe(() => this.syncBackButton());
    this.unsubscribeTelegram = this.telegram.subscribe(() => this.syncBackButton());
    this.syncBackButton();
  }

  destroy(): void {
    this.win.removeEventListener('popstate', this.handlePopState);
    this.unsubscribeBack?.();
    this.unsubscribeStore?.();
    this.unsubscribeTelegram?.();
    this.unsubscribeBack = null;
    this.unsubscribeStore = null;
    this.unsubscribeTelegram = null;
  }

  /* --- semantic actions --------------------------------------------- */

  selectTab(tab: RootTab): void {
    const state = useNavigationStore.getState();
    if (state.stack.length === 1 && state.activeTab === tab) return;
    this.haptics.trigger('tabSelection', tab);
    // Collapsing the stack must also unwind the history entries we pushed.
    const toDrop = state.stack.length - 1;
    state.selectTab(tab);
    this.replaceHistory(routeToPath({ kind: 'root', tab }), toDrop);
  }

  openPicker(): void {
    this.telegram.requestFullscreenOnce();
    this.pushRoute({ kind: 'picker' });
  }

  openFilm(params: FilmRouteParams): void {
    this.telegram.requestFullscreenOnce();
    this.haptics.trigger('movieOpen', String(params.filmId));
    this.pushRoute({ kind: 'film', ...params });
  }

  /** Deliberate first action that is not a navigation (search field, CTA). */
  registerDeliberateAction(): void {
    this.telegram.requestFullscreenOnce();
  }

  goBack(): void {
    const state = useNavigationStore.getState();
    if (state.stack.length <= 1) return;
    // No haptic on back — spec §11/§21.
    if (this.historyDepth > 0) {
      this.historyDepth -= 1;
      this.applyingHistory = true;
      this.win.history.back();
      // The popstate handler applies the store change.
      return;
    }
    state.pop();
  }

  /* --- internals ------------------------------------------------------ */

  private pushRoute(route: Route): void {
    const before = useNavigationStore.getState().stack.length;
    useNavigationStore.getState().push(route);
    const after = useNavigationStore.getState().stack.length;
    if (after === before) return; // duplicate push was rejected
    this.historyDepth += 1;
    this.win.history.pushState({ syo: this.historyDepth }, '', routeToPath(route));
  }

  private replaceHistory(path: string, dropEntries: number): void {
    if (dropEntries > 0) {
      this.historyDepth = Math.max(0, this.historyDepth - dropEntries);
      this.applyingHistory = true;
      this.win.history.go(-dropEntries);
      // Path is corrected by the popstate handler below.
      this.win.setTimeout(() => this.win.history.replaceState({ syo: 0 }, '', path), 0);
      return;
    }
    this.win.history.replaceState({ syo: this.historyDepth }, '', path);
  }

  private readonly handlePopState = (): void => {
    const stack = pathToStack(this.win.location.pathname);
    this.historyDepth = Math.max(0, stack.length - 1);
    this.applyingHistory = false;
    useNavigationStore.getState().replaceStack(stack);
  };

  private syncBackButton(): void {
    const canGoBack = useNavigationStore.getState().stack.length > 1;
    this.telegram.setBackButtonVisible(canGoBack);
  }

  /** Exposed for tests: true while a history-driven update is in flight. */
  get isApplyingHistory(): boolean {
    return this.applyingHistory;
  }
}
