import { useCallback, useEffect } from 'react';
import { useNavigationController } from '@app/appServices';
import { useNavigationStore } from '@app/navigation/navigationStore';
import { isWritingRoute } from '@app/navigation/navigationTypes';
import { writingResumeTarget } from '@domain/writing/writing.machine';
import type { WritingScreen } from '@domain/writing/writing.types';
import { useWritingStore } from './writing.store';

/**
 * Everything a writing screen needs in order to move (spec §9, §31).
 *
 * Screens never decide where the flow goes next and never touch history: the
 * machine decides, the navigation controller performs.
 */
export const useWritingFlow = (entryId: string, screen: WritingScreen) => {
  const navigation = useNavigationController();
  const draft = useWritingStore((state) => state.draft);
  const flush = useWritingStore((state) => state.flush);

  const openScreen = useCallback(
    (next: WritingScreen, replace = true) => {
      // Anything typed goes to storage before the screen changes: leaving the
      // editor must never be the moment a paragraph is lost.
      void flush();
      navigation.openWriting({ kind: 'write', entryId, screen: next }, replace);
    },
    [navigation, entryId, flush],
  );

  /** Leaves writing entirely. The draft survives — it is autosaved. */
  const leave = useCallback(() => {
    void flush();
    navigation.closeWriting(entryId);
  }, [navigation, entryId, flush]);

  /*
   * The whole flow shares one history entry, so back inside it is a *screen*
   * change, not a page pop. Registering the interceptor here means our own
   * button and the Telegram BackButton run the very same code.
   */
  useEffect(() => {
    if (!draft) return;
    return navigation.setBackInterceptor(() => {
      if (screen === 'editor' && draft.mode === 'conversation') {
        openScreen('conversation');
        return true;
      }
      if (screen === 'preview') {
        openScreen(draft.mode === 'conversation' ? 'conversation' : 'editor');
        return true;
      }
      // At the flow's first screen, back closes the flow as usual.
      return false;
    });
  }, [navigation, draft, screen, openScreen]);

  return { draft, navigation, openScreen, leave };
};

/**
 * Keeps the URL honest: a link to a screen the draft cannot support (the
 * editor with no draft at all) lands where the draft actually is, rather than
 * rendering an empty editor over someone else's text.
 */
export const useWritingRouteGuard = (
  entryId: string,
  expected: WritingScreen,
): 'ok' | 'redirecting' => {
  const navigation = useNavigationController();
  const draft = useWritingStore((state) => state.draft);
  const hydrated = useWritingStore((state) => state.hydrated);
  // The guard only speaks while writing is genuinely on screen: saving clears
  // the draft *and* leaves, and the unmounting screen must not push back in.
  const stillWriting = useNavigationStore((state) => isWritingRoute(state.current()));

  const missing = hydrated && stillWriting && (!draft || draft.entryId !== entryId);
  const wrongScreen =
    !missing && hydrated && stillWriting && draft
      ? (expected === 'editor' && draft.mode === null) ||
        (expected === 'conversation' && draft.mode !== 'conversation') ||
        (expected === 'preview' && !draft.workingText.trim())
      : false;

  useEffect(() => {
    if (missing) {
      navigation.closeWriting(entryId);
      return;
    }
    if (!wrongScreen || !draft) return;
    navigation.openWriting(
      { kind: 'write', entryId, screen: writingResumeTarget(draft).screen },
      true,
    );
  }, [missing, wrongScreen, draft, entryId, navigation]);

  return missing || wrongScreen ? 'redirecting' : 'ok';
};
