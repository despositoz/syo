import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film } from '@entities/film/film.model';
import { RATING_ASPECTS } from '@domain/rating/rating.constants';
import type { RatingAspectId } from '@domain/rating/rating.types';
import { milestoneId, observationId } from './feed.ids';
import { CALCULATION_VERSION, THRESHOLDS } from './insight.thresholds';
import type { MilestoneItem, ObservationEvidence, ObservationItem } from './feed.types';

/**
 * Local, deterministic observations (P0.4 §8).
 *
 * No model, no sentiment, no server. Every claim here is arithmetic over the
 * user's own ratings, with the films it was computed from attached, so the
 * user can check it. What the engine cannot prove, it does not say.
 *
 * Review text is never read. Its *length* is a fact about how much someone
 * wrote; its content is theirs (§8.3).
 */

export interface InsightInput {
  entries: DiaryEntry[];
  /** Cached films by id — genres, director and cast come from here. */
  films: Map<number, Film>;
  now: string;
  sourceRevision: number;
}

/** Everything the engine derived, before mixing decides what fits. */
export interface InsightResult {
  observations: ObservationItem[];
  milestones: MilestoneItem[];
}

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const round = (value: number): number => Math.round(value * 100) / 100;

/** A saved entry always carries a real 1–5 rating; drafts never reach here. */
const scoreOf = (entry: DiaryEntry): number => entry.preciseRating || entry.overallRating;

const baseItem = (id: string, input: InsightInput, rank: number) => ({
  id,
  generatedAt: input.now,
  createdAt: input.now,
  sourceRevision: input.sourceRevision,
  rank,
  expiresAt: null,
  dismissedAt: null,
  reason: null,
});

const evidenceOf = (
  filmIds: number[],
  values: Record<string, number | string>,
  sampleSize: number,
): ObservationEvidence => ({
  filmIds,
  values,
  sampleSize,
  calculationVersion: CALCULATION_VERSION,
});

/** Sorted best-first, so evidence shows the strongest examples. */
const byScoreDesc = (entries: DiaryEntry[]): DiaryEntry[] =>
  [...entries].sort((left, right) => scoreOf(right) - scoreOf(left));

const genresOf = (entry: DiaryEntry, films: Map<number, Film>): string[] =>
  films.get(entry.filmId)?.genres ?? [];

/* --- observations -------------------------------------------------------- */

const genreObservations = (input: InsightInput, overall: number): ObservationItem[] => {
  const { entries, films } = input;
  const results: ObservationItem[] = [];
  if (entries.length < THRESHOLDS.genreAffinity.minTotalRatings) return results;

  const byGenre = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    for (const genre of genresOf(entry, films)) {
      byGenre.set(genre, [...(byGenre.get(genre) ?? []), entry]);
    }
  }

  // Deterministic order: the strongest difference first, ties by name.
  const ranked = [...byGenre.entries()]
    .map(([genre, genreEntries]) => ({
      genre,
      genreEntries,
      mean: average(genreEntries.map(scoreOf)),
    }))
    .sort((left, right) => right.mean - left.mean || left.genre.localeCompare(right.genre));

  for (const { genre, genreEntries, mean } of ranked) {
    const affinity = THRESHOLDS.genreAffinity;
    if (
      genreEntries.length >= affinity.minGenreFilms &&
      mean - overall >= affinity.minDelta &&
      genreEntries.length >= affinity.minEvidence
    ) {
      const evidenceEntries = byScoreDesc(genreEntries).slice(0, 5);
      results.push({
        ...baseItem(observationId('genreAffinity', genre, input.sourceRevision), input, 0),
        kind: 'observation',
        observationCode: 'genreAffinity',
        headline: `${genre} у тебя держится выше остального`,
        supportingText: `Средняя оценка жанра ${round(mean)} против ${round(overall)} в целом`,
        evidence: evidenceOf(
          evidenceEntries.map((entry) => entry.filmId),
          { genre, genreAverage: round(mean), overallAverage: round(overall) },
          genreEntries.length,
        ),
        confidence: genreEntries.length >= affinity.highConfidenceFilms ? 'high' : 'medium',
      });
      break; // One affinity claim is a signal; three is a horoscope.
    }
  }

  const tension = THRESHOLDS.genreTension;
  if (entries.length >= tension.minTotalRatings) {
    const weakest = [...ranked].reverse();
    for (const { genre, genreEntries, mean } of weakest) {
      if (genreEntries.length >= tension.minGenreFilms && overall - mean >= tension.minDelta) {
        results.push({
          ...baseItem(observationId('genreTension', genre, input.sourceRevision), input, 0),
          kind: 'observation',
          observationCode: 'genreTension',
          // A tension, not a verdict about the person (§9.2).
          headline: `${genre} тебя тянет, но до высокой оценки доходит редко`,
          supportingText: `Средняя ${round(mean)} против ${round(overall)} в целом`,
          evidence: evidenceOf(
            byScoreDesc(genreEntries)
              .slice(0, 5)
              .map((entry) => entry.filmId),
            { genre, genreAverage: round(mean), overallAverage: round(overall) },
            genreEntries.length,
          ),
          confidence: 'medium',
        });
        break;
      }
    }
  }

  return results;
};

