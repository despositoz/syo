import { create } from 'zustand';
import { db, safeRead } from '@shared/storage/db';
import { parseCachedFilm } from '@entities/film/film.schema';
import type { Film } from '@entities/film/film.model';
import { assembleFeed, reconcileSnapshot } from '@domain/feed/feed.assembler';
import { chooseSeeds } from '@domain/feed/recommendation.engine';
import {
  emptyFeedbackState,
  emptyImpressionState,
  emptySnapshot,
  type FeedItem,
  type FeedPosition,
  type FeedSnapshot,
} from '@domain/feed/feed.types';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { feedRepository } from '@entities/feed/feed.repository';
import { candidatesRepository } from '../repositories/candidates.repository';
import {
  feedFeedbackRepository,
  feedImpressionRepository,
  feedPositionRepository,
  feedSnapshotRepository,
} from '../repositories/feed.repositories';

/**
 * The feed controller (P0.4 §33, §34).
 *
 * Cache first: whatever was on screen last time paints immediately, local
 * observations are recomputed from the diary without any network, and remote
 * candidates arrive in the background and reconcile in place. A refresh never
 * clears the screen, and nothing here runs per scroll frame.
 */

export type FeedErrorKind = 'network' | 'storage' | 'none';

export interface FeedState {
  snapshot: FeedSnapshot;
  hydrated: boolean;
  refreshing: boolean;
  refreshError: FeedErrorKind;
  /** Items that appeared above what the user is looking at. */
  newItemIds: string[];
  position: FeedPosition | null;
  expandedObservationId: string | null;
  /**
   * Cached films by id, for the posters an observation or a milestone shows as
   * its evidence. Gathered with the assembly input so the cards never read
   * storage themselves.
   */
  films: Map<number, Film>;

  hydrate: () => Promise<void>;
  /** Rebuilds from local data only — no network, works offline. */
  rebuildLocal: () => Promise<void>;
  refresh: (options?: { manual?: boolean }) => Promise<'new' | 'unchanged' | 'failed'>;
  dismissItem: (
    item: FeedItem,
    action: 'dismiss' | 'notInterested',
  ) => Promise<() => Promise<void>>;
  markShown: (itemIds: string[]) => void;
  markOpened: (itemId: string) => Promise<void>;
  savePosition: (position: Omit<FeedPosition, 'key' | 'updatedAt'>) => Promise<void>;
  clearNewItems: () => void;
  toggleObservation: (itemId: string | null) => void;
}

/** Cached films, for genres, directors and cast. */
const readCachedFilms = async (): Promise<Map<number, Film>> => {
  const rows = await safeRead(() => db.films.toArray(), []);
  const films = new Map<number, Film>();
  for (const row of rows) {
    const film = parseCachedFilm(row.film);
    if (film) films.set(film.id, film);
  }
  return films;
};

/** One assembly input, gathered once, outside React (§14.2). */
const gather = async () => {
  const [films, feedback, impressions] = await Promise.all([
    readCachedFilms(),
    feedFeedbackRepository.state(),
    feedImpressionRepository.state(),
  ]);

  const entries = useDiaryStore.getState().entries;
  const watchlist = Object.values(useWatchlistStore.getState().entries);

  return {
    entries,
    watchlist,
    films,
    feedback,
    impressions,
    // The diary's own revision: observations are recomputed when it moves.
    sourceRevision: entries.reduce((sum, entry) => sum + entry.revision, 0),
  };
};

