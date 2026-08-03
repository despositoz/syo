import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@shared/storage/db';
import {
  FEED_SNAPSHOT_KEY,
  FeedFeedbackRepository,
  FeedImpressionRepository,
  FeedPositionRepository,
  FeedSnapshotRepository,
} from './feed.repositories';
import type { FeedItem, FeedSnapshot } from '@domain/feed/feed.types';
import type { FilmSummary } from '@entities/film/film.model';

const film = (id: number): FilmSummary => ({
  id,
  title: `Фильм ${id}`,
  originalTitle: `Movie ${id}`,
  year: '2024',
  releaseDate: '2024-01-01',
  genres: [],
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  overview: '',
  rating: 7,
  voteCount: 100,
  accent: { hex: '#000', rgb: '0, 0, 0' },
});

const item = (id: string, filmId: number): FeedItem =>
  ({
    id,
    kind: 'discoveryFallback',
    film: film(filmId),
    source: 'trending',
    generatedAt: '2026-08-03T10:00:00.000Z',
    createdAt: '2026-08-03T10:00:00.000Z',
    sourceRevision: 1,
    rank: 0,
    expiresAt: null,
    dismissedAt: null,
    reason: null,
  }) as FeedItem;

const snapshot = (updatedAt: number, ids: string[]): FeedSnapshot => ({
  schemaVersion: 2,
  items: ids.map((id, index) => item(id, index + 1)),
  generatedAt: new Date(updatedAt).toISOString(),
  updatedAt,
  sourceRevision: 1,
  source: 'mixed',
});

beforeEach(async () => {
  await db.feed.clear();
  await db.feedFeedback.clear();
  await db.feedImpressions.clear();
  await db.feedPosition.clear();
});