const directorObservation = (input: InsightInput, overall: number): ObservationItem | null => {
  const byDirector = new Map<string, DiaryEntry[]>();
  for (const entry of input.entries) {
    const director = input.films.get(entry.filmId)?.director;
    // Missing director data is skipped, never guessed (§37.11).
    if (!director) continue;
    byDirector.set(director, [...(byDirector.get(director) ?? []), entry]);
  }

  const candidates = [...byDirector.entries()]
    .map(([director, entries]) => ({ director, entries, mean: average(entries.map(scoreOf)) }))
    .filter(({ entries }) => entries.length >= THRESHOLDS.directorAffinity.minFilms)
    .filter(
      ({ mean }) =>
        mean >= THRESHOLDS.directorAffinity.minAverage ||
        mean - overall >= THRESHOLDS.directorAffinity.minDelta,
    )
    .sort((left, right) => right.mean - left.mean || left.director.localeCompare(right.director));

  const best = candidates[0];
  if (!best) return null;

  return {
    ...baseItem(observationId('directorAffinity', best.director, input.sourceRevision), input, 0),
    kind: 'observation',
    observationCode: 'directorAffinity',
    headline: `Фильмы ${best.director} у тебя держатся особенно высоко`,
    supportingText: `${best.entries.length} фильма, средняя ${round(best.mean)}`,
    evidence: evidenceOf(
      byScoreDesc(best.entries).map((entry) => entry.filmId),
      {
        director: best.director,
        directorAverage: round(best.mean),
        overallAverage: round(overall),
      },
      best.entries.length,
    ),
    confidence: best.entries.length >= 4 ? 'high' : 'medium',
  };
};

const actorObservation = (input: InsightInput, overall: number): ObservationItem | null => {
  const byActor = new Map<number, { name: string; entries: DiaryEntry[] }>();
  for (const entry of input.entries) {
    // Only the top of the billing: a face in the crowd is not a pattern.
    for (const member of (input.films.get(entry.filmId)?.cast ?? []).slice(0, 5)) {
      const current = byActor.get(member.id) ?? { name: member.name, entries: [] };
      current.entries.push(entry);
      byActor.set(member.id, current);
    }
  }

  const candidates = [...byActor.entries()]
    .map(([id, value]) => ({ id, ...value, mean: average(value.entries.map(scoreOf)) }))
    .filter(({ entries }) => entries.length >= THRESHOLDS.actorRecurrence.minFilms)
    .filter(({ mean }) => mean - overall >= THRESHOLDS.actorRecurrence.minDelta)
    .sort((left, right) => right.mean - left.mean || left.name.localeCompare(right.name));

  const best = candidates[0];
  if (!best) return null;

  return {
    ...baseItem(observationId('actorRecurrence', best.id, input.sourceRevision), input, 0),
    kind: 'observation',
    observationCode: 'actorRecurrence',
    // "Turns up among", not "your favourite actor" (§9.4).
    headline: `Фильмы с ${best.name} снова оказываются среди твоих сильных оценок`,
    supportingText: `${best.entries.length} фильма, средняя ${round(best.mean)}`,
    evidence: evidenceOf(
      byScoreDesc(best.entries).map((entry) => entry.filmId),
      { actor: best.name, actorAverage: round(best.mean), overallAverage: round(overall) },
      best.entries.length,
    ),
    confidence: 'medium',
  };
};

