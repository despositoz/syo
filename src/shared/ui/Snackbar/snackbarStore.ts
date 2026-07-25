import { create } from 'zustand';

export interface SnackbarMessage {
  id: number;
  text: string;
  /** ms */
  duration: number;
}

interface SnackbarState {
  current: SnackbarMessage | null;
  show: (text: string, duration?: number) => void;
  dismiss: () => void;
}

let nextId = 1;

export const useSnackbarStore = create<SnackbarState>((set) => ({
  current: null,
  show: (text, duration = 2400) => set({ current: { id: nextId++, text, duration } }),
  dismiss: () => set({ current: null }),
}));
