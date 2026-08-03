import { describe, expect, it } from 'vitest';
import {
  assembleFeed,
  mixItems,
  reconcileSnapshot,
  type FeedAssemblyInput,
} from './feed.assembler';
import type { RecommendationCandidate } from './recommendation.engine';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film, FilmSummary } from '@entities/film/film.model';
import type { WatchlistEntry } from '@entities/watchlist/watchlist.model';
import { emptyAspects, type RatingValue } from '@domain/rating/rating.types';
import {
  emptyFeedbackState,
  emptyImpressionState,
  filmIdsOf,
  type FeedItem,
  type FeedSnapshot,
} from './feed.types';

const NOW = '2026-08-03T10:00:00.000Z';

const summary = (id: number, overrides: Partial<FilmSummary> = {}): FilmSummary => ({
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
  voteCount: 500,
  accent: { hex: '#000', rgb: '0, 0, 0' },
  ...overrides,
});

const film = (id: number, overrides: Partial<Film> = {}): Film =>
  ({
    ...summary(id),
    runtime: 100,
    director: '',
    cast: [],
    logoCandidates: [],
    tagline: '',
    countries: [],
    productionCompanies: [],
    originalLanguage: 'en',
    budget: 0,
    revenue: 0,
    detailed: true,
    ...overrides,
  }) as Film;

