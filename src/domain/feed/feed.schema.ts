import { z } from 'zod';
import { filmSummarySchema } from '@entities/film/film.schema';
import { fallbackId } from './feed.ids';
import { emptySnapshot, type FeedItem, type FeedSnapshot } from './feed.types';

/**
 * Parsing a stored snapshot (P0.4 §15, §36).
 *
 * Per-item, not per-snapshot: one row written by an older build, or one item
 * whose film went missing, must cost that item and nothing else. A feed that
 * refuses to open because of a single bad row is worse than a shorter feed.
 */

const reasonSchema = z.object({
  code: z.enum([
    'similarToHighlyRated',
    'sameDirector',
    'sameActor',
    'genreAffinity',
    'watchlist',
    'trending',
    'popular',
    'relatedToRecentEntry',
  ]),
  shortText: z.string(),
  sourceFilmIds: z.array(z.number()),
  sourcePersonIds: z.array(z.number()),
  evidenceLabel: z.string().nullable(),
});

const baseShape = {
  id: z.string(),
  generatedAt: z.string(),
  createdAt: z.string(),
  sourceRevision: z.number(),
  rank: z.number(),
  expiresAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  reason: reasonSchema.nullable(),
};

const evidenceSchema = z.object({
  filmIds: z.array(z.number()),
  values: z.record(z.string(), z.union([z.number(), z.string()])),
  sampleSize: z.number(),
  calculationVersion: z.number(),
});

const itemSchema = z.discriminatedUnion('kind', [
  z.object({
    ...baseShape,
    kind: z.literal('cinematicRecommendation'),
    film: filmSummarySchema,
    reason: reasonSchema,
    seedFilmIds: z.array(z.number()),
  }),
  z.object({
    ...baseShape,
    kind: z.literal('compactCollection'),
    title: z.string(),
    subtitle: z.string().nullable(),
    films: z.array(z.object({ film: filmSummarySchema, reason: reasonSchema.nullable() })),
    collectionKind: z.enum(['related', 'director', 'genre', 'watchlist', 'popular']),
  }),
  z.object({
    ...baseShape,
    kind: z.literal('observation'),
    observationCode: z.enum([
      'genreAffinity',
      'genreTension',
      'directorAffinity',
      'actorRecurrence',
      'aspectSignature',
      'writingDepth',
      'detailedBehavior',
    ]),
    headline: z.string(),
    supportingText: z.string().nullable(),
    evidence: evidenceSchema,
    confidence: z.enum(['medium', 'high']),
  }),
  z.object({
    ...baseShape,
    kind: z.literal('milestone'),
    milestoneCode: z.string(),
    value: z.number(),
    headline: z.string(),
    supportingText: z.string().nullable(),
    filmIds: z.array(z.number()),
  }),
  z.object({
    ...baseShape,
    kind: z.literal('watchlistReturn'),
    film: filmSummarySchema,
    addedAt: z.string(),
    returnReason: z.enum(['aged', 'relatedToRecentRating', 'newContext']),
  }),
  z.object({
    ...baseShape,
    kind: z.literal('discoveryFallback'),
    film: filmSummarySchema,
    source: z.enum(['trending', 'popular']),
  }),
]);

export const parseFeedItem = (value: unknown): FeedItem | null => {
  const parsed = itemSchema.safeParse(value);
  return parsed.success ? (parsed.data as FeedItem) : null;
};

const snapshotSchema = z.object({
  schemaVersion: z.literal(2),
  items: z.array(z.unknown()),
  generatedAt: z.string(),
  updatedAt: z.number(),
  sourceRevision: z.number(),
  source: z.enum(['cache', 'local', 'network', 'mixed']),
});

/**
 * Reads a v2 snapshot, dropping individual items that no longer parse.
 * Returns null when the row is not a v2 snapshot at all — the caller then
 * tries the legacy shape.
 */
export const parseFeedSnapshot = (value: unknown): FeedSnapshot | null => {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) return null;

  const items = parsed.data.items
    .map(parseFeedItem)
    .filter((item): item is FeedItem => item !== null);

  return { ...parsed.data, schemaVersion: 2, items };
};

/**
 * The P0.1–P0.3 cache: a bare array of FilmSummary under `trending-day`.
 *
 * It becomes discovery fallback items rather than being thrown away — the
 * whole point of a local-first feed is that an upgrade does not start the user
 * on a blank screen (§36.3).
 */
export const parseLegacyFeedCache = (row: unknown, cachedAt: number): FeedSnapshot => {
  const legacy = z
    .object({ items: z.array(z.unknown()), cachedAt: z.number().optional() })
    .safeParse(row);
  if (!legacy.success) return emptySnapshot();

  const films = legacy.data.items
    .map((item) => filmSummarySchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  if (!films.length) return emptySnapshot();

  const generatedAt = new Date(cachedAt || Date.now()).toISOString();
  return {
    schemaVersion: 2,
    items: films.map((film, index) => ({
      id: fallbackId('trending', film.id, generatedAt),
      kind: 'discoveryFallback' as const,
      film,
      source: 'trending' as const,
      generatedAt,
      createdAt: generatedAt,
      sourceRevision: 0,
      rank: index,
      expiresAt: null,
      dismissedAt: null,
      // Migrated items make no personal claim: they never did.
      reason: null,
    })),
    generatedAt,
    updatedAt: cachedAt || Date.now(),
    sourceRevision: 0,
    source: 'cache',
  };
};
