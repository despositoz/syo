import { create } from 'zustand';
import { calculateResult, quickResult } from '@domain/rating/rating.calculation';
import { createId } from '@domain/rating/rating.validation';
import type { RatingDraft } from '@domain/rating/rating.types';
import type { JournalEntry, JournalView } from '@domain/journal/journal.types';
import { readPreference, writePreference } from '@shared/storage/db';
import {
  journalRepository,
  type JournalRepository,
} from '@features/journal/repositories/journal.repository';

/**
 * The Diary's local state. Reads are local-first: entries appear immediately
 * from IndexedDB and sync never gates the UI (spec §14.4).
 */

const VIEW_PREFERENCE_KEY = 'journal.view';

export interface JournalState {
  entries: JournalEntry[];
  hydrated: boolean;
  view: JournalView;
  /** Entry id that should briefly highlight after a save. */
  highlightedId: string | null;

  hydrate: () => Promise<void>;
  setView: (view: JournalView) => Promise<void>;
  saveFromDraft: (draft: RatingDraft) => Promise<JournalEntry>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  clearHighlight: () => void;
}

let repository: JournalRepository = journalRepository;

/** Test seam. */
export const setJournalRepository = (next: JournalRepository): void => {
  repository = next;
};

/**
 * Turns a finished draft into an entry. Editing keeps the entry id — that is
 * what stops a second card appearing for the same film (spec §18.1).
 */
export const entryFromDraft = (draft: RatingDraft, existing?: JournalEntry | null): JournalEntry => {
  const now = new Date().toISOString();
  const detailed = draft.mode === 'detailed';
  const result = detailed ? calculateResult(draft.aspects) : quickResult(draft.quickScore ?? 0);

  return {
    schemaVersion: 1,
    id: draft.editingEntryId ?? existing?.id ?? createId(),
    // New per save: a replayed sync or a double tap collapses into one row.
    clientMutationId: createId(),
    filmId: draft.film.filmId,
    film: draft.film,
    mode: draft.mode,
    quickScore: detailed ? null : draft.quickScore,
    aspects: detailed ? draft.aspects : null,
    rawScore: result.rawAverage,
    displayScore: result.displayScore,
    formulaVersion: result.formulaVersion,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1,
    syncStatus: 'local',
    deletedAt: null,
  };
};

export const useJournalStore = create<JournalState>((set, get) => ({
  entries: [],
  hydrated: false,
  view: 'grid',
  highlightedId: null,

  hydrate: async () => {
    const [entries, view] = await Promise.all([
      repository.listActive(),
      readPreference<JournalView>(VIEW_PREFERENCE_KEY, 'grid'),
    ]);
    set({ entries, view: view === 'list' ? 'list' : 'grid', hydrated: true });
  },

  setView: async (view) => {
    set({ view });
    await writePreference(VIEW_PREFERENCE_KEY, view);
  },

  saveFromDraft: async (draft) => {
    const existing = draft.editingEntryId
      ? await repository.getById(draft.editingEntryId)
      : await repository.getByFilmId(draft.film.filmId);

    const stored = await repository.upsert(entryFromDraft(draft, existing));
    set({ entries: await repository.listActive(), highlightedId: stored.id });
    return stored;
  },

  remove: async (id) => {
    // Optimistic: the card leaves at once, the tombstone keeps Undo possible.
    set({ entries: get().entries.filter((entry) => entry.id !== id) });
    await repository.softDelete(id);
    set({ entries: await repository.listActive() });
  },

  restore: async (id) => {
    await repository.restore(id);
    set({ entries: await repository.listActive(), highlightedId: id });
  },

  clearHighlight: () => set({ highlightedId: null }),
}));

export const useJournalEntry = (entryId: string): JournalEntry | null =>
  useJournalStore((state) => state.entries.find((entry) => entry.id === entryId) ?? null);

export const useJournalEntryForFilm = (filmId: number): JournalEntry | null =>
  useJournalStore((state) => state.entries.find((entry) => entry.filmId === filmId) ?? null);
