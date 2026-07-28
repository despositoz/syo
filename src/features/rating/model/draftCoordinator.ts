import type { CreateDraftOptions } from '@domain/rating/rating.machine';
import type { RatingDraft } from '@domain/rating/rating.types';
import { useRatingStore, draftMatchesFilm } from './rating.store';

/**
 * The single door to creating a rating draft.
 *
 * Only one draft may exist at a time, so *every* entry point — the mode
 * selector, editing a saved entry, resuming from the Diary — has to answer the
 * same question first: is there already a draft, and whose is it? Screens that
 * called `start()` directly could silently destroy an unfinished rating of a
 * different film, which is exactly what this prevents.
 */

export type DraftRequest =
  /** Nothing was in progress — the draft was created. */
  | { kind: 'started'; draft: RatingDraft }
  /** A draft for this film already existed and is handed back untouched. */
  | { kind: 'resumed'; draft: RatingDraft }
  /** Another film is mid-rating. The caller must ask before going further. */
  | { kind: 'conflict'; existing: RatingDraft }
  /**
   * A draft for this film exists but in the other mode. Switching would throw
   * away what is already answered, so the caller must confirm.
   */
  | { kind: 'modeConflict'; existing: RatingDraft };

export interface RequestDraftOptions extends CreateDraftOptions {
  /** Set once the user has confirmed losing the existing draft. */
  replaceExisting?: boolean;
}

/**
 * Never throws away work without being told to. `replaceExisting` is the only
 * way past an existing draft, and it is only ever passed after a confirmation
 * sheet.
 */
export const requestDraft = async (options: RequestDraftOptions): Promise<DraftRequest> => {
  const store = useRatingStore.getState();
  const existing = store.draft;
  const { replaceExisting, ...createOptions } = options;
  const filmId = createOptions.film.filmId;

  if (existing && !replaceExisting) {
    if (!draftMatchesFilm(existing, filmId)) return { kind: 'conflict', existing };

    // Same film: an edit of a different entry is also a different intent.
    const sameTarget = (existing.editingEntryId ?? null) === (createOptions.editingEntryId ?? null);
    if (existing.mode === createOptions.mode && sameTarget) {
      return { kind: 'resumed', draft: existing };
    }
    return { kind: 'modeConflict', existing };
  }

  const draft = await store.start(createOptions);
  return { kind: 'started', draft };
};

/** Discards whatever is active and starts the requested draft in its place. */
export const replaceDraft = async (options: RequestDraftOptions): Promise<RatingDraft> => {
  const store = useRatingStore.getState();
  await store.discard();
  const { replaceExisting: _ignored, ...createOptions } = options;
  return store.start(createOptions);
};
