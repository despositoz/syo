import { create } from 'zustand';
import { pathToStack } from '../routes';
import {
  isRootRoute,
  type NavigationState,
  type Route,
  type RootTab,
  type TransitionPhase,
} from './navigationTypes';

interface NavigationActions {
  push: (route: Route) => void;
  pop: () => void;
  /** Swaps the top route without growing the stack (steps inside a flow). */
  replaceTop: (route: Route) => void;
  current: () => Route;
  selectTab: (tab: RootTab) => void;
  /** Applied by NavigationController when the browser history moves. */
  replaceStack: (stack: Route[]) => void;
  setPhase: (phase: TransitionPhase) => void;
  finishLeaving: () => void;
}

const initialStack = (): Route[] =>
  typeof window === 'undefined' ? [{ kind: 'root', tab: 'feed' }] : pathToStack(location.pathname);

const rootTabOf = (stack: Route[]): RootTab => {
  const root = stack[0];
  return root && isRootRoute(root) ? root.tab : 'feed';
};

export const useNavigationStore = create<NavigationState & NavigationActions>((set, get) => ({
  stack: initialStack(),
  activeTab: rootTabOf(initialStack()),
  phase: 'idle',
  leaving: null,

  push: (route) => {
    const { stack } = get();
    const top = stack[stack.length - 1];
    // Guard against a double tap pushing the same page twice.
    if (top && top.kind === route.kind && JSON.stringify(top) === JSON.stringify(route)) return;
    set({ stack: [...stack, route], phase: 'entering', leaving: null });
  },

  pop: () => {
    const { stack } = get();
    if (stack.length <= 1) return;
    const leaving = stack[stack.length - 1] ?? null;
    set({ stack: stack.slice(0, -1), phase: 'leaving', leaving });
  },

  replaceTop: (route) => {
    const { stack } = get();
    if (!stack.length) return;
    // No enter/leave phase: stepping between aspects is not a page change.
    set({ stack: [...stack.slice(0, -1), route] });
  },

  current: () => get().stack[get().stack.length - 1] ?? { kind: 'root', tab: 'feed' },

  selectTab: (tab) =>
    set({ stack: [{ kind: 'root', tab }], activeTab: tab, phase: 'idle', leaving: null }),

  replaceStack: (stack) => {
    const safeStack: Route[] = stack.length ? stack : [{ kind: 'root', tab: 'feed' }];
    const current = get().stack;
    const shrinking = safeStack.length < current.length;
    set({
      stack: safeStack,
      activeTab: rootTabOf(safeStack),
      phase: shrinking ? 'leaving' : 'idle',
      leaving: shrinking ? (current[current.length - 1] ?? null) : null,
    });
  },

  setPhase: (phase) => set({ phase }),
  finishLeaving: () => set({ phase: 'idle', leaving: null }),
}));

export const useActiveRoute = (): Route =>
  useNavigationStore(
    (state) => state.stack[state.stack.length - 1] ?? { kind: 'root', tab: 'feed' },
  );

export const useCanGoBack = (): boolean => useNavigationStore((state) => state.stack.length > 1);

export const useIsRootScreen = (): boolean =>
  useNavigationStore((state) => state.stack.length === 1);
