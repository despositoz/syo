import { create } from 'zustand';
import { calculateDeepResult, calculateQuickResult } from '@domain/rating/rating.calculator';
import { createId } from '@domain/rating/rating.validation';
import { emptyAspects, type RatingDraft } from '@domain/rating/rating.types';
import { sortForDiary } from '@domain/diary/diary.schema';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { readPreference, writePreference } from '@shared/storage/db';
import { diaryRepository, type DiaryRepository } from '../repositories/diary.repository';

/**
 * The Diary's local state. Reads are local-first: entries appear straight from
 * IndexedDB and sync never gates the UI (spec §39).
 */

const VIEW_PREFERENCE_KEY = 'diary.view';

export type DiaryView = 'grid' | 'list';

export interface DiaryState {
  entries: DiaryEntry[];
  hydrated: boolean;
  view: DiaryView;
  /** Entry id that should briefly highlight after a save. */
  highlightedId: string | null;

  hydrate: () => Promise<void>;
  setView: (view: DiaryView) => Promise<void>;
  saveFromDraft: (draft: RatingDraft) => Promise<DiaryEntry>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  clearHighlight: () => void;
}

let repository: DiaryRepository = diaryRepository;

/** Test seam. */
export const setDiaryRepository = (next: DiaryRepository): void => {
  repository = next;
};

/**
 * Turns a finished draft into an entry. Editing keeps the entry id — that is
 * what stops a second card appearing for the same film (spec §36).
 */
export const entryFromDraft = (draft: RatingDraft, existing?: DiaryEntry | null): DiaryEntry => {
  const now = new Date().toISOString();
  const deep = draft.mode === 'deep';
  const result = deep
    ? calculateDeepResult(draft.aspects)
    : draft.quickRating !== null
      ? calculateQuickResult(draft.quickRating)
      : null;

  if (!result || !result.complete) {
    throw new Error('A diary entry needs a finished rating');
  }

  return {
    id: draft.editingEntryId ?? existing?.id ?? createId(),
    filmId: draft.filmId,
    filmTitle: draft.filmTitle,
    posterPath: draft.posterPath,
    releaseYear: draft.releaseYear,
    mode: deep ? 'deep' : 'quick',
    overallRating: result.overallRating,
    preciseRating: result.preciseRating,
    // Quick carries no aspects: an entry never shows an empty table.
    aspects: deep ? draft.aspects : emptyAspects(),
    hasText: false,
    text: null,
    watchedAt: existing?.watchedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // New per save: a replayed sync or a double tap collapses into one row.
    clientMutationId: createId(),
    revision: (existing?.revision ?? 0) + 1,
    syncStatus: 'local',
    deletedAt: null,
  };
};

export const useDiaryStore = create<DiaryState>((set, get) => ({
  entries: [],
  hydrated: false,
  view: 'grid',
  highlightedId: null,

  hydrate: async () => {
    const [entries, view] = await Promise.all([
      repository.listActive(),
      readPreference<DiaryView>(VIEW_PREFERENCE_KEY, 'grid'),
    ]);
    set({
      entries: sortForDiary(entries),
      view: view === 'list' ? 'list' : 'grid',
      hydrated: true,
    });
  },

  setView: async (view) => {
    set({ view });
    await writePreference(VIEW_PREFERENCE_KEY, view);
  },

  saveFromDraft: async (draft) => {
    const existing = draft.editingEntryId
      ? await repository.getById(draft.editingEntryId)
      : await repository.getByFilmId(draft.filmId);

    const stored = await repository.upsert(entryFromDraft(draft, existing));
    set({ entries: sortForDiary(await repository.listActive()), highlightedId: stored.id });
    return stored;
  },

  remove: async (id) => {
    const before = get().entries;
    // Optimistic: the card leaves at once, the tombstone keeps Undo possible.
    set({ entries: before.filter((entry) => entry.id !== id) });
    try {
      await repository.softDelete(id);
    } catch (error) {
      // The delete never reached storage — put the card back rather than let
      // the list disagree with what is actually saved.
      set({ entries: before });
      throw error;
    }
    set({ entries: sortForDiary(await repository.listActive()) });
  },

  restore: async (id) => {
    await repository.restore(id);
    set({ entries: sortForDiary(await repository.listActive()), highlightedId: id });
  },

  clearHighlight: () => set({ highlightedId: null }),
}));

export const useDiaryEntry = (entryId: string): DiaryEntry | null =>
  useDiaryStore((state) => state.entries.find((entry) => entry.id === entryId) ?? null);

export const useDiaryEntryForFilm = (filmId: number): DiaryEntry | null =>
  useDiaryStore((state) => state.entries.find((entry) => entry.filmId === filmId) ?? null);