const aspectObservation = (input: InsightInput): ObservationItem | null => {
  const detailed = input.entries.filter((entry) => entry.mode === 'deep');
  if (detailed.length < THRESHOLDS.aspectSignature.minDetailedEntries) return null;

  const means = RATING_ASPECTS.map((aspect) => {
    const values = detailed
      .map((entry) => entry.aspects[aspect.id as RatingAspectId])
      .filter((value) => typeof value === 'number')
      .map((value) => value as number);
    return { aspect, mean: average(values), count: values.length };
  })
    .filter((entry) => entry.count >= THRESHOLDS.aspectSignature.minDetailedEntries)
    .sort((left, right) => right.mean - left.mean || left.aspect.id.localeCompare(right.aspect.id));

  const [leader, second] = means;
  if (!leader || !second) return null;
  if (leader.mean - second.mean < THRESHOLDS.aspectSignature.minLead) return null;

  const evidenceEntries = [...detailed]
    .sort(
      (left, right) =>
        (right.aspects[leader.aspect.id] ?? 0) - (left.aspects[leader.aspect.id] ?? 0),
    )
    .slice(0, 5);

  return {
    ...baseItem(observationId('aspectSignature', leader.aspect.id, input.sourceRevision), input, 0),
    kind: 'observation',
    observationCode: 'aspectSignature',
    // About the ratings, never about the person (§9.5).
    headline: `${leader.aspect.shortName} у тебя чаще вытягивает итог`,
    supportingText: `Средняя ${round(leader.mean)} против ${round(second.mean)} у «${second.aspect.shortName}»`,
    evidence: evidenceOf(
      evidenceEntries.map((entry) => entry.filmId),
      {
        aspect: leader.aspect.shortName,
        aspectAverage: round(leader.mean),
        runnerUp: second.aspect.shortName,
        runnerUpAverage: round(second.mean),
      },
      detailed.length,
    ),
    confidence: detailed.length >= 8 ? 'high' : 'medium',
  };
};

/** Length only. What the text says is the user's business (§8.3, §9.6). */
const writingObservation = (input: InsightInput): ObservationItem | null => {
  const written = input.entries
    .filter((entry) => entry.hasText && entry.text)
    .map((entry) => ({
      entry,
      length: (entry.text?.revisions ?? []).reduce(
        (longest, revision) =>
          revision.id === entry.text?.selectedRevisionId ? revision.text.length : longest,
        0,
      ),
    }))
    .filter((item) => item.length > 0);

  if (written.length < THRESHOLDS.writingDepth.minTextEntries) return null;

  const longest = [...written]
    .sort((left, right) => right.length - left.length || left.entry.filmId - right.entry.filmId)
    .slice(0, THRESHOLDS.writingDepth.showFilms);

  return {
    ...baseItem(observationId('writingDepth', 'longest', input.sourceRevision), input, 0),
    kind: 'observation',
    observationCode: 'writingDepth',
    headline: 'Об этих фильмах ты написал больше всего',
    // No claim about why — that would be a guess about a person (§9.6).
    supportingText: null,
    evidence: evidenceOf(
      longest.map((item) => item.entry.filmId),
      { withText: written.length },
      written.length,
    ),
    confidence: 'medium',
  };
};

const detailedBehaviorObservation = (input: InsightInput): ObservationItem | null => {
  const rules = THRESHOLDS.detailedBehavior;
  if (input.entries.length < rules.minTotalRatings) return null;

  const detailed = input.entries.filter((entry) => entry.mode === 'deep');
  if (detailed.length < rules.minDetailed) return null;
  if (detailed.length / input.entries.length < rules.minRatio) return null;

  return {
    ...baseItem(observationId('detailedBehavior', 'ratio', input.sourceRevision), input, 0),
    kind: 'observation',
    observationCode: 'detailedBehavior',
    headline: 'К этим фильмам ты возвращался с подробной оценкой',
    supportingText: `${detailed.length} из ${input.entries.length} записей — подробные`,
    evidence: evidenceOf(
      byScoreDesc(detailed)
        .slice(0, 5)
        .map((entry) => entry.filmId),
      { detailed: detailed.length, total: input.entries.length },
      detailed.length,
    ),
    confidence: 'medium',
  };
};

