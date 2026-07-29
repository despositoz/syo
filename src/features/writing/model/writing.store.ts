import { create } from 'zustand';
import {
  addRevision,
  createWritingDraft,
  rememberSelection,
  setScreen,
  setWorkingText,
  setWritingMode,
  type AddRevisionOptions,
  type CreateWritingDraftOptions,
} from '@domain/writing/writing.machine';
import {
  isWritingDraft,
  type WritingDraft,
  type WritingMode,
  type WritingScreen,
} from '@domain/writing/writing.types';
import { StorageError } from '@shared/storage/db';
import {
  activeDraftRepository,
  type ActiveDraftRepository,
} from '@features/drafts/activeDraft.repository';

/**
 * The single active writing draft (spec §7).
 *
 * Same contract as the rating store — it owns the in-memory copy and persists
 * every commit — with one difference: typing is not committed per keystroke.
 * A write per character would hammer IndexedDB, so text is debounced, and every
 * exit path (screen change, blur, pagehide, navigation) flushes first.
 */

/** Long enough to batch a burst of typing, short enough to survive a crash. */
export const TEXT_AUTOSAVE_MS = 800;

export interface WritingState {
  draft: WritingDraft | null;
  hydrated: boolean;
  storageError: StorageError | null;
  /** True while typed text exists only in memory. */
  dirty: boolean;

  hydrate: () => Promise<void>;
  start: (options: CreateWritingDraftOptions) => Promise<WritingDraft>;
  chooseMode: (mode: WritingMode) => Promise<void>;
  goToScreen: (screen: WritingScreen) => Promise<void>;
  /** Debounced: the text is in memory at once, on disk shortly after. */
  setText: (text: string) => void;
  rememberCursor: (selection: { start: number; end: number; scrollTop?: number }) => void;
  addRevision: (options: AddRevisionOptions) => Promise<void>;
  /** Applies an arbitrary machine transition and persists it. */
  apply: (transition: (draft: WritingDraft) => WritingDraft) => Promise<void>;
  discard: () => Promise<void>;
  /** Writes anything pending right now. Safe to call when nothing is pending. */
  flush: () => Promise<void>;
  retrySave: () => Promise<void>;
  clearStorageError: () => void;
}

let repository: ActiveDraftRepository = activeDraftRepository;

/** Test seam. */
export const setWritingDraftRepository = (next: ActiveDraftRepository): void => {
  repository = next;
};

export const useWritingStore = create<WritingState>((set, get) => {
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const cancelDebounce = (): void => {
    if (debounce === null) return;
    clearTimeout(debounce);
    debounce = null;
  };

  /**
   * Persists and rethrows on failure, exactly like the rating store: telling a
   * caller the text is safe when the write failed is how a review disappears.
   */
  const commit = async (next: WritingDraft): Promise<void> => {
    cancelDebounce();
    set({ draft: next, dirty: false });
    try {
      await repository.saveActive(next);
      if (get().storageError) set({ storageError: null });
    } catch (error) {
      const failure = error instanceof StorageError ? error : new StorageError('unknown', error);
      set({ storageError: failure, dirty: true });
      throw failure;
    }
  };

  return {
    draft: null,
    hydrated: false,
    storageError: null,
    dirty: false,

    hydrate: async () => {
      const stored = await repository.getActive().catch(() => null);
      // A rating draft belongs to the rating store; this one only owns writing.
      set({ draft: isWritingDraft(stored) ? stored : null, hydrated: true, dirty: false });
    },

    start: async (options) => {
      const draft = createWritingDraft(options);
      await commit(draft);
      return draft;
    },

    chooseMode: async (mode) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setWritingMode(draft, mode));
    },

    goToScreen: async (screen) => {
      const draft = get().draft;
      if (!draft) return;
      await commit(setScreen(draft, screen));
    },

    setText: (text) => {
      const draft = get().draft;
      if (!draft) return;
      const next = setWorkingText(draft, text);
      set({ draft: next, dirty: true });

      cancelDebounce();
      debounce = setTimeout(() => {
        debounce = null;
        const latest = get().draft;
        if (!latest) return;
        void commit(latest).catch(() => undefined);
      }, TEXT_AUTOSAVE_MS);
    },

    // Cursor and scroll are recovery comfort, not content: they ride along with
    // the next write instead of causing one.
    rememberCursor: (selection) => {
      const draft = get().draft;
      if (!draft) return;
      set({ draft: rememberSelection(draft, selection) });
    },

    addRevision: async (options) => {
      const draft = get().draft;
      if (!draft) return;
      const { draft: next, revision } = addRevision(draft, options);
      if (!revision) return; // nothing changed — no revision, no write
      await commit(next);
    },

    apply: async (transition) => {
      const draft = get().draft;
      if (!draft) return;
      const next = transition(draft);
      if (next === draft) return;
      await commit(next);
    },

    /** Clears storage first: a failed delete must not resurrect the text. */
    discard: async () => {
      cancelDebounce();
      try {
        await repository.deleteActive();
      } catch (error) {
        const failure = error instanceof StorageError ? error : new StorageError('unknown', error);
        set({ storageError: failure });
        throw failure;
      }
      set({ draft: null, storageError: null, dirty: false });
    },

    flush: async () => {
      const draft = get().draft;
      if (draft && (get().dirty || debounce !== null)) {
        await commit(draft).catch(() => undefined);
      }
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
