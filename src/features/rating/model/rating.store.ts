import { create } from 'zustand';
import {
  createDraft,
  goToStep,
  setAspectRating,
  setMode,
  setQuickRating,
  type CreateDraftOptions,
  type RatingFilmSummary,
} from '@domain/rating/rating.machine';
import type {
  RatingAspectId,
  RatingDraft,
  RatingFlowState,
  RatingMode,
  RatingValue,
} from '@domain/rating/rating.types';
import { flowStateOf } from '@domain/rating/rating.machine';
import { isRatingDraft } from '@domain/writing/writing.types';
import { StorageError } from '@shared/storage/db';
import {
  activeDraftRepository,
  type ActiveDraftRepository,
} from '@features/drafts/activeDraft.repository';

/**
 * The single active rating draft (spec §7).
 *
 * The store owns the in-memory copy; every domain commit is persisted at once,
 * so a force close loses nothing. It never touches Telegram, navigation or
 * React — screens read it.
 */

export interface RatingState {
  draft: RatingDraft | null;
  hydrated: boolean;
  /** Set when a local write failed, so the UI can offer a retry. */
  storageError: StorageError | null;

  hydrate: () => Promise<void>;
  start: (options: CreateDraftOptions) => Promise<RatingDraft>;
  chooseMode: (mode: RatingMode) => Promise<void>;
  setQuick: (value: RatingValue) => Promise<void>;
  setAspect: (aspectId: RatingAspectId, value: RatingValue) => Promise<void>;
  goToStep: (step: number) => Promise<void>;
  discard: () => Promise<void>;
  /** Best-effort write for pagehide / visibilitychange. */
  flush: () => Promise<void>;
  /** Writes the current draft again after a storage failure. */
  retrySave: () => Promise<void>;
  clearStorageError: () => void;
}

let repository: ActiveDraftRepository = activeDraftRepository;

/** Test seam. */
export const setActiveDraftRepository = (next: ActiveDraftRepository): void => {
  repository = next;
};

export const useRatingStore = create<RatingState>((set, get) => {
  /**
   * Applies a pure transition and persists it.
   *
   * A failed write is recorded in `storageError` *and* rethrown. Swallowing it
   * would tell the caller everything was fine while the answer existed only in
   * memory — the flow would carry on and a force-close would lose an answer the
   * user had already seen confirmed.
   */
  const commit = async (next: RatingDraft): Promise<void> => {
    set({ draft: next });
    try {
      await repository.saveActive(next);
      if (get().storageError) set({ storageError: null });
    } catch (error) {
      const failure = error instanceof StorageError ? error : new StorageError('unknown', error);
      set({ storageError: failure });
      throw failure;
    }
  };

  return {
    draft: null,
    hydrated: false,
    storageError: null,

    hydrate: async () => {
      const stored = await repository.getActive().catch(() => null);
      // A writing draft belongs to the writing store; this one only owns ratings.
      set({ draft: isRatingDraft(stored) ? stored : null, hydrated: true });
    },

    start: async (options) => {
      const draft = createDraft(options);
      await commit(draft);
      return draft;
    },

    chooseMode: async (mode) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setMode(draft, mode));
    },

    setQuick: async (value) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setQuickRating(draft, value));
    },

    setAspect: async (aspectId, value) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setAspectRating(draft, aspectId, value));
    },

    goToStep: async (step) => {
      const draft = get().draft;
      if (!draft) return;
      const next = goToStep(draft, step);
      if (next === draft) return; // locked step — nothing changed
      await commit(next);
    },

    /**
     * Clears storage *first*. Wiping memory and then ignoring a failed delete
     * would resurrect the draft on the next launch — the user would find a
     * rating they had explicitly thrown away.
     */
    discard: async () => {
      try {
        await repository.deleteActive();
      } catch (error) {
        const failure = error instanceof StorageError ? error : new StorageError('unknown', error);
        set({ storageError: failure });
        throw failure;
      }
      set({ draft: null, storageError: null });
    },

    flush: async () => {
      await repository.flush().catch(() => undefined);
    },

    retrySave: async () => {
      const draft = get().draft;
      if (!draft) return;
      await commit(draft);
    },

    clearStorageError: () => set({ storageError: null }),
  };
});

/** The draft belongs to this film — used to decide resume vs conflict. */
export const draftMatchesFilm = (draft: RatingDraft | null, filmId: number): boolean =>
  draft !== null && draft.filmId === filmId;

export const useRatingFlowState = (): RatingFlowState =>
  useRatingStore((state) => flowStateOf(state.draft));

/** Everything the flow needs about a film, taken once from local data. */
export const filmSummaryFrom = (film: {
  id: number;
  title: string;
  year?: string;
  posterPath?: string;
  backdropPath?: string;
  accent?: { rgb: string };
}): RatingFilmSummary => ({
  filmId: film.id,
  filmTitle: film.title,
  posterPath: film.posterPath || null,
  backdropPath: film.backdropPath || null,
  releaseYear: film.year || null,
  dominantColor: film.accent?.rgb ?? null,
});
