import { useEffect, type ReactNode } from 'react';
import { useTelegramStore } from '../telegram/telegramStore';
import { useThemeStore } from './themeStore';

/**
 * Writes the resolved theme onto <html data-theme>. Components read tokens,
 * never a theme name.
 */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const resolved = useThemeStore((state) => state.resolved);
  const hydrate = useThemeStore((state) => state.hydrate);
  const setColorScheme = useThemeStore((state) => state.setColorScheme);
  const colorScheme = useTelegramStore((state) => state.telegram.colorScheme);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setColorScheme(colorScheme);
  }, [colorScheme, setColorScheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return <>{children}</>;
};
