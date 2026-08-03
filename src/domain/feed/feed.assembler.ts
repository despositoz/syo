import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film, FilmSummary } from '@entities/film/film.model';
import type { WatchlistEntry } from '@entities/watchlist/watchlist.model';
import { deriveMilestones, deriveObservations } from './insight.engine';
import { chooseSeeds, rankCandidates, type RecommendationCandidate } from './recommendation.engine';
import { fallbackId, recommendationId, watchlistReturnId } from './feed.ids';
import { OBSERVATION_COOLDOWN_ITEMS } from './insight.thresholds';
import {
  filmIdsOf,
  type FeedFeedbackState,
  type FeedImpressionState,
  type FeedItem,
  type FeedSnapshot,
  type WatchlistReturnItem,
} from './feed.types';

/**
 * Turns local data and remote candidates into one ordered feed (P0.4 §14).
 *
 * Pure and deterministic. It runs outside React, and the same inputs always
 * produce the same output — that is what lets a refresh reconcile in place
 * instead of reshuffling the screen under the user's thumb.
 */

export interface FeedAssemblyInput {
  entries: DiaryEntry[];
  watchlist: WatchlistEntry[];
  films: Map<number, Film>;
  candidates: RecommendationCandidate[];
  trending: FilmSummary[];
  previousSnapshot: FeedSnapshot | null;
  feedback: FeedFeedbackState;
  impressions: FeedImpressionState;
  now: string;
  sourceRevision: number;
  /** Initial batch size (§14.3). */
  limit?: number;
}

export const INITIAL_BATCH = 20;

/** A watchlist film waits this long before the feed brings it up (§12.1). */
const WATCHLIST_AGE_DAYS = 7;
const WATCHLIST_COOLDOWN_DAYS = 14;

const daysBetween = (fromIso: string | number, toIso: string): number =>
  (Date.parse(toIso) - (typeof fromIso === 'number' ? fromIso : Date.parse(fromIso))) /
  (24 * 60 * 60 * 1000);

const base = (id: string, input: FeedAssemblyInput, rank: number) => ({
  id,
  generatedAt: input.now,
  createdAt: input.now,
  sourceRevision: input.sourceRevision,
  rank,
  expiresAt: null,
  dismissedAt: null,
});

/* --- parts --------------------------------------------------------------- */

const buildRecommendations = (input: FeedAssemblyInput): FeedItem[] => {
  const seeds = chooseSeeds(input.entries, input.films);
  const ratedFilmIds = new Set(input.entries.map((entry) => entry.filmId));
  const watchlistFilmIds = new Set(input.watchlist.map((item) => item.id));

  // Genres the user rates above their own average — the only genre claim the
  // recommendation reasons are allowed to make.
  const favouredGenres = new Set(
    deriveObservations({
      entries: input.entries,
      films: input.films,
      now: input.now,
      sourceRevision: input.sourceRevision,
    })
      .filter((observation) => observation.observationCode === 'genreAffinity')
      .map((observation) => String(observation.evidence.values.genre)),
  );

  return rankCandidates({
    candidates: input.candidates,
    seeds,
    films: input.films,
    ratedFilmIds,
    suppressedFilmIds: input.feedback.suppressedFilmIds,
    watchlistFilmIds,
    favouredGenres,
    limit: 12,
  }).map((ranked, index) => ({
    ...base(
      recommendationId(ranked.candidate.film.id, ranked.candidate.seedFilmId ?? 0),
      input,
      index,
    ),
    kind: 'cinematicRecommendation' as const,
    film: ranked.candidate.film,
    reason: ranked.reason,
    seedFilmIds: ranked.candidate.seedFilmId === null ? [] : [ranked.candidate.seedFilmId],
  }));
};

/**
 * Films saved for later that have waited long enough, and have not been
 * brought up recently (§12.1). No countdown, no nagging.
 */
