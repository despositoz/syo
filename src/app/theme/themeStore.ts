import { create } from 'zustand';
import { readPreference, writePreference } from '@shared/storage/db';

export type ThemePreference = 'cinema' | 'graphite' | 'system';
export type ResolvedTheme = 'cinema' | 'graphite';

export const THEME_LABELS: Record<ThemePreference, string> = {
  cinema: 'Cinema',
  graphite: 'Graphite',
  system: 'Системная',
};

/**
 * System follows the Telegram / OS colour scheme while keeping our hierarchy:
 * a light system theme maps to Graphite (the lighter reading mode), never to a
 * washed-out light skin (spec §26).
 */
export const resolveTheme = (
  preference: ThemePreference,
  colorScheme: 'light' | 'dark',
): ResolvedTheme => {
  if (preference === 'cinema' || preference === 'graphite') return preference;
  return colorScheme === 'light' ? 'graphite' : 'cinema';
};

const PREFERENCE_KEY = 'theme.preference';

interface ThemeState {
  preference: ThemePreference;
  colorScheme: 'light' | 'dark';
  resolved: ResolvedTheme;
  hydrated: boolean;
  setPreference: (preference: ThemePreference) => void;
  setColorScheme: (colorScheme: 'light' | 'dark') => void;
  hydrate: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'cinema',
  colorScheme: 'dark',
  resolved: 'cinema',
  hydrated: false,

  setPreference: (preference) => {
    set({ preference, resolved: resolveTheme(preference, get().colorScheme) });
    void writePreference(PREFERENCE_KEY, preference);
  },

  setColorScheme: (colorScheme) =>
    set({ colorScheme, resolved: resolveTheme(get().preference, colorScheme) }),

  hydrate: async () => {
    const stored = await readPreference<ThemePreference>(PREFERENCE_KEY, 'cinema');
    const preference: ThemePreference =
      stored === 'cinema' || stored === 'graphite' || stored === 'system' ? stored : 'cinema';
    set({
      preference,
      resolved: resolveTheme(preference, get().colorScheme),
      hydrated: true,
    });
  },
}));

export const useResolvedTheme = (): ResolvedTheme => useThemeStore((state) => state.resolved);
