import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationController } from './navigation/NavigationController';
import { getTelegramController } from './telegram/telegramStore';
import { AppServicesContext, type AppServices } from './appServices';
import { ThemeProvider } from './theme/ThemeProvider';
import { PerformanceController } from './performance/PerformanceController';
import { ConnectivityController } from './connectivity/ConnectivityController';
import { HapticManager, type HapticDriver } from '@shared/haptics/HapticManager';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useWritingStore } from '@features/writing/model/writing.store';
import { useDiaryStore } from '@features/diary/model/diary.store';

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Cached data is shown immediately, refreshed quietly (spec §24).
        staleTime: 5 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        retry: (failureCount, error) => {
          const status = (error as { status?: number })?.status ?? 0;
          if (status === 401 || status === 404) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
        // Never wipe a screen while refetching.
        placeholderData: (previous: unknown) => previous,
      },
    },
  });

export const AppProviders = ({ children }: { children: ReactNode }) => {
  const queryClient = useRef<QueryClient>(null);
  queryClient.current ??= createQueryClient();

  const services = useMemo<AppServices>(() => {
    const telegram = getTelegramController();
    const driver: HapticDriver = {
      impact: (style) => telegram.impact(style),
      notification: (type) => telegram.notification(type),
      selection: () => telegram.selection(),
      isAvailable: () => telegram.getState().hapticsAvailable,
    };
    const haptics = new HapticManager(driver);
    const navigation = new NavigationController(telegram, haptics);
    return { telegram, navigation, haptics };
  }, []);

  useEffect(() => {
    // Startup order matters: Telegram first, then everything that reads it.
    services.telegram.start();
    services.navigation.start();

    const performance = new PerformanceController();
    performance.start();

    const connectivity = new ConnectivityController();
    connectivity.start();

    void useWatchlistStore.getState().hydrate();
    // The active draft and the diary are local data: they must be on screen
    // before any network call is even considered (spec §24, §21).
    void useRatingStore.getState().hydrate();
    // The single slot holds a draft of either kind; both stores read it and
    // each keeps only the kind it owns.
    void useWritingStore.getState().hydrate();
    void useDiaryStore.getState().hydrate();

    /*
     * A WebView can be killed without warning. Every domain commit already
     * wrote the synchronous mirror; this is the best-effort flush of whatever
     * IndexedDB write was still in flight (spec §20.10).
     */
    const flush = () => {
      void useRatingStore.getState().flush();
      void useWritingStore.getState().flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      services.navigation.destroy();
      performance.destroy();
      connectivity.destroy();
      services.telegram.destroy();
    };
  }, [services]);

  return (
    <QueryClientProvider client={queryClient.current}>
      <AppServicesContext.Provider value={services}>
        <ThemeProvider>{children}</ThemeProvider>
      </AppServicesContext.Provider>
    </QueryClientProvider>
  );
};
