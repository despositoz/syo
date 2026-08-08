/**
 * The taste signature (P0.5 §6.2).
 *
 * A portrait built from what the archive actually contains. Every claim keeps
 * the films it came from, so "why?" is always answerable — and nothing here is
 * a personality judgement.
 */

export type TasteConfidence = 'insufficient' | 'forming' | 'stable';

export interface EvidenceRef {
  diaryEntryId: string;
  filmId: number;
  title: string;
  posterPath: string | null;
  rating: number;
  occurredAt: string;
  /** How much this film pulled the signal, 0–1. Shown as a bar, never a weight. */
  contribution: number;
  reason: string;
}

export interface GenreSignal {
  genre: string;
  /** How many rated films carry it. */
  support: number;
  average: number;
  /** Difference from the person's own average, not from a global one. */
  delta: number;
  kind: 'affinity' | 'tension';
  evidenceKey: string;
}

export interface PersonSignal {
  name: string;
  support: number;
  average: number;
  delta: number;
  evidenceKey: string;
}

export interface AspectSignature {
  /** Ordered strongest first. */
  aspects: Array<{
    aspect: string;
    average: number;
    delta: number;
    support: number;
  }>;
  leadAspect: string;
  strictestAspect: string;
  evidenceKey: string;
}

export interface RatingBehavior {
  average: number;
  median: number;
  /** Share of 4s and 5s, 0–1. */
  generousShare: number;
  variance: number;
  quickCount: number;
  deepCount: number;
  evidenceKey: string;
}

export interface EraSignal {
  /** "1990-е" */
  decade: string;
  support: number;
  average: number;
  evidenceKey: string;
}

export interface ViewingRhythm {
  last30Days: number;
  busiestMonth: { month: string; count: number } | null;
  /** Median days between entries; null when there are too few. */
  medianGapDays: number | null;
}

export interface WritingSignature {
  writtenCount: number;
  writtenShare: number;
  medianLength: number;
  longFormCount: number;
  evidenceKey: string;
}

export interface TasteHeadline {
  text: string;
  /** Which signals produced it, for the "why?" sheet. */
  evidenceKeys: string[];
  templateId: string;
}

export interface TasteProfileSnapshot {
  id: 'current';
  computedAt: string;
  sourceRevision: string;
  diaryCount: number;
  ratedCount: number;
  writtenCount: number;
  confidence: TasteConfidence;
  headline: TasteHeadline | null;
  genreSignals: GenreSignal[];
  directorSignals: PersonSignal[];
  actorSignals: PersonSignal[];
  aspectSignature: AspectSignature | null;
  ratingBehavior: RatingBehavior | null;
  eraPreference: EraSignal[];
  viewingRhythm: ViewingRhythm | null;
  writingSignature: WritingSignature | null;
  evidenceIndex: Record<string, EvidenceRef[]>;
  engineVersion: number;
}

/** Bumped when a calculation changes, so stored snapshots are recomputed. */
export const ENGINE_VERSION = 1;

export const emptySnapshot = (now = new Date().toISOString()): TasteProfileSnapshot => ({
  id: 'current',
  computedAt: now,
  sourceRevision: 'empty',
  diaryCount: 0,
  ratedCount: 0,
  writtenCount: 0,
  confidence: 'insufficient',
  headline: null,
  genreSignals: [],
  directorSignals: [],
  actorSignals: [],
  aspectSignature: null,
  ratingBehavior: null,
  eraPreference: [],
  viewingRhythm: null,
  writingSignature: null,
  evidenceIndex: {},
  engineVersion: ENGINE_VERSION,
});

/** True when the snapshot has at least one thing worth showing. */
export const hasSignals = (snapshot: TasteProfileSnapshot): boolean =>
  snapshot.genreSignals.length > 0 ||
  snapshot.directorSignals.length > 0 ||
  snapshot.actorSignals.length > 0 ||
  snapshot.aspectSignature !== null ||
  snapshot.ratingBehavior !== null ||
  snapshot.writingSignature !== null;
