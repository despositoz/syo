import { create } from 'zustand';
import {
  createDraft,
  goToAspect,
  nextStep,
  setAspectScore,
  setQuickScore,
  upgradeToDetailed,
  type CreateDraftOptions,
} from '@domain/rating/rating.machine';
import type {
  FilmSnapshot,
  RatingAspectId,
  RatingDraft,
  RatingMode,
  RatingValue,
} from '@domain/rating/rating.types';
import { StorageError } from '@shared/storage/db';
import {
  ratingDraftRepository,
  type RatingDraftRepository,
} from '@features/rating/repositories/ratingDraft.repository';

/**
 * The single active rating draft (spec §12.1).
 *
 * The store owns the in-memory copy; every domain commit is mirrored to the
 * repository immediately, so a force close loses at most nothing. The store
 * never touches Telegram, navigation or React — screens read it.
 */

export interface RatingState {
  draft: RatingDraft | null;
  hydrated: boolean;
  /** Set when a local write failed, so the UI can offer a retry. */
  storageError: StorageError | null;

  hydrate: () => Promise<void>;
  start: (options: CreateDraftOptions) => Promise<RatingDraft>;
  setQuick: (value: RatingValue) => Promise<void>;
  setAspect: (aspectId: RatingAspectId, value: RatingValue) => Promise<void>;
  goToAspect: (aspectId: RatingAspectId) => Promise<void>;
  advance: () => Promise<RatingDraft | null>;
  switchToDetailed: () => Promise<void>;
  discard: () => Promise<void>;
  /** Best-effort write for pagehide / visibilitychange. */
  flush: () => Promise<void>;
  clearStorageError: () => void;
}

let repository: RatingDraftRepository = ratingDraftRepository;

/** Test seam. */
export const setRatingDraftRepository = (next: RatingDraftRepository): void => {
  repository = next;
};

export const useRatingStore = create<RatingState>((set, get) => {
  /**
   * Applies a pure transition and persists it. The in-memory draft is updated
   * first so the UI never waits for IndexedDB, and a storage failure surfaces
   * as state rather than as an exception in an event handler.
   */
  const commit = async (next: RatingDraft): Promise<void> => {
    set({ draft: next });
    try {
      await repository.saveActive(next);
      if (get().storageError) set({ storageError: null });
    } catch (error) {
      set({ storageError: error instanceof StorageError ? error : new StorageError('unknown', error) });
    }
  };

  return {
    draft: null,
    hydrated: false,
    storageError: null,

    hydrate: async () => {
      const draft = await repository.getActive().catch(() => null);
      set({ draft, hydrated: true });
    },

    start: async (options) => {
      const draft = createDraft(options);
      await commit(draft);
      return draft;
    },

    setQuick: async (value) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setQuickScore(draft, value));
    },

    setAspect: async (aspectId, value) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setAspectScore(draft, aspectId, value));
    },

    goToAspect: async (aspectId) => {
      const draft = get().draft;
      if (!draft) return;
      const next = goToAspect(draft, aspectId);
      if (next === draft) return; // locked aspect — nothing changed
      await commit(next);
    },

    advance: async () => {
      const draft = get().draft;
      if (!draft) return null;
      const next = nextStep(draft);
      if (next === draft) return draft;
      await commit(next);
      return next;
    },

    switchToDetailed: async () => {
      const draft = get().draft;
      if (!draft) return;
      await commit(upgradeToDetailed(draft));
    },

    discard: async () => {
      set({ draft: null, storageError: null });
      await repository.deleteActive().catch(() => undefined);
    },

    flush: async () => {
      await repository.flush().catch(() => undefined);
    },

    clearStorageError: () => set({ storageError: null }),
  };
});

/** The draft belongs to this film — used to decide resume vs conflict. */
export const draftMatchesFilm = (draft: RatingDraft | null, filmId: number): boolean =>
  draft !== null && draft.film.filmId === filmId;

/** Snapshot of everything the flow needs about a film, taken once at start. */
export const snapshotFromFilm = (film: {
  id: number;
  title: string;
  originalTitle?: string;
  year?: string;
  posterPath?: string;
  backdropPath?: string;
  accent?: { rgb: string };
}): FilmSnapshot => {
  const snapshot: FilmSnapshot = {
    filmId: film.id,
    title: film.title,
    updatedAt: new Date().toISOString(),
  };
  if (film.originalTitle) snapshot.originalTitle = film.originalTitle;
  const year = Number(film.year);
  if (Number.isFinite(year) && year > 0) snapshot.releaseYear = year;
  if (film.posterPath) snapshot.posterPath = film.posterPath;
  if (film.backdropPath) snapshot.backdropPath = film.backdropPath;
  if (film.accent?.rgb) snapshot.dominantColor = film.accent.rgb;
  return snapshot;
};

export type { RatingMode };
