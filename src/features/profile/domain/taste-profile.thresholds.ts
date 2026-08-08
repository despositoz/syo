/**
 * Every threshold the taste engine obeys (P0.5 §8, §9).
 *
 * They live in one file so the numbers can be read, argued with and tested
 * without going through the engine. Below a threshold there is no signal —
 * an empty section is honest, a made-up one is not.
 */

export const CONFIDENCE_LEVELS = {
  /** Below this nothing personal is claimed at all. */
  insufficientBelow: 3,
  /** From here a portrait may form, always hedged with "пока". */
  formingFrom: 3,
  /** From here sections may speak plainly. */
  stableFrom: 15,
} as const;

export const GENRE = {
  /** Ratings in the whole archive before genres mean anything. */
  minArchive: 6,
  /** Films of that genre. One film is a coincidence. */
  minSupport: 3,
  /** How far above the person's own average an affinity has to sit. */
  affinityDelta: 0.45,
  /** How far below for a tension. Never phrased as dislike. */
  tensionDelta: -0.5,
  minTensionSupport: 4,
  minTensionArchive: 8,
  maxShown: 5,
} as const;

export const DIRECTOR = {
  minArchive: 6,
  /** Two films is enough for a director, but both must be strong. */
  minSupport: 2,
  minAverage: 4,
  minDelta: 0.5,
  maxShown: 3,
} as const;

export const ACTOR = {
  minArchive: 8,
  minSupport: 3,
  /** Two films only when they are both near the top of the scale. */
  strongPairAverage: 4.5,
  maxShown: 3,
} as const;

export const ASPECT = {
  /** Deep ratings only: a quick rating has no aspects to compare. */
  minDeep: 5,
  /** How far the leading aspect must sit above the next one. */
  minLeadDelta: 0.4,
} as const;

export const RATING_BEHAVIOR = {
  minArchive: 6,
} as const;

export const ERA = {
  minArchive: 8,
  minSupport: 3,
  maxShown: 3,
} as const;

export const WRITING = {
  /** Entries carrying text before writing habits mean anything. */
  minWritten: 3,
  longFormChars: 600,
} as const;

export const RHYTHM = {
  minEntries: 4,
} as const;

/** How many films an evidence list shows before it becomes a wall. */
export const EVIDENCE_MAX = 5;

export const confidenceFor = (ratedCount: number) => {
  if (ratedCount < CONFIDENCE_LEVELS.insufficientBelow) return 'insufficient' as const;
  if (ratedCount < CONFIDENCE_LEVELS.stableFrom) return 'forming' as const;
  return 'stable' as const;
};