const entry = (filmId: number, score: number, overrides: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: `entry-${filmId}`,
  filmId,
  filmTitle: `Фильм ${filmId}`,
  posterPath: '/p.jpg',
  releaseYear: '2024',
  mode: 'quick',
  overallRating: Math.round(score) as RatingValue,
  preciseRating: score,
  aspects: emptyAspects(),
  hasText: false,
  text: null,
  watchedAt: '2026-07-10T12:00:00.000Z',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
  clientMutationId: `mut-${filmId}`,
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

const watchlistEntry = (id: number, daysAgo: number): WatchlistEntry => ({
  id,
  title: `Список ${id}`,
  year: '2023',
  posterPath: '/p.jpg',
  accent: { hex: '#000', rgb: '0, 0, 0' },
  addedAt: Date.parse(NOW) - daysAgo * 24 * 60 * 60 * 1000,
  pendingSync: false,
});

const candidate = (id: number, seedFilmId: number | null = 1): RecommendationCandidate => ({
  film: summary(id),
  source: 'recommendations',
  seedFilmId,
  sourceRank: 0,
});

const input = (overrides: Partial<FeedAssemblyInput> = {}): FeedAssemblyInput => ({
  entries: [],
  watchlist: [],
  films: new Map(),
  candidates: [],
  trending: [],
  previousSnapshot: null,
  feedback: emptyFeedbackState(),
  impressions: emptyImpressionState(),
  now: NOW,
  sourceRevision: 1,
  ...overrides,
});

const kinds = (snapshot: FeedSnapshot) => snapshot.items.map((item) => item.kind);

describe('a cold start is honest', () => {
  it('shows discovery and claims nothing personal', () => {
    const snapshot = assembleFeed(input({ trending: [summary(10), summary(11), summary(12)] }));

    expect(kinds(snapshot).every((kind) => kind === 'discoveryFallback')).toBe(true);
    for (const item of snapshot.items) {
      expect(item.reason?.code).toBe('trending');
      expect(item.reason?.sourceFilmIds).toEqual([]);
    }
  });

  it('invents no observations out of an empty diary', () => {
    const snapshot = assembleFeed(input({ trending: [summary(10)] }));
    expect(kinds(snapshot)).not.toContain('observation');
  });
});

describe('ids and determinism', () => {
  it('gives the same feed the same ids twice', () => {
    const context = input({
      candidates: [candidate(10), candidate(11)],
      entries: [entry(1, 5)],
      trending: [summary(20)],
    });
    expect(assembleFeed(context).items.map((item) => item.id)).toEqual(
      assembleFeed(context).items.map((item) => item.id),
    );
  });

  it('never shows one film twice in a snapshot', () => {
    const snapshot = assembleFeed(
      input({
        entries: [entry(1, 5)],
        candidates: [candidate(10), candidate(10, null)],
        trending: [summary(10), summary(11)],
      }),
    );

    const filmIds = snapshot.items.flatMap(filmIdsOf);
    const singles = snapshot.items
      .filter((item) => filmIdsOf(item).length === 1)
      .flatMap(filmIdsOf);
    expect(new Set(singles).size).toBe(singles.length);
    expect(filmIds).toContain(10);
  });

  it('does not recommend a film the user already rated', () => {
    const snapshot = assembleFeed(
      input({
        entries: [entry(1, 5), entry(10, 4)],
        candidates: [candidate(10), candidate(11)],
      }),
    );
    expect(snapshot.items.flatMap(filmIdsOf)).not.toContain(10);
  });
});

describe('mixing formats', () => {
  const observation = (code: string, index: number): FeedItem =>
    ({
      id: `observation:${code}:${index}`,
      kind: 'observation',
      observationCode: code,
      headline: 'Наблюдение',
      supportingText: null,
      evidence: { filmIds: [1], values: {}, sampleSize: 3, calculationVersion: 1 },
      confidence: 'medium',
      generatedAt: NOW,
      createdAt: NOW,
      sourceRevision: 1,
      rank: index,
      expiresAt: null,
      dismissedAt: null,
      reason: null,
    }) as FeedItem;

  const milestone = (value: number): FeedItem =>
    ({
      id: `milestone:ratings:${value}`,
      kind: 'milestone',
      milestoneCode: `ratings:${value}`,
      value,
      headline: `${value} фильмов`,
      supportingText: null,
      filmIds: [1],
      generatedAt: NOW,
      createdAt: NOW,
      sourceRevision: 1,
      rank: 0,
      expiresAt: null,
      dismissedAt: null,
      reason: null,
    }) as FeedItem;

  const recommendation = (id: number): FeedItem =>
    ({
      id: `rec:${id}`,
      kind: 'cinematicRecommendation',
      film: summary(id),
      reason: {
        code: 'trending',
        shortText: 'Сейчас часто смотрят',
        sourceFilmIds: [],
        sourcePersonIds: [],
        evidenceLabel: null,
      },
      seedFilmIds: [],
      generatedAt: NOW,
      createdAt: NOW,
      sourceRevision: 1,
      rank: 0,
      expiresAt: null,
      dismissedAt: null,
    }) as FeedItem;

  it('never puts two milestones side by side', () => {
    const mixed = mixItems(
      [milestone(10), milestone(25)],
      [recommendation(1), recommendation(2), recommendation(3)],
      6,
    );
    mixed.forEach((item, index) => {
      if (index === 0) return;
      expect(item.kind === 'milestone' && mixed[index - 1]!.kind === 'milestone').toBe(false);
    });
  });

  it('never repeats the same observation template back to back', () => {
    const mixed = mixItems(
      [observation('genreAffinity', 0), observation('genreAffinity', 1)],
      [recommendation(1), recommendation(2)],
      4,
    );
    mixed.forEach((item, index) => {
      const previous = mixed[index - 1];
      if (!previous || item.kind !== 'observation' || previous.kind !== 'observation') return;
      expect(item.observationCode).not.toBe(previous.observationCode);
    });
  });

  it('does not stack more than two recommendations while other formats wait', () => {
    const mixed = mixItems(
      [observation('genreAffinity', 0), milestone(10)],
      Array.from({ length: 6 }, (_, index) => recommendation(index + 1)),
      8,
    );

    // The rule holds *while there is something else to show* (§5.5). Once the
    // personal items are spent, a run of recommendations is simply the feed.
    const lastPersonal = mixed.reduce(
      (last, item, index) => (item.kind === 'cinematicRecommendation' ? last : index),
      -1,
    );
    let run = 0;
    mixed.slice(0, lastPersonal + 1).forEach((item) => {
      run = item.kind === 'cinematicRecommendation' ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(2);
    });
    // And the personal items are not all dumped at the end.
    expect(lastPersonal).toBeLessThan(mixed.length - 1);
  });

  it('produces several different formats once the data supports them', () => {
    const films = new Map(
      Array.from({ length: 8 }, (_, index) => [index + 1, film(index + 1, { genres: ['Драма'] })]),
    );
    const entries = [
      ...Array.from({ length: 5 }, (_, index) => entry(index + 1, 5)),
      ...Array.from({ length: 5 }, (_, index) => entry(index + 20, 3)),
    ];

    const snapshot = assembleFeed(
      input({
        entries,
        films,
        candidates: [candidate(50), candidate(51), candidate(52)],
        trending: [summary(60), summary(61)],
        watchlist: [watchlistEntry(70, 30)],
      }),
    );

    expect(new Set(kinds(snapshot)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('watchlist returns', () => {
  it('waits a week before bringing a film back', () => {
    const fresh = assembleFeed(input({ watchlist: [watchlistEntry(70, 2)] }));
    expect(kinds(fresh)).not.toContain('watchlistReturn');

    const aged = assembleFeed(input({ watchlist: [watchlistEntry(70, 20)] }));
    expect(kinds(aged)).toContain('watchlistReturn');
  });

  it('does not bring back a film that has since been rated', () => {
    const snapshot = assembleFeed(
      input({ watchlist: [watchlistEntry(70, 30)], entries: [entry(70, 4)] }),
    );
    expect(kinds(snapshot)).not.toContain('watchlistReturn');
  });

  it('respects the cooldown after it was shown', () => {
    const id = 'watchlist:return:70:2026-08';
    const snapshot = assembleFeed(
      input({
        watchlist: [watchlistEntry(70, 30)],
        impressions: {
          byItemId: new Map([
            [
              id,
              {
                itemId: id,
                firstShownAt: NOW,
                lastShownAt: NOW,
                showCount: 1,
                openedAt: null,
                action: null,
              },
            ],
          ]),
          shownMilestoneCodes: new Set(),
        },
      }),
    );
    expect(kinds(snapshot)).not.toContain('watchlistReturn');
  });

  it('never nags', () => {
    const snapshot = assembleFeed(input({ watchlist: [watchlistEntry(70, 30)] }));
    const item = snapshot.items.find((candidate) => candidate.kind === 'watchlistReturn')!;
    expect(item.reason?.shortText).toBe('Из твоего списка');
    expect(JSON.stringify(item)).not.toMatch(/до сих пор|пора уже/i);
  });
});

describe('feedback', () => {
  it('leaves out an item the user dismissed', () => {
    const first = assembleFeed(input({ trending: [summary(10), summary(11)] }));
    const dismissedId = first.items[0]!.id;

    const second = assembleFeed(
      input({
        trending: [summary(10), summary(11)],
        feedback: { ...emptyFeedbackState(), dismissedItemIds: new Set([dismissedId]) },
      }),
    );
    expect(second.items.map((item) => item.id)).not.toContain(dismissedId);
  });

  it('never suggests a film that was marked not interesting', () => {
    const snapshot = assembleFeed(
      input({
        entries: [entry(1, 5)],
        candidates: [candidate(10), candidate(11)],
        trending: [summary(10)],
        feedback: { ...emptyFeedbackState(), suppressedFilmIds: new Set([10]) },
      }),
    );
    expect(snapshot.items.flatMap(filmIdsOf)).not.toContain(10);
  });

  it('shows a milestone only once', () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry(index + 1, 4));
    const first = assembleFeed(input({ entries }));
    const codes = first.items
      .filter((item) => item.kind === 'milestone')
      .map((item) => (item.kind === 'milestone' ? item.milestoneCode : ''));
    expect(codes.length).toBeGreaterThan(0);

    const second = assembleFeed(
      input({
        entries,
        impressions: { byItemId: new Map(), shownMilestoneCodes: new Set(codes) },
      }),
    );
    expect(second.items.filter((item) => item.kind === 'milestone')).toHaveLength(0);
  });
});

describe('reconciliation', () => {
  const snapshotOf = (ids: string[]): FeedSnapshot => ({
    schemaVersion: 2,
    items: ids.map((id, index) => ({
      id,
      kind: 'discoveryFallback',
      film: summary(index + 1),
      source: 'trending',
      generatedAt: NOW,
      createdAt: NOW,
      sourceRevision: 1,
      rank: index,
      expiresAt: null,
      dismissedAt: null,
      reason: null,
    })) as FeedItem[],
    generatedAt: NOW,
    updatedAt: Date.parse(NOW),
    sourceRevision: 1,
    source: 'mixed',
  });

  it('keeps what is on screen and puts genuinely new items on top', () => {
    const previous = snapshotOf(['a', 'b', 'c']);
    const next = snapshotOf(['new', 'a', 'b', 'c']);

    const { snapshot, newItemIds } = reconcileSnapshot(previous, next);
    expect(newItemIds).toEqual(['new']);
    expect(snapshot.items.map((item) => item.id)).toEqual(['new', 'a', 'b', 'c']);
  });

  it('does not reorder items the user is already looking at', () => {
    const previous = snapshotOf(['a', 'b', 'c']);
    const next = snapshotOf(['c', 'b', 'a']);
    const { snapshot } = reconcileSnapshot(previous, next);
    expect(snapshot.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps history when the new assembly no longer produces it', () => {
    const previous = snapshotOf(['a', 'b']);
    const next = snapshotOf(['a']);
    const { snapshot } = reconcileSnapshot(previous, next);
    expect(snapshot.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('never resurrects a dismissed item', () => {
    const previous = snapshotOf(['a', 'b']);
    previous.items[1]!.dismissedAt = NOW;
    const next = snapshotOf(['a', 'b']);

    const { snapshot, newItemIds } = reconcileSnapshot(previous, next);
    expect(snapshot.items.map((item) => item.id)).toEqual(['a']);
    expect(newItemIds).not.toContain('b');
  });
});
