import { useCallback, useEffect } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { useNavigationStore } from '@app/navigation/navigationStore';
import { isRatingRoute } from '@app/navigation/navigationTypes';
import { backTarget, canOpenAspect, resumeTarget } from '@domain/rating/rating.machine';
import type { RatingAspectId, RatingDraft, RatingValue } from '@domain/rating/rating.types';
import { useRatingStore } from './rating.store';

/**
 * Everything a rating screen needs to move around, in one place.
 *
 * Screens never compute the next step themselves and never call the Telegram
 * API: the machine decides, the navigation controller performs (spec §27.5).
 */
export const useRatingFlow = (filmId: number) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();
  const draft = useRatingStore((state) => state.draft);

  const openScreen = useCallback(
    (target: ReturnType<typeof resumeTarget>, replace = true) => {
      if (target.screen === 'aspect') {
        navigation.openRating({ kind: 'rateAspect', filmId, aspectId: target.aspectId }, replace);
        return;
      }
      navigation.openRating(
        target.screen === 'quick' ? { kind: 'rateQuick', filmId } : { kind: 'rateResult', filmId },
        replace,
      );
    },
    [navigation, filmId],
  );

  /** Star steps and the maximum flourish — the control stays haptics-agnostic. */
  const onStarHaptic = useCallback(
    (value: RatingValue, reachedMaximum: boolean) => {
      haptics.trigger(reachedMaximum ? 'ratingMaximum' : 'ratingStep', `star:${value}`);
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
      const target = backTarget(current);
      switch (target.kind) {
        case 'aspect':
          navigation.openRating({ kind: 'rateAspect', filmId, aspectId: target.aspectId }, true);
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
    [navigation, filmId],
  );

  const canOpen = useCallback(
    (aspectId: RatingAspectId) => (draft ? canOpenAspect(draft, aspectId) : false),
    [draft],
  );

  /*
   * Back inside the flow is a *step*, not a page pop: aspects are one history
   * entry, so without this the Telegram BackButton would close the whole flow
   * from aspect 3 (spec §20.9). Registering it here means our own button and
   * Telegram's press the very same code path.
   */
  useEffect(() => {
    if (!draft) return;
    return navigation.setBackInterceptor(() => {
      const target = backTarget(draft);
      // At the flow's own first step, let the normal back close the flow.
      if (target.kind === 'mode' || target.kind === 'film') return false;
      goBack(draft);
      return true;
    });
  }, [navigation, draft, goBack]);

  return { draft, navigation, haptics, openScreen, goBack, onStarHaptic, canOpen };
};

/**
 * Keeps the URL honest: if the route asks for a screen the draft cannot
 * support (a direct link to /result with nothing rated), the flow is redirected
 * to the first unfinished step instead of rendering a broken result (spec §5.7).
 */
export const useRatingRouteGuard = (
  filmId: number,
  expected: 'quick' | 'aspect' | 'result',
  aspectId?: RatingAspectId,
): 'ok' | 'redirecting' => {
  const navigation = useNavigationController();
  const draft = useRatingStore((state) => state.draft);
  const hydrated = useRatingStore((state) => state.hydrated);
  /*
   * The guard only speaks while the flow is genuinely on screen. Saving clears
   * the draft *and* leaves for the Diary; without this check the unmounting
   * screen would see "no draft" one last time and push itself back into the
   * flow, fighting the navigation that just happened.
   */
  const stillInFlow = useNavigationStore((state) => isRatingRoute(state.current()));

  const mismatch =
    hydrated &&
    stillInFlow &&
    (!draft ||
      draft.film.filmId !== filmId ||
      (expected === 'result' && resumeTarget(draft).screen !== 'result') ||
      (expected === 'aspect' && aspectId !== undefined && !canOpenAspect(draft, aspectId)));

  useEffect(() => {
    if (!mismatch) return;
    if (!draft || draft.film.filmId !== filmId) {
      // No draft for this film at all: the film page is the honest destination.
      navigation.openRating({ kind: 'rateMode', filmId }, true);
      return;
    }
    const target = resumeTarget(draft);
    if (target.screen === 'aspect') {
      navigation.openRating({ kind: 'rateAspect', filmId, aspectId: target.aspectId }, true);
    } else if (target.screen === 'quick') {
      navigation.openRating({ kind: 'rateQuick', filmId }, true);
    } else {
      navigation.openRating({ kind: 'rateResult', filmId }, true);
    }
  }, [mismatch, draft, filmId, navigation]);

  return mismatch ? 'redirecting' : 'ok';
};
