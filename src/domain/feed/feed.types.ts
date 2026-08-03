import type { FilmSummary } from '@entities/film/film.model';

/**
 * The personal feed (P0.4 §6).
 *
 * Six kinds of item, each with its own composition on screen. The union is the
 * contract between the assembler, the storage layer and the cards: nothing
 * renders from a shape the assembler cannot produce, and nothing is produced
 * that a card cannot render.
 */

export type FeedItemKind =
  | 'cinematicRecommendation'
  | 'compactCollection'
  | 'observation'
  | 'milestone'
  | 'watchlistReturn'
  | 'discoveryFallback';

/* --- reasons ------------------------------------------------------------ */

export type FeedReasonCode =
  | 'similarToHighlyRated'
  | 'sameDirector'
  | 'sameActor'
  | 'genreAffinity'
  | 'watchlist'
  | 'trending'
  | 'popular'
  | 'relatedToRecentEntry';

/**
 * Why an item is here, in words the user can check against their own diary.
 * Never a score, never a percentage, never the name of an endpoint (§7.2).
 */
export interface FeedReason {
  code: FeedReasonCode;
  shortText: string;
  sourceFilmIds: number[];
  sourcePersonIds: number[];
  evidenceLabel: string | null;
}

/* --- observations ------------------------------------------------------- */

export type ObservationCode =
  | 'genreAffinity'
  | 'genreTension'
  | 'directorAffinity'
  | 'actorRecurrence'
  | 'aspectSignature'
  | 'writingDepth'
  | 'detailedBehavior';

/**
 * What the claim is made of. An observation without evidence is an opinion
 * SYO is not entitled to (§10.4).
 */
export interface ObservationEvidence {
  filmIds: number[];
  values: Record<string, number | string>;
  sampleSize: number;
  calculationVersion: number;
}

/* --- items -------------------------------------------------------------- */

export interface FeedItemBase {
  /** Deterministic: the same logical item keeps its id across refreshes (§6.7). */
  id: string;
  kind: FeedItemKind;
  generatedAt: string;
  createdAt: string;
  /** Which journal revision the item was derived from. */
  sourceRevision: number;
  rank: number;
  expiresAt: string | null;
  dismissedAt: string | null;
  reason: FeedReason | null;
}

export interface CinematicRecommendationItem extends FeedItemBase {
  kind: 'cinematicRecommendation';
  film: FilmSummary;
  reason: FeedReason;
  seedFilmIds: number[];
}

export type CollectionKind = 'related' | 'director' | 'genre' | 'watchlist' | 'popular';

export interface CompactCollectionItem extends FeedItemBase {
  kind: 'compactCollection';
  title: string;
  subtitle: string | null;
  films: Array<{ film: FilmSummary; reason: FeedReason | null }>;
  collectionKind: CollectionKind;
}

export interface ObservationItem extends FeedItemBase {
  kind: 'observation';
  observationCode: ObservationCode;
  headline: string;
  supportingText: string | null;
  evidence: ObservationEvidence;
  confidence: 'medium' | 'high';
}

export interface MilestoneItem extends FeedItemBase {
  kind: 'milestone';
  milestoneCode: string;
  value: number;
  headline: string;
  supportingText: string | null;
  filmIds: number[];
}

export interface WatchlistReturnItem extends FeedItemBase {
  kind: 'watchlistReturn';
  film: FilmSummary;
  addedAt: string;
  returnReason: 'aged' | 'relatedToRecentRating' | 'newContext';
}

export interface DiscoveryFallbackItem extends FeedItemBase {
  kind: 'discoveryFallback';
  film: FilmSummary;
  source: 'trending' | 'popular';
}

export type FeedItem =
  | CinematicRecommendationItem
  | CompactCollectionItem
  | ObservationItem
  | MilestoneItem
  | WatchlistReturnItem
  | DiscoveryFallbackItem;

/** Items that are about one film — the ones that carry swipe actions (§20.1). */
export type FilmFeedItem =
  CinematicRecommendationItem | WatchlistReturnItem | DiscoveryFallbackItem;

export const isFilmItem = (item: FeedItem): item is FilmFeedItem =>
  item.kind === 'cinematicRecommendation' ||
  item.kind === 'watchlistReturn' ||
  item.kind === 'discoveryFallback';

/** Every film an item puts on screen, for duplicate checks. */
export const filmIdsOf = (item: FeedItem): number[] => {
  switch (item.kind) {
    case 'cinematicRecommendation':
    case 'watchlistReturn':
    case 'discoveryFallback':
      return [item.film.id];
    case 'compactCollection':
      return item.films.map((entry) => entry.film.id);
    case 'observation':
      return item.evidence.filmIds;
    case 'milestone':
      return item.filmIds;
  }
};

/* --- snapshot ----------------------------------------------------------- */

export interface FeedSnapshot {
  schemaVersion: 2;
  items: FeedItem[];
  generatedAt: string;
  updatedAt: number;
  sourceRevision: number;
  source: 'cache' | 'local' | 'network' | 'mixed';
}

export const emptySnapshot = (): FeedSnapshot => ({
  schemaVersion: 2,
  items: [],
  generatedAt: new Date(0).toISOString(),
  updatedAt: 0,
  sourceRevision: 0,
  source: 'local',
});

/* --- feedback ----------------------------------------------------------- */

export type FeedFeedbackAction =
  | 'dismiss'
  | 'notInterested'
  | 'suppressSimilar'
  | 'bookmark'
  | 'unbookmark'
  | 'opened'
  | 'expanded'
  | 'seen';

export interface FeedFeedback {
  id: string;
  itemId: string;
  filmId: number | null;
  observationCode: string | null;
  action: FeedFeedbackAction;
  contextId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** What the assembler needs to know about past feedback. */
export interface FeedFeedbackState {
  dismissedItemIds: Set<string>;
  suppressedFilmIds: Set<number>;
  /** Observation codes whose *current* evidence the user has dismissed. */
  dismissedObservationIds: Set<string>;
  suppressedContextIds: Set<string>;
}

export const emptyFeedbackState = (): FeedFeedbackState => ({
  dismissedItemIds: new Set(),
  suppressedFilmIds: new Set(),
  dismissedObservationIds: new Set(),
  suppressedContextIds: new Set(),
});

/* --- impressions -------------------------------------------------------- */

export interface FeedImpression {
  itemId: string;
  firstShownAt: string;
  lastShownAt: string;
  showCount: number;
  openedAt: string | null;
  action: string | null;
}

export interface FeedImpressionState {
  byItemId: Map<string, FeedImpression>;
  /** Milestone codes already shown — a milestone happens once (§11.3). */
  shownMilestoneCodes: Set<string>;
}

export const emptyImpressionState = (): FeedImpressionState => ({
  byItemId: new Map(),
  shownMilestoneCodes: new Set(),
});

/* --- position ----------------------------------------------------------- */

export interface FeedPosition {
  key: string;
  anchorItemId: string | null;
  anchorOffset: number;
  scrollTopFallback: number;
  updatedAt: number;
}

/** Beyond this a restored position is a guess about a different session. */
export const POSITION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