/* --- milestones ---------------------------------------------------------- */

const RATING_MILESTONES = [10, 25, 50, 100] as const;

const milestoneItem = (
  input: InsightInput,
  code: string,
  value: number,
  headline: string,
  supportingText: string | null,
  filmIds: number[],
): MilestoneItem => ({
  ...baseItem(milestoneId(code, value), input, 0),
  kind: 'milestone',
  milestoneCode: `${code}:${value}`,
  value,
  headline,
  supportingText,
  filmIds,
});

/**
 * Real events only (§11.1): a count that was actually reached. Nothing is
 * awarded for opening the app, and nothing repeats — the assembler filters by
 * what has already been shown.
 */
export const deriveMilestones = (input: InsightInput): MilestoneItem[] => {
  const entries = [...input.entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const results: MilestoneItem[] = [];
  if (!entries.length) return results;

  if (entries.length === 1) {
    results.push(
      milestoneItem(input, 'ratings', 1, 'Первая оценка в твоём Дневнике', null, [
        entries[0]!.filmId,
      ]),
    );
  }

  for (const threshold of RATING_MILESTONES) {
    if (entries.length >= threshold) {
      results.push(
        milestoneItem(
          input,
          'ratings',
          threshold,
          `${threshold} фильмов в твоём Дневнике`,
          null,
          entries.slice(-3).map((entry) => entry.filmId),
        ),
      );
    }
  }

  const withText = entries.filter((entry) => entry.hasText);
  if (withText.length >= 10) {
    results.push(
      milestoneItem(
        input,
        'texts',
        10,
        'Это десятая запись с впечатлением',
        null,
        withText.slice(-3).map((entry) => entry.filmId),
      ),
    );
  }

  const detailed = entries.filter((entry) => entry.mode === 'deep');
  if (detailed.length >= 25) {
    results.push(
      milestoneItem(
        input,
        'detailed',
        25,
        '25 подробных оценок',
        null,
        detailed.slice(-3).map((entry) => entry.filmId),
      ),
    );
  }

  // The third film of one director is a real event about a real person.
  const byDirector = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const director = input.films.get(entry.filmId)?.director;
    if (!director) continue;
    byDirector.set(director, [...(byDirector.get(director) ?? []), entry]);
  }
  for (const [director, directorEntries] of [...byDirector.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    if (directorEntries.length === 3) {
      results.push({
        ...milestoneItem(
          input,
          `director:${director}`,
          3,
          `Третий фильм ${director}`,
          null,
          directorEntries.map((entry) => entry.filmId),
        ),
      });
    }
  }

  return results;
};

/**
 * All observations the data supports, strongest first. The assembler decides
 * how many of them fit; the engine only decides which are true.
 */
export const deriveObservations = (input: InsightInput): ObservationItem[] => {
  if (!input.entries.length) return [];
  const overall = average(input.entries.map(scoreOf));

  const all = [
    ...genreObservations(input, overall),
    directorObservation(input, overall),
    actorObservation(input, overall),
    aspectObservation(input),
    writingObservation(input),
    detailedBehaviorObservation(input),
  ].filter((item): item is ObservationItem => item !== null);

  // High confidence first, then larger samples: the better-supported claim
  // gets the better position, deterministically.
  return all.sort(
    (left, right) =>
      Number(right.confidence === 'high') - Number(left.confidence === 'high') ||
      right.evidence.sampleSize - left.evidence.sampleSize ||
      left.id.localeCompare(right.id),
  );
};

export const deriveInsights = (input: InsightInput): InsightResult => ({
  observations: deriveObservations(input),
  milestones: deriveMilestones(input),
});
