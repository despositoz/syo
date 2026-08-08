import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { useNavigationStore } from './navigation/navigationStore';
import { routeKey, type Route, type RootTab } from './navigation/navigationTypes';
import { useNavigationController } from './appServices';
import { BottomBar } from '@shared/ui/BottomBar/BottomBar';
import { Snackbar } from '@shared/ui/Snackbar/Snackbar';
import { SyncIndicator } from '@shared/ui/SyncIndicator/SyncIndicator';
import { runPageTransition } from '@shared/motion/transitions';
import { usePerformanceStore } from './performance/PerformanceController';
import { FeedPage } from '@features/feed/screens/FeedPage';
import { DiaryPage } from '@features/diary/screens/DiaryPage';
import { DiaryEntryPage } from '@features/diary/screens/DiaryEntryPage';
import { ProfilePage } from '@features/profile/screens/ProfilePage';
const TasteSignaturePage = lazy(() =>
  import('@features/profile/screens/TasteSignaturePage').then((module) => ({
    default: module.TasteSignaturePage,
  })),
);
const SettingsPage = lazy(() =>
  import('@features/profile/screens/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);
import { MoviePickerPage } from '@pages/movie-picker/MoviePickerPage';
import { FilmPage } from '@pages/film/FilmPage';
import { RatingModePage } from '@features/rating/screens/RatingModePage';
import { QuickRatingPage } from '@features/rating/screens/QuickRatingPage';
import { DeepRatingPage } from '@features/rating/screens/DeepRatingPage';
import { RatingResultPage } from '@features/rating/screens/RatingResultPage';
/*
 * The writing flow is the largest feature and the one a session is least
 * likely to reach: it loads when a text is actually started, not on boot.
 */
const WritingPage = lazy(() =>
  import('@features/writing/screens/WritingPage').then((module) => ({
    default: module.WritingPage,
  })),
);
import styles from './AppShell.module.css';

const RootScreen = ({ tab }: { tab: RootTab }) => {
  switch (tab) {
    case 'feed':
      return <FeedPage />;
    case 'diary':
      return <DiaryPage />;
    case 'profile':
      return <ProfilePage />;
  }
};

const OverlayScreen = ({ route }: { route: Route }) => {
  switch (route.kind) {
    case 'picker':
      return <MoviePickerPage />;
    case 'film':
      return <FilmPage filmId={route.filmId} initialTitle={route.title} />;
    case 'rateMode':
      return <RatingModePage filmId={route.filmId} />;
    case 'rateQuick':
      return <QuickRatingPage filmId={route.filmId} />;
    case 'rateDeep':
      return <DeepRatingPage filmId={route.filmId} step={route.step} />;
    case 'rateResult':
      return <RatingResultPage filmId={route.filmId} />;
    case 'write':
      return (
        // No spinner: the chunk arrives in a frame or two, and a flash of
        // "loading" would be more noticeable than the wait itself.
        <Suspense fallback={null}>
          <WritingPage entryId={route.entryId} screen={route.screen} />
        </Suspense>
      );
    case 'tasteSignature':
      return (
        <Suspense fallback={null}>
          <TasteSignaturePage />
        </Suspense>
      );
    case 'settings':
      return (
        <Suspense fallback={null}>
          <SettingsPage />
        </Suspense>
      );
    case 'diaryEntry':
      return <DiaryEntryPage entryId={route.entryId} />;
    case 'root':
      return null;
  }
};

/** Enters with a short fade+shift; leaves the same way. No scale, ever. */
const PageLayer = ({
  children,
  direction,
  onExitComplete,
}: {
  children: ReactNode;
  direction: 'enter' | 'exit';
  onExitComplete?: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);

  useEffect(() => {
    let cancelled = false;
    void runPageTransition(ref.current, direction, { reducedMotion }).then(() => {
      if (!cancelled && direction === 'exit') onExitComplete?.();
    });
    return () => {
      cancelled = true;
    };
    // Direction never changes for a given layer instance.
  }, [direction, reducedMotion, onExitComplete]);

  return (
    <div
      className={styles.pageLayer}
      ref={ref}
      data-direction={direction}
      aria-hidden={direction === 'exit' || undefined}
      inert={direction === 'exit'}
    >
      {children}
    </div>
  );
};

/**
 * The single app frame.
 *
 * Height comes from the Telegram viewport (with a 100dvh fallback), so the
 * layout never depends on a hard-coded top offset.
 */
export const AppShell = () => {
  const navigation = useNavigationController();
  const stack = useNavigationStore((state) => state.stack);
  const activeTab = useNavigationStore((state) => state.activeTab);
  const leaving = useNavigationStore((state) => state.leaving);
  const phase = useNavigationStore((state) => state.phase);
  const finishLeaving = useNavigationStore((state) => state.finishLeaving);

  const top = stack[stack.length - 1];
  const isRootScreen = stack.length === 1;
  const overlayRoute = !isRootScreen && top ? top : null;

  return (
    <div className={styles.shell}>
      <div className={styles.rootLayer} aria-hidden={overlayRoute ? true : undefined}>
        <RootScreen tab={activeTab} />
      </div>

      {overlayRoute ? (
        <PageLayer key={routeKey(overlayRoute)} direction="enter">
          <OverlayScreen route={overlayRoute} />
        </PageLayer>
      ) : null}

      {phase === 'leaving' && leaving ? (
        <PageLayer
          key={`leaving-${routeKey(leaving)}`}
          direction="exit"
          onExitComplete={finishLeaving}
        >
          <OverlayScreen route={leaving} />
        </PageLayer>
      ) : null}

      <BottomBar
        activeTab={activeTab}
        hidden={!isRootScreen}
        onSelectTab={(tab) => navigation.selectTab(tab)}
        onRate={() => navigation.openPicker()}
      />

      <SyncIndicator />
      <Snackbar />
    </div>
  );
};
