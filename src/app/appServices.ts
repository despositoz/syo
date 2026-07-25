import { createContext, useContext } from 'react';
import type { NavigationController } from './navigation/NavigationController';
import type { TelegramController } from './telegram/TelegramController';
import type { HapticManager } from '@shared/haptics/HapticManager';

/**
 * The controllers a screen is allowed to reach. UI never touches the Telegram
 * API, storage or haptics directly — it goes through these (spec §5).
 */
export interface AppServices {
  telegram: TelegramController;
  navigation: NavigationController;
  haptics: HapticManager;
}

export const AppServicesContext = createContext<AppServices | null>(null);

export const useServices = (): AppServices => {
  const services = useContext(AppServicesContext);
  if (!services) throw new Error('AppServices are not mounted');
  return services;
};

/**
 * For shared/ui components that must also render outside the app frame
 * (component tests, error boundaries mounted above the providers).
 */
export const useOptionalServices = (): AppServices | null => useContext(AppServicesContext);

/** Convenience hook so pages express intent, not plumbing. */
export const useNavigationController = (): NavigationController => useServices().navigation;
