import { routeToPath, pathToStack } from '../routes';
import type { TelegramController } from '../telegram/TelegramController';
import { useNavigationStore } from './navigationStore';
import {
  isRatingRoute,
  type FilmRouteParams,
  type RatingRoute,
  type Route,
  type RootTab,
} from './navigationTypes';
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
  /** Stack to install once the pending history unwind reports back. */
  private pendingStack: Route[] | null = null;
  private backInterceptor: (() => boolean) | null = null;

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
    this.backInterceptor = null;
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

  /**
   * Moves inside the rating flow. `replace` swaps the top of the stack instead
   * of growing it, so stepping through five aspects leaves one history entry,
   * not five — back from the flow returns to the film, never step by step
   * through the aspects.
   */
  openRating(route: RatingRoute, replace = false): void {
    this.telegram.requestFullscreenOnce();
    if (replace && isRatingRoute(useNavigationStore.getState().current())) {
      this.replaceTop(route);
      return;
    }
    this.pushRoute(route);
  }

  openJournalEntry(entryId: string): void {
    this.pushRoute({ kind: 'journalEntry', entryId });
  }

  /** Leaves the flow entirely and lands on the Diary with the new entry. */
  showJournal(): void {
    const state = useNavigationStore.getState();
    const toDrop = state.stack.length - 1;
    state.selectTab('diary');
    this.replaceHistory(routeToPath({ kind: 'root', tab: 'diary' }), toDrop);
  }

  /** Deliberate first action that is not a navigation (search field, CTA). */
  registerDeliberateAction(): void {
    this.telegram.requestFullscreenOnce();
  }

  /**
   * Lets a nested flow claim the back action. The rating flow steps back
   * through its aspects instead of closing (spec §20.9); it returns false once
   * it is at its own first step, and back then leaves the flow as usual.
   *
   * Registered by the screen, so both our own button and the Telegram
   * BackButton go through exactly one implementation.
   */
  setBackInterceptor(interceptor: () => boolean): () => void {
    this.backInterceptor = interceptor;
    return () => {
      if (this.backInterceptor === interceptor) this.backInterceptor = null;
    };
  }

  goBack(): void {
    if (this.backInterceptor?.()) return;

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

  private replaceTop(route: Route): void {
    useNavigationStore.getState().replaceTop(route);
    // The history entry is replaced too, so back leaves the flow in one step.
    this.win.history.replaceState({ syo: this.historyDepth }, '', routeToPath(route));
  }

  private pushRoute(route: Route): void {
    const before = useNavigationStore.getState().stack.length;
    useNavigationStore.getState().push(route);
    const after = useNavigationStore.getState().stack.length;
    if (after === before) return; // duplicate push was rejected
    this.historyDepth += 1;
    this.win.history.pushState({ syo: this.historyDepth }, '', routeToPath(route));
  }

  /**
   * Collapses the stack to `path`, unwinding the history entries we pushed.
   *
   * `history.go()` fires a popstate *after* returning, and at that moment the
   * URL is still the old one — parsing it there would drop the user back onto
   * the page they just left (the feed, after saving a rating). So the intended
   * stack is handed to the popstate handler up front, and only entries we
   * actually pushed are unwound.
   */
  private replaceHistory(path: string, dropEntries: number): void {
    const unwind = Math.min(Math.max(0, dropEntries), this.historyDepth);
    if (unwind > 0) {
      this.historyDepth -= unwind;
      this.applyingHistory = true;
      this.pendingStack = pathToStack(path);
      this.win.history.go(-unwind);
      return;
    }
    this.historyDepth = 0;
    this.win.history.replaceState({ syo: 0 }, '', path);
  }

  private readonly handlePopState = (): void => {
    const pending = this.pendingStack;
    if (pending) {
      this.pendingStack = null;
      this.historyDepth = pending.length - 1;
      this.applyingHistory = false;
      useNavigationStore.getState().replaceStack(pending);
      const top = pending[pending.length - 1];
      if (top) this.win.history.replaceState({ syo: this.historyDepth }, '', routeToPath(top));
      return;
    }

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
