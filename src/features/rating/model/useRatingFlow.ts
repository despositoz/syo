import { useCallback, useEffect } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { useNavigationStore } from '@app/navigation/navigationStore';
import { isRatingRoute } from '@app/navigation/navigationTypes';
import {
  backTargetFrom,
  canOpenResult,
  canOpenStep,
  resumeTarget,
} from '@domain/rating/rating.machine';
import type { ResumeTarget } from '@domain/rating/rating.machine';
import type { RatingDraft, RatingValue } from '@domain/rating/rating.types';
import { useRatingStore } from './rating.store';

export type RatingScreenName = 'mode' | 'quick' | 'deep' | 'result';

/**
 * Everything a rating screen needs in order to move, in one place.
 *
 * Screens never compute the next step themselves and never call the Telegram
 * API: the machine decides, the navigation controller performs.
 */
export const useRatingFlow = (filmId: number, screen: RatingScreenName) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();
  const draft = useRatingStore((state) => state.draft);

  const openTarget = useCallback(
    (target: ResumeTarget, replace = true) => {
      switch (target.screen) {
        case 'deep':
          navigation.openRating({ kind: 'rateDeep', filmId, step: target.step }, replace);
          return;
        case 'quick':
          navigation.openRating({ kind: 'rateQuick', filmId }, replace);
          return;
        case 'result':
          navigation.openRating({ kind: 'rateResult', filmId }, replace);
          return;
        case 'mode':
          navigation.openRating({ kind: 'rateMode', filmId }, replace);
      }
    },
    [navigation, filmId],
  );

  /** One subtle selection per new whole star — the control stays agnostic. */
  const onStarHaptic = useCallback(
    (value: RatingValue) => {
      haptics.trigger('ratingValueChange', `star:${value}`);
    },
    [haptics],
  );

  /** Back inside the flow. The draft is never destroyed by going back. */
  const goBack = useCallback(
    (current: RatingDraft | null) => {
      if (!current) {
        navigation.goBack();
        return;
      }
      const target = backTargetFrom(current, screen);
      switch (target.kind) {
        case 'step':
          navigation.openRating({ kind: 'rateDeep', filmId, step: target.step }, true);
          return;
        case 'quick':
          navigation.openRating({ kind: 'rateQuick', filmId }, true);
          return;
        case 'mode':
          navigation.openRating({ kind: 'rateMode', filmId }, true);
          return;
        case 'film':
          navigation.goBack();
      }
    },
    [navigation, filmId, screen],
  );

  const canOpen = useCallback(
    (step: number) => (draft ? canOpenStep(draft, step) : false),
    [draft],
  );

  /*
   * Back inside the flow is a *step*, not a page pop: the five steps share one
   * history entry, so without this the Telegram BackButton would close the whole
   * flow from step 3. Registering it here means our own button and Telegram's
   * press the very same code path.
   */
  useEffect(() => {
    if (!draft) return;
    return navigation.setBackInterceptor(() => {
      const target = backTargetFrom(draft, screen);
      // At the flow's own first screen, let the normal back close the flow.
      if (target.kind === 'mode' && screen === 'mode') return false;
      if (target.kind === 'film') return false;
      goBack(draft);
      return true;
    });
  }, [navigation, draft, goBack, screen]);

  return { draft, navigation, haptics, openTarget, goBack, onStarHaptic, canOpen };
};

/**
 * Keeps the URL honest: a route the draft cannot support (a direct link to the
 * result with nothing rated) redirects to the first unfinished step rather than
 * rendering something broken (spec §31.2).
 */
export const useRatingRouteGuard = (
  filmId: number,
  expected: RatingScreenName,
  step?: number,
): 'ok' | 'redirecting' => {
  const navigation = useNavigationController();
  const draft = useRatingStore((state) => state.draft);
  const hydrated = useRatingStore((state) => state.hydrated);
  /*
   * The guard only speaks while the flow is genuinely on screen. Saving clears
   * the draft *and* leaves for the Diary; without this the unmounting screen
   * would see "no draft" one last time and push itself back into the flow.
   */
  const stillInFlow = useNavigationStore((state) => isRatingRoute(state.current()));

  const mismatch =
    hydrated &&
    stillInFlow &&
    (!draft ||
      draft.filmId !== filmId ||
      // The result is reachable whenever the data supports it — not only when
      // it is where a resumed draft would land.
      (expected === 'result' && !canOpenResult(draft)) ||
      (expected === 'quick' && draft.mode !== 'quick') ||
      (expected === 'deep' && step !== undefined && !canOpenStep(draft, step)));

  useEffect(() => {
    if (!mismatch) return;
    if (!draft || draft.filmId !== filmId) {
      navigation.openRating({ kind: 'rateMode', filmId }, true);
      return;
    }
    const next = resumeTarget(draft);
    if (next.screen === 'deep') {
      navigation.openRating({ kind: 'rateDeep', filmId, step: next.step }, true);
    } else if (next.screen === 'quick') {
      navigation.openRating({ kind: 'rateQuick', filmId }, true);
    } else if (next.screen === 'result') {
      navigation.openRating({ kind: 'rateResult', filmId }, true);
    } else {
      navigation.openRating({ kind: 'rateMode', filmId }, true);
    }
  }, [mismatch, draft, filmId, navigation]);

  return mismatch ? 'redirecting' : 'ok';
};