const buildWatchlistReturns = (input: FeedAssemblyInput): WatchlistReturnItem[] => {
  const ratedFilmIds = new Set(input.entries.map((entry) => entry.filmId));

  return input.watchlist
    .filter((item) => !ratedFilmIds.has(item.id))
    .filter((item) => daysBetween(item.addedAt, input.now) >= WATCHLIST_AGE_DAYS)
    .filter((item) => {
      const id = watchlistReturnId(item.id, input.now);
      const impression = input.impressions.byItemId.get(id);
      if (!impression) return true;
      return daysBetween(impression.lastShownAt, input.now) >= WATCHLIST_COOLDOWN_DAYS;
    })
    .sort((left, right) => left.addedAt - right.addedAt)
    .slice(0, 2)
    .map((item, index) => ({
      ...base(watchlistReturnId(item.id, input.now), input, index),
      kind: 'watchlistReturn' as const,
      film: {
        id: item.id,
        title: item.title,
        originalTitle: item.title,
        year: item.year,
        releaseDate: '',
        genres: [],
        posterPath: item.posterPath,
        backdropPath: '',
        overview: '',
        rating: 0,
        voteCount: 0,
        accent: item.accent,
      },
      addedAt: new Date(item.addedAt).toISOString(),
      returnReason: 'aged' as const,
      reason: {
        code: 'watchlist' as const,
        shortText: 'Из твоего списка',
        sourceFilmIds: [],
        sourcePersonIds: [],
        evidenceLabel: 'Ты добавил его некоторое время назад',
      },
    }));
};

const buildFallback = (input: FeedAssemblyInput, exclude: Set<number>): FeedItem[] =>
  input.trending
    .filter((film) => !exclude.has(film.id))
    .filter((film) => !input.feedback.suppressedFilmIds.has(film.id))
    .slice(0, 12)
    .map((film, index) => ({
      ...base(fallbackId('trending', film.id, input.now), input, index),
      kind: 'discoveryFallback' as const,
      film,
      source: 'trending' as const,
      // Impersonal by design: it is a fact about the week, not about the user.
      reason: {
        code: 'trending' as const,
        shortText: 'Сейчас часто смотрят',
        sourceFilmIds: [],
        sourcePersonIds: [],
        evidenceLabel: null,
      },
    }));

/* --- mixing -------------------------------------------------------------- */

const isRecommendationLike = (item: FeedItem): boolean =>
  item.kind === 'cinematicRecommendation' || item.kind === 'discoveryFallback';

/**
 * Interleaves the formats so the feed never reads as a list of identical rows
 * (§5.5). The rules are hard limits, not preferences: two milestones in a row
 * or three recommendations in a row is what a template looks like.
 */
export const mixItems = (
  personal: FeedItem[],
  recommendations: FeedItem[],
  limit: number,
): FeedItem[] => {
  const result: FeedItem[] = [];
  const queues = { personal: [...personal], recommendations: [...recommendations] };
  let recommendationRun = 0;

  const lastOf = () => result[result.length - 1];
  const canTakePersonal = (item: FeedItem): boolean => {
    const previous = lastOf();
    if (!previous) return true;
    if (previous.kind === 'milestone' && item.kind === 'milestone') return false;
    // Two observations of the same template side by side read as a horoscope.
    if (
      previous.kind === 'observation' &&
      item.kind === 'observation' &&
      previous.observationCode === item.observationCode
    ) {
      return false;
    }
    return true;
  };

  while (result.length < limit && (queues.personal.length || queues.recommendations.length)) {
    const wantPersonal =
      queues.personal.length > 0 && (recommendationRun >= 2 || result.length % 2 === 1);

    if (wantPersonal) {
      const index = queues.personal.findIndex(canTakePersonal);
      if (index >= 0) {
        const [item] = queues.personal.splice(index, 1);
        result.push(item!);
        recommendationRun = 0;
        continue;
      }
    }

    if (queues.recommendations.length) {
      const [item] = queues.recommendations.splice(0, 1);
      result.push(item!);
      recommendationRun = isRecommendationLike(item!) ? recommendationRun + 1 : 0;
      continue;
    }

    if (queues.personal.length) {
      const [item] = queues.personal.splice(0, 1);
      result.push(item!);
      recommendationRun = 0;
      continue;
    }
    break;
  }

  return result;
};

/* --- assembly ------------------------------------------------------------ */

