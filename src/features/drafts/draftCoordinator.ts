import type { NavigationController } from '@app/navigation/NavigationController';
import { resumeTarget, type CreateDraftOptions } from '@domain/rating/rating.machine';
import { writingResumeTarget } from '@domain/writing/writing.machine';
import type { CreateWritingDraftOptions } from '@domain/writing/writing.machine';
import type { RatingDraft } from '@domain/rating/rating.types';
import { isWritingDraft, type ActiveDraft, type WritingDraft } from '@domain/writing/writing.types';
import { useRatingStore } from '@features/rating/model/rating.store';
import { useWritingStore } from '@features/writing/model/writing.store';

/**
 * The single door to creating a draft of either kind (spec §7, §6.6).
 *
 * Only one draft may exist at a time and rating and writing share the same
 * storage slot, so *every* entry point — the mode selector, editing a saved
 * entry, starting a text, resuming from the Diary — has to answer the same
 * question first: is there already a draft, and whose is it? Screens that
 * called `start()` directly could silently destroy unfinished work of a
 * different film, which is exactly what this prevents.
 */

export type DraftRequest<TDraft extends ActiveDraft> =
  /** Nothing was in progress — the draft was created. */
  | { kind: 'started'; draft: TDraft }
  /** A draft for this target already existed and is handed back untouched. */
  | { kind: 'resumed'; draft: TDraft }
  /** Something else is unfinished. The caller must ask before going further. */
  | { kind: 'conflict'; existing: ActiveDraft };

export interface RequestDraftOptions extends CreateDraftOptions {
  /** Set only once the user has confirmed losing the existing draft. */
  replaceExisting?: boolean;
}

export interface RequestWritingDraftOptions extends CreateWritingDraftOptions {
  replaceExisting?: boolean;
}

/** Whatever occupies the single slot right now, of either kind. */
export const activeDraft = (): ActiveDraft | null =>
  useRatingStore.getState().draft ?? useWritingStore.getState().draft;

/** The same thing, subscribed — for screens that show the active draft. */
export const useActiveDraft = (): ActiveDraft | null => {
  const rating = useRatingStore((state) => state.draft);
  const writing = useWritingStore((state) => state.draft);
  return rating ?? writing;
};

/** Opens a draft where it left off, whichever kind it is. */
export const openDraftRoute = (navigation: NavigationController, draft: ActiveDraft): void => {
  if (isWritingDraft(draft)) {
    navigation.openWriting({
      kind: 'write',
      entryId: draft.entryId,
      screen: writingResumeTarget(draft).screen,
    });
    return;
  }

  const target = resumeTarget(draft);
  const filmId = draft.filmId;
  switch (target.screen) {
    case 'deep':
      navigation.openRating({ kind: 'rateDeep', filmId, step: target.step });
      return;
    case 'quick':
      navigation.openRating({ kind: 'rateQuick', filmId });
      return;
    case 'result':
      navigation.openRating({ kind: 'rateResult', filmId });
      return;
    case 'mode':
      navigation.openRating({ kind: 'rateMode', filmId });
  }
};

/**
 * Puts a deleted draft back exactly as it was — Undo, not a re-creation.
 *
 * Returns false when a new draft has appeared meanwhile: restoring then would
 * create a second active one, and the newer intent wins.
 */
export const restoreDraft = async (snapshot: ActiveDraft): Promise<boolean> => {
  if (activeDraft()) return false;

  if (isWritingDraft(snapshot)) {
    useWritingStore.setState({ draft: snapshot, dirty: false });
    await useWritingStore.getState().retrySave();
  } else {
    useRatingStore.setState({ draft: snapshot });
    await useRatingStore.getState().retrySave();
  }
  return true;
};

export const draftFilmTitle = (draft: ActiveDraft): string =>
  isWritingDraft(draft) ? draft.film.filmTitle : draft.filmTitle;

/**
 * Both stores read the same row, so only one may hold a draft in memory.
 * A stale copy left in the other store would be flushed back over the new one.
 */
const forgetOtherStore = (kept: 'rating' | 'writing'): void => {
  if (kept !== 'rating') useRatingStore.setState({ draft: null });
  if (kept !== 'writing') useWritingStore.setState({ draft: null, dirty: false });
};

/** Removes whatever is active from storage and memory. */
export const discardActive = async (): Promise<void> => {
  const existing = activeDraft();
  if (!existing) return;
  if (isWritingDraft(existing)) await useWritingStore.getState().discard();
  else await useRatingStore.getState().discard();
  forgetOtherStore(isWritingDraft(existing) ? 'writing' : 'rating');
};

/**
 * Never throws work away without being told to. `replaceExisting` is the only
 * way past an existing draft, and it is only ever passed after a confirmation.
 */
export const requestDraft = async (
  options: RequestDraftOptions,
): Promise<DraftRequest<RatingDraft>> => {
  const existing = activeDraft();
  const { replaceExisting, ...createOptions } = options;
  const filmId = createOptions.film.filmId;

  if (existing && !replaceExisting) {
    // An unfinished text is work too: rating over it would destroy it.
    if (isWritingDraft(existing)) return { kind: 'conflict', existing };
    if (existing.filmId !== filmId) return { kind: 'conflict', existing };

    // Same film: an edit of a different entry is a different intent.
    const sameTarget = (existing.editingEntryId ?? null) === (createOptions.editingEntryId ?? null);
    if (sameTarget) return { kind: 'resumed', draft: existing };
    return { kind: 'conflict', existing };
  }

  forgetOtherStore('rating');
  const draft = await useRatingStore.getState().start(createOptions);
  return { kind: 'started', draft };
};

export const requestWritingDraft = async (
  options: RequestWritingDraftOptions,
): Promise<DraftRequest<WritingDraft>> => {
  const existing = activeDraft();
  const { replaceExisting, ...createOptions } = options;

  if (existing && !replaceExisting) {
    if (!isWritingDraft(existing)) return { kind: 'conflict', existing };
    // The text belongs to an entry, so the entry is what identifies the draft.
    if (existing.entryId !== createOptions.entryId) return { kind: 'conflict', existing };
    return { kind: 'resumed', draft: existing };
  }

  forgetOtherStore('writing');
  const draft = await useWritingStore.getState().start(createOptions);
  return { kind: 'started', draft };
};

/** Discards whatever is active and starts the requested draft in its place. */
export const replaceDraft = async (options: RequestDraftOptions): Promise<RatingDraft> => {
  await discardActive();
  const { replaceExisting: _confirmed, ...createOptions } = options;
  forgetOtherStore('rating');
  return useRatingStore.getState().start(createOptions);
};

export const replaceWithWritingDraft = async (
  options: RequestWritingDraftOptions,
): Promise<WritingDraft> => {
  await discardActive();
  const { replaceExisting: _confirmed, ...createOptions } = options;
  forgetOtherStore('writing');
  return useWritingStore.getState().start(createOptions);
};