describe('the snapshot survives everything it should', () => {
  it('round-trips through storage', async () => {
    const repository = new FeedSnapshotRepository();
    await repository.write(snapshot(1000, ['a', 'b']));

    const restored = await repository.read();
    expect(restored.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(restored.schemaVersion).toBe(2);
  });

  it('reads the pre-P0.4 cache as discovery items instead of showing nothing', async () => {
    // Exactly what P0.1–P0.3 wrote: a bare array of films.
    await db.feed.put({ key: FEED_SNAPSHOT_KEY, items: [film(10), film(11)], cachedAt: 5000 });

    const restored = await new FeedSnapshotRepository().read();
    expect(restored.items).toHaveLength(2);
    expect(restored.items.every((entry) => entry.kind === 'discoveryFallback')).toBe(true);
    // Migrated items make no personal claim.
    expect(restored.items.every((entry) => entry.reason === null)).toBe(true);
  });

  it('leaves the legacy array in place when it writes the new shape', async () => {
    await db.feed.put({ key: FEED_SNAPSHOT_KEY, items: [film(10)], cachedAt: 5000 });
    await new FeedSnapshotRepository().write(snapshot(9000, ['a']));

    const row = await db.feed.get(FEED_SNAPSHOT_KEY);
    expect(row?.items).toHaveLength(1);
    expect(row?.snapshot).toBeTruthy();
  });

  it('drops a single unreadable item rather than the whole feed', async () => {
    const stored = snapshot(1000, ['a']);
    const broken = { ...stored, items: [...stored.items, { id: 'bad', kind: 'nonsense' }] };
    await db.feed.put({ key: FEED_SNAPSHOT_KEY, snapshot: broken, cachedAt: 1000 });

    const restored = await new FeedSnapshotRepository().read();
    expect(restored.items.map((entry) => entry.id)).toEqual(['a']);
  });

  it('refuses to let a late refresh bury a newer one', async () => {
    const repository = new FeedSnapshotRepository();
    await repository.write(snapshot(9000, ['new']));

    const accepted = await repository.write(snapshot(1000, ['old']));

    expect(accepted).toBe(false);
    expect((await repository.read()).items.map((entry) => entry.id)).toEqual(['new']);
  });

  it('opens empty rather than throwing when nothing was ever written', async () => {
    expect((await new FeedSnapshotRepository().read()).items).toEqual([]);
  });
});

describe('feedback', () => {
  it('hides a dismissed item and gives it back on undo', async () => {
    const repository = new FeedFeedbackRepository();
    const feedback = await repository.add({
      itemId: 'item-1',
      filmId: 10,
      observationCode: null,
      action: 'dismiss',
      contextId: null,
      expiresAt: null,
    });

    expect((await repository.state()).dismissedItemIds.has('item-1')).toBe(true);

    await repository.remove(feedback.id);
    expect((await repository.state()).dismissedItemIds.has('item-1')).toBe(false);
  });

  it('remembers a film the user is not interested in, beyond this snapshot', async () => {
    const repository = new FeedFeedbackRepository();
    await repository.add({
      itemId: 'item-1',
      filmId: 42,
      observationCode: null,
      action: 'notInterested',
      contextId: null,
      expiresAt: null,
    });

    expect(await repository.isSuppressed(42)).toBe(true);
  });

  it('lets an expired opinion lapse', async () => {
    const repository = new FeedFeedbackRepository();
    await repository.add({
      itemId: 'item-1',
      filmId: 42,
      observationCode: null,
      action: 'notInterested',
      contextId: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(await repository.isSuppressed(42)).toBe(false);
  });

  it('survives a reload', async () => {
    await new FeedFeedbackRepository().add({
      itemId: 'item-1',
      filmId: 42,
      observationCode: null,
      action: 'notInterested',
      contextId: null,
      expiresAt: null,
    });

    // A different instance is what a reload looks like from here.
    expect(await new FeedFeedbackRepository().isSuppressed(42)).toBe(true);
  });
});

describe('impressions', () => {
  it('counts how often an item was actually seen', async () => {
    const repository = new FeedImpressionRepository();
    await repository.markShown(['item-1']);
    await repository.markShown(['item-1']);

    const state = await repository.state();
    expect(state.byItemId.get('item-1')?.showCount).toBe(2);
  });

  it('remembers that a milestone has happened', async () => {
    const repository = new FeedImpressionRepository();
    await repository.markShown(['milestone:ratings:25']);

    expect((await repository.state()).shownMilestoneCodes.has('ratings:25')).toBe(true);
  });

  it('records an open without losing the first-seen time', async () => {
    const repository = new FeedImpressionRepository();
    await repository.markShown(['item-1']);
    const first = (await repository.state()).byItemId.get('item-1')!.firstShownAt;

    await repository.markOpened('item-1');
    const after = (await repository.state()).byItemId.get('item-1')!;

    expect(after.firstShownAt).toBe(first);
    expect(after.openedAt).not.toBeNull();
  });
});

describe('position', () => {
  it('saves an anchor and its offset', async () => {
    const repository = new FeedPositionRepository();
    await repository.save({ anchorItemId: 'item-7', anchorOffset: -120, scrollTopFallback: 2400 });

    const restored = await repository.restore();
    expect(restored).toMatchObject({
      anchorItemId: 'item-7',
      anchorOffset: -120,
      scrollTopFallback: 2400,
    });
  });

  it('forgets a position from another day', async () => {
    await db.feedPosition.put({
      key: 'feed:root',
      anchorItemId: 'item-7',
      anchorOffset: 0,
      scrollTopFallback: 100,
      updatedAt: Date.now() - 48 * 60 * 60 * 1000,
    });

    expect(await new FeedPositionRepository().restore()).toBeNull();
  });

  it('returns nothing rather than a made-up coordinate', async () => {
    expect(await new FeedPositionRepository().restore()).toBeNull();
  });
});

describe('the migration leaves the rest of the app alone', () => {
  it('keeps journal, drafts and watchlist untouched', async () => {
    await db.watchlist.put({
      id: 1,
      title: 'Старый фильм',
      year: '2020',
      posterPath: '/p.jpg',
      accent: { hex: '#000', rgb: '0, 0, 0' },
      addedAt: 1,
      pendingSync: false,
    });
    await db.feed.put({ key: FEED_SNAPSHOT_KEY, items: [film(10)], cachedAt: 1 });

    await db.close();
    await db.open();

    expect(await db.watchlist.get(1)).toMatchObject({ title: 'Старый фильм' });
    expect((await new FeedSnapshotRepository().read()).items).toHaveLength(1);
    // The new stores exist alongside the old ones.
    expect(db.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['feedFeedback', 'feedImpressions', 'feedPosition', 'diaryEntries']),
    );
  });
});
