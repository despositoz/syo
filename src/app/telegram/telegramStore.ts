import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { TelegramController } from './TelegramController';
import { initialTelegramState, type TelegramState } from './telegramTypes';

interface TelegramStoreState {
  telegram: TelegramState;
  setTelegramState: (state: TelegramState) => void;
}

export const useTelegramStore = create<TelegramStoreState>((set) => ({
  telegram: initialTelegramState(),
  setTelegramState: (telegram) => set({ telegram }),
}));

/**
 * One controller instance per document. Created lazily so tests can build
 * their own with an injected fake WebApp.
 */
let controller: TelegramController | null = null;

export const getTelegramController = (): TelegramController => {
  if (!controller) {
    controller = new TelegramController();
    controller.subscribe((state) => useTelegramStore.getState().setTelegramState(state));
  }
  return controller;
};

/** Test seam. */
export const setTelegramController = (next: TelegramController | null): void => {
  controller = next;
  if (next) {
    next.subscribe((state) => useTelegramStore.getState().setTelegramState(state));
    useTelegramStore.getState().setTelegramState(next.getState());
  } else {
    useTelegramStore.getState().setTelegramState(initialTelegramState());
  }
};

export const useTelegram = (): TelegramState => useTelegramStore((state) => state.telegram);

export const useChromeMode = (): TelegramState['chromeMode'] =>
  useTelegramStore((state) => state.telegram.chromeMode);

export const useViewportMetrics = () =>
  useTelegramStore(
    useShallow((state) => ({
      keyboardHeight: state.telegram.keyboardHeight,
      viewportHeight: state.telegram.viewportHeight,
      isFullscreen: state.telegram.isFullscreen,
    })),
  );