export const assembleFeed = (input: FeedAssemblyInput): FeedSnapshot => {
  const limit = input.limit ?? INITIAL_BATCH;

  const observations = deriveObservations({
    entries: input.entries,
    films: input.films,
    now: input.now,
    sourceRevision: input.sourceRevision,
  })
    // A dismissed claim stays gone until its evidence genuinely changes: the
    // id carries the revision, so a new id means a new claim (§16.2).
    .filter((item) => !input.feedback.dismissedObservationIds.has(item.id))
    .map((item, index) => ({ ...item, rank: index }));

  const milestones = deriveMilestones({
    entries: input.entries,
    films: input.films,
    now: input.now,
    sourceRevision: input.sourceRevision,
  }).filter((item) => !input.impressions.shownMilestoneCodes.has(item.milestoneCode));

  const watchlistReturns = buildWatchlistReturns(input);
  const recommendations = buildRecommendations(input);

  const alreadyShown = new Set<number>();
  for (const item of [...recommendations, ...watchlistReturns]) {
    for (const filmId of filmIdsOf(item)) alreadyShown.add(filmId);
  }
  for (const entry of input.entries) alreadyShown.add(entry.filmId);

  const fallback = buildFallback(input, alreadyShown);

  // Observations lead the personal lane; milestones are rare and land where
  // the mixing rules allow them.
  const personal: FeedItem[] = [...milestones, ...observations, ...watchlistReturns];
  const discovery: FeedItem[] = [...recommendations, ...fallback];

  const mixed = mixItems(personal, discovery, limit).filter(
    (item) => !input.feedback.dismissedItemIds.has(item.id),
  );

  // Never the same film twice in one snapshot (§5.5). Items that are about a
  // set of films — observations, milestones — are not affected.
  const seenFilms = new Set<number>();
  const deduped = mixed.filter((item) => {
    const ids = filmIdsOf(item);
    if (ids.length !== 1) return true;
    const [id] = ids;
    if (id === undefined) return true;
    if (seenFilms.has(id)) return false;
    seenFilms.add(id);
    return true;
  });

  const cooled = applyObservationCooldown(deduped);

  return {
    schemaVersion: 2,
    items: cooled.map((item, index) => ({ ...item, rank: index })),
    generatedAt: input.now,
    updatedAt: Date.parse(input.now),
    sourceRevision: input.sourceRevision,
    source: input.candidates.length || input.trending.length ? 'mixed' : 'local',
  };
};

/** One observation code may not repeat within ten items (§9.8). */
const applyObservationCooldown = (items: FeedItem[]): FeedItem[] => {
  const lastIndexByCode = new Map<string, number>();
  return items.filter((item, index) => {
    if (item.kind !== 'observation') return true;
    const previous = lastIndexByCode.get(item.observationCode);
    if (previous !== undefined && index - previous < OBSERVATION_COOLDOWN_ITEMS) return false;
    lastIndexByCode.set(item.observationCode, index);
    return true;
  });
};

/**
 * Merges a fresh assembly with what the user is already looking at (§14.5,
 * §23). Unchanged items keep their identity and their place; genuinely new
 * items go on top; nothing that was dismissed comes back.
 */
export const reconcileSnapshot = (
  previous: FeedSnapshot | null,
  next: FeedSnapshot,
): { snapshot: FeedSnapshot; newItemIds: string[] } => {
  if (!previous || !previous.items.length) return { snapshot: next, newItemIds: [] };

  const previousIds = new Set(previous.items.map((item) => item.id));
  const dismissed = new Set(
    previous.items.filter((item) => item.dismissedAt !== null).map((item) => item.id),
  );

  const fresh = next.items.filter((item) => !previousIds.has(item.id) && !dismissed.has(item.id));
  /*
   * Everything already on screen stays on screen: an item the new assembly
   * still produces is updated in place, and one it no longer produces remains
   * as history rather than vanishing under the user's eyes (§5.3, §23.2).
   * Only an explicit dismissal removes an item.
   */
  const kept = previous.items
    .filter((item) => !dismissed.has(item.id))
    .map((item) => next.items.find((candidate) => candidate.id === item.id) ?? item);

  const items = [...fresh, ...kept].map((item, index) => ({ ...item, rank: index }));

  return {
    snapshot: { ...next, items },
    newItemIds: fresh.map((item) => item.id),
  };
};
