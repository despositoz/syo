import { create } from 'zustand';

export interface SnackbarAction {
  label: string;
  onAction: () => void;
}

export interface SnackbarMessage {
  id: number;
  text: string;
  /** ms */
  duration: number;
  /** Optional single action, e.g. Undo after a delete. */
  action?: SnackbarAction;
}

interface SnackbarState {
  current: SnackbarMessage | null;
  show: (text: string, duration?: number, action?: SnackbarAction) => void;
  dismiss: () => void;
}

let nextId = 1;

export const useSnackbarStore = create<SnackbarState>((set) => ({
  current: null,
  show: (text, duration = 2400, action) =>
    set({ current: { id: nextId++, text, duration, ...(action ? { action } : {}) } }),
  dismiss: () => set({ current: null }),
}));
