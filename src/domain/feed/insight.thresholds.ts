/**
 * Every number the InsightEngine is allowed to believe (P0.4 §9).
 *
 * They live in one file on purpose: a threshold that drifts to make the feed
 * fuller is how a product starts telling people things about themselves that
 * are not true. Changing any of these is a deliberate act with a test behind
 * it, not a tuning knob.
 */

/** Bumped when a formula changes, so old evidence is recognisably old. */
export const CALCULATION_VERSION = 1;

export const THRESHOLDS = {
  genreAffinity: {
    /** Nothing at all is said about taste below this many ratings. */
    minTotalRatings: 6,
    minGenreFilms: 3,
    /** How far above the personal average the genre has to sit. */
    minDelta: 0.45,
    minEvidence: 3,
    /** Below this many films the claim is 'medium', never 'high'. */
    highConfidenceFilms: 5,
  },
  genreTension: {
    minTotalRatings: 8,
    minGenreFilms: 4,
    minDelta: 0.5,
  },
  directorAffinity: {
    minFilms: 3,
    /** Either an average this high… */
    minAverage: 4,
    /** …or this far above the personal average. */
    minDelta: 0.5,
  },
  actorRecurrence: {
    minFilms: 3,
    minDelta: 0.01,
  },
  aspectSignature: {
    minDetailedEntries: 5,
    /** The leading aspect must clear the next one by this much. */
    minLead: 0.4,
  },
  writingDepth: {
    minTextEntries: 4,
    showFilms: 3,
  },
  detailedBehavior: {
    minTotalRatings: 8,
    minDetailed: 3,
    /** Detailed entries must be at least this share to be worth saying. */
    minRatio: 0.3,
  },
} as const;

/** One observation code may not reappear more often than this (§9.8). */
export const OBSERVATION_COOLDOWN_ITEMS = 10;
