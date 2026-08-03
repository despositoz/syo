import { db, safeRead, safeWrite, strictWrite } from '@shared/storage/db';
import { createId } from '@domain/rating/rating.validation';
import { parseFeedSnapshot, parseLegacyFeedCache } from '@domain/feed/feed.schema';
import {
  emptyFeedbackState,
  emptyImpressionState,
  emptySnapshot,
  POSITION_MAX_AGE_MS,
  type FeedFeedback,
  type FeedFeedbackAction,
  type FeedFeedbackState,
  type FeedImpressionState,
  type FeedPosition,
  type FeedSnapshot,
} from '@domain/feed/feed.types';

/**
 * Local storage for the feed (P0.4 §15, §33).
 *
 * Everything the feed needs to paint is here: the snapshot itself, what the
 * user has said about items, what they have already seen, and where they were
 * when they left. Reads never throw — a feed that will not open because one
 * row is malformed is worse than a shorter feed.
 */

export const FEED_SNAPSHOT_KEY = 'trending-day';
export const FEED_POSITION_KEY = 'feed:root';

/* --- snapshot ------------------------------------------------------------ */

export class FeedSnapshotRepository {
  /**
   * Reads the current snapshot, falling back to the pre-P0.4 cache shape.
   * The legacy rows become discovery items rather than being discarded.
   */
  async read(key = FEED_SNAPSHOT_KEY): Promise<FeedSnapshot> {
    const row = await safeRead(() => db.feed.get(key), undefined);
    if (!row) return emptySnapshot();

    const snapshot = parseFeedSnapshot(row.snapshot);
    if (snapshot) return snapshot;

    return parseLegacyFeedCache(row, row.cachedAt);
  }

  /**
   * Writes a snapshot, refusing to overwrite a newer one.
   *
   * Two refreshes can land out of order — a slow one that started earlier
   * must not bury the fast one that already reached the screen (§39.63).
   */
  async write(snapshot: FeedSnapshot, key = FEED_SNAPSHOT_KEY): Promise<boolean> {
    return strictWrite(async () =>
      db.transaction('rw', db.feed, async () => {
        const existing = await db.feed.get(key);
        const current = existing ? parseFeedSnapshot(existing.snapshot) : null;
        if (current && current.updatedAt > snapshot.updatedAt) return false;

        await db.feed.put({
          key,
          // The legacy array is left in place: an older build reading this row
          // still finds the shape it expects.
          ...(existing?.items ? { items: existing.items } : {}),
          snapshot,
          cachedAt: snapshot.updatedAt,
        });
        return true;
      }),
    );
  }
}

/* --- feedback ------------------------------------------------------------ */

export class FeedFeedbackRepository {
  async list(): Promise<FeedFeedback[]> {
    const rows = await safeRead(() => db.feedFeedback.toArray(), []);
    const now = Date.now();
    return rows
      .filter((row) => !row.expiresAt || Date.parse(row.expiresAt) > now)
      .map((row) => ({ ...row, action: row.action as FeedFeedbackAction }));
  }

  /** The shape the assembler consumes. */
  async state(): Promise<FeedFeedbackState> {
    const feedback = await this.list();
    const state = emptyFeedbackState();

    for (const item of feedback) {
      switch (item.action) {
        case 'dismiss':
        case 'notInterested':
          state.dismissedItemIds.add(item.itemId);
          // "Not interested" is about the film, and it outlives this snapshot.
          if (item.action === 'notInterested' && item.filmId !== null) {
            state.suppressedFilmIds.add(item.filmId);
          }
          if (item.observationCode) state.dismissedObservationIds.add(item.itemId);
          break;
        case 'suppressSimilar':
          if (item.contextId) state.suppressedContextIds.add(item.contextId);
          break;
        default:
          break;
      }
    }

    return state;
  }

  async add(feedback: Omit<FeedFeedback, 'id' | 'createdAt'>): Promise<FeedFeedback> {
    const row: FeedFeedback = { ...feedback, id: createId(), createdAt: new Date().toISOString() };
    await strictWrite(() => db.feedFeedback.put(row));
    return row;
  }

  /** Undo: the feedback is removed, so the item comes back where it was. */
  async remove(id: string): Promise<void> {
    await strictWrite(() => db.feedFeedback.delete(id));
  }

  async isSuppressed(filmId: number): Promise<boolean> {
    const state = await this.state();
    return state.suppressedFilmIds.has(filmId);
  }
}

/* --- impressions --------------------------------------------------------- */

export class FeedImpressionRepository {
  async state(): Promise<FeedImpressionState> {
    const rows = await safeRead(() => db.feedImpressions.toArray(), []);
    const state = emptyImpressionState();

    for (const row of rows) {
      state.byItemId.set(row.itemId, row);
      // A milestone that has been on screen has happened (§11.3).
      if (row.itemId.startsWith('milestone:')) {
        state.shownMilestoneCodes.add(row.itemId.replace(/^milestone:/, ''));
      }
    }

    return state;
  }

  async markShown(itemIds: string[]): Promise<void> {
    if (!itemIds.length) return;
    const now = new Date().toISOString();

    await safeWrite(() =>
      db.transaction('rw', db.feedImpressions, async () => {
        for (const itemId of itemIds) {
          const existing = await db.feedImpressions.get(itemId);
          await db.feedImpressions.put({
            itemId,
            firstShownAt: existing?.firstShownAt ?? now,
            lastShownAt: now,
            showCount: (existing?.showCount ?? 0) + 1,
            openedAt: existing?.openedAt ?? null,
            action: existing?.action ?? null,
          });
        }
      }),
    );
  }

  async markOpened(itemId: string): Promise<void> {
    const now = new Date().toISOString();
    await safeWrite(() =>
      db.transaction('rw', db.feedImpressions, async () => {
        const existing = await db.feedImpressions.get(itemId);
        await db.feedImpressions.put({
          itemId,
          firstShownAt: existing?.firstShownAt ?? now,
          lastShownAt: existing?.lastShownAt ?? now,
          showCount: existing?.showCount ?? 1,
          openedAt: now,
          action: 'opened',
        });
      }),
    );
  }
}

/* --- position ------------------------------------------------------------ */

export class FeedPositionRepository {
  async save(position: Omit<FeedPosition, 'key' | 'updatedAt'>): Promise<void> {
    await safeWrite(() =>
      db.feedPosition.put({
        key: FEED_POSITION_KEY,
        anchorItemId: position.anchorItemId,
        anchorOffset: position.anchorOffset,
        scrollTopFallback: position.scrollTopFallback,
        updatedAt: Date.now(),
      }),
    );
  }

  /** A position older than the session window is a guess, not a memory (§22.6). */
  async restore(): Promise<FeedPosition | null> {
    const row = await safeRead(() => db.feedPosition.get(FEED_POSITION_KEY), undefined);
    if (!row) return null;
    if (Date.now() - row.updatedAt > POSITION_MAX_AGE_MS) return null;
    return row;
  }

  async clear(): Promise<void> {
    await safeWrite(() => db.feedPosition.delete(FEED_POSITION_KEY));
  }
}

export const feedSnapshotRepository = new FeedSnapshotRepository();
export const feedFeedbackRepository = new FeedFeedbackRepository();
export const feedImpressionRepository = new FeedImpressionRepository();
export const feedPositionRepository = new FeedPositionRepository();
