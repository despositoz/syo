import { create } from 'zustand';
import type { FilmSummary } from '@entities/film/film.model';
import type { WatchlistRepository } from './watchlist.repository';
import { watchlistRepository } from './watchlist.repository';
import {
  WATCHLIST_ADDED_MESSAGE,
  WATCHLIST_REMOVED_MESSAGE,
  type WatchlistEntry,
} from './watchlist.model';

export interface WatchlistToggleResult {
  inWatchlist: boolean;
  message: string;
}

interface WatchlistState {
  entries: Record<number, WatchlistEntry>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /**
   * The single semantic action behind both projections (hero button and
   * toolbar bookmark). Optimistic: state flips before storage resolves.
   */
  toggle: (film: FilmSummary) => Promise<WatchlistToggleResult>;
}

let repository: WatchlistRepository = watchlistRepository;

/** Test seam. */
export const setWatchlistRepository = (next: WatchlistRepository): void => {
  repository = next;
};

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  entries: {},
  hydrated: false,

  hydrate: async () => {
    const all = await repository.all();
    set({
      entries: Object.fromEntries(all.map((entry) => [entry.id, entry])),
      hydrated: true,
    });
  },

  toggle: async (film) => {
    const current = get().entries;
    const exists = Boolean(current[film.id]);

    // Optimistic UI first — storage and sync follow.
    if (exists) {
      const next = { ...current };
      delete next[film.id];
      set({ entries: next });
    } else {
      set({
        entries: {
          ...current,
          [film.id]: {
            id: film.id,
            title: film.title,
            year: film.year,
            posterPath: film.posterPath,
            accent: film.accent,
            addedAt: Date.now(),
            pendingSync: true,
          },
        },
      });
    }

    if (exists) await repository.remove(film.id);
    else await repository.add(film);

    return {
      inWatchlist: !exists,
      message: exists ? WATCHLIST_REMOVED_MESSAGE : WATCHLIST_ADDED_MESSAGE,
    };
  },
}));

export const useIsInWatchlist = (filmId: number): boolean =>
  useWatchlistStore((state) => Boolean(state.entries[filmId]));

export const useWatchlistCount = (): number =>
  useWatchlistStore((state) => Object.keys(state.entries).length);