export const useFeedStore = create<FeedState>((set, get) => ({
  snapshot: emptySnapshot(),
  hydrated: false,
  refreshing: false,
  refreshError: 'none',
  newItemIds: [],
  position: null,
  expandedObservationId: null,
  films: new Map(),

  hydrate: async () => {
    const [snapshot, position] = await Promise.all([
      feedSnapshotRepository.read(),
      feedPositionRepository.restore(),
    ]);
    set({ snapshot, position, hydrated: true });
    // Local rebuild follows immediately: observations must reflect the diary
    // as it is now, not as it was when the snapshot was written.
    await get().rebuildLocal();
  },

  rebuildLocal: async () => {
    const input = await gather();
    const previous = get().snapshot;

    const assembled = assembleFeed({
      ...input,
      candidates: [],
      trending: previous.items
        .filter((item) => item.kind === 'discoveryFallback')
        .map((item) => (item.kind === 'discoveryFallback' ? item.film : null))
        .filter((film): film is NonNullable<typeof film> => film !== null),
      previousSnapshot: previous,
      now: new Date().toISOString(),
    });

    const { snapshot, newItemIds } = reconcileSnapshot(previous, assembled);
    set({ snapshot, newItemIds: [...get().newItemIds, ...newItemIds], films: input.films });
    await feedSnapshotRepository.write(snapshot);
  },

  refresh: async (options = {}) => {
    if (get().refreshing) return 'unchanged';
    set({ refreshing: true, refreshError: 'none' });

    try {
      const input = await gather();
      const seeds = chooseSeeds(input.entries, input.films);

      const [trending, candidates] = await Promise.all([
        feedRepository.fetchTrending().then(
          (result) => result.items.map((item) => item.film),
          () => [],
        ),
        seeds.length
          ? candidatesRepository.fetchCandidates({
              seedFilmIds: seeds.map((seed) => seed.filmId),
            })
          : Promise.resolve([]),
      ]);

      if (!trending.length && !candidates.length) {
        set({ refreshing: false, refreshError: options.manual ? 'network' : 'none' });
        return 'failed';
      }

      const previous = get().snapshot;
      const assembled = assembleFeed({
        ...input,
        candidates,
        trending,
        previousSnapshot: previous,
        now: new Date().toISOString(),
      });

      const { snapshot, newItemIds } = reconcileSnapshot(previous, assembled);
      set({
        snapshot,
        newItemIds: [...get().newItemIds, ...newItemIds],
        refreshing: false,
        refreshError: 'none',
      });
      await feedSnapshotRepository.write(snapshot);

      return newItemIds.length ? 'new' : 'unchanged';
    } catch {
      // The feed that is already on screen stays exactly as it is (§25.4).
      set({ refreshing: false, refreshError: 'network' });
      return 'failed';
    }
  },

  /**
   * Hides an item and hands back the undo. The feedback row is written first:
   * hiding something locally and then failing to remember it means it comes
   * back on the next refresh, which is worse than not hiding it at all.
   */
  dismissItem: async (item, action) => {
    const feedback = await feedFeedbackRepository.add({
      itemId: item.id,
      filmId:
        item.kind === 'cinematicRecommendation' ||
        item.kind === 'discoveryFallback' ||
        item.kind === 'watchlistReturn'
          ? item.film.id
          : null,
      observationCode: item.kind === 'observation' ? item.observationCode : null,
      action,
      contextId: null,
      expiresAt: null,
    });

    const previous = get().snapshot;
    const snapshot: FeedSnapshot = {
      ...previous,
      items: previous.items.map((entry) =>
        entry.id === item.id ? { ...entry, dismissedAt: new Date().toISOString() } : entry,
      ),
    };
    set({ snapshot });
    await feedSnapshotRepository.write(snapshot);

    return async () => {
      await feedFeedbackRepository.remove(feedback.id);
      const current = get().snapshot;
      const restored: FeedSnapshot = {
        ...current,
        // Restored exactly where it was: the item never left the list, it was
        // only marked (§16.1).
        items: current.items.map((entry) =>
          entry.id === item.id ? { ...entry, dismissedAt: null } : entry,
        ),
      };
      set({ snapshot: restored });
      await feedSnapshotRepository.write(restored);
    };
  },

  markShown: (itemIds) => {
    void feedImpressionRepository.markShown(itemIds);
  },

  markOpened: async (itemId) => {
    await feedImpressionRepository.markOpened(itemId);
  },

  savePosition: async (position) => {
    set({ position: { ...position, key: 'feed:root', updatedAt: Date.now() } });
    await feedPositionRepository.save(position);
  },

  clearNewItems: () => set({ newItemIds: [] }),

  toggleObservation: (itemId) =>
    set((state) => ({
      expandedObservationId: state.expandedObservationId === itemId ? null : itemId,
    })),
}));

/** What the page renders: the snapshot minus anything dismissed. */
export const visibleItems = (snapshot: FeedSnapshot): FeedItem[] =>
  snapshot.items.filter((item) => item.dismissedAt === null);

/** Test seam for a clean store between cases. */
export const resetFeedStore = (): void => {
  useFeedStore.setState({
    snapshot: emptySnapshot(),
    hydrated: false,
    refreshing: false,
    refreshError: 'none',
    newItemIds: [],
    position: null,
    expandedObservationId: null,
  });
};

export { emptyFeedbackState, emptyImpressionState };
