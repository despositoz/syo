import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film } from '@entities/film/film.model';
import { ASPECT_IDS } from '@domain/rating/rating.constants';
import {
  ACTOR,
  ASPECT,
  DIRECTOR,
  ERA,
  EVIDENCE_MAX,
  GENRE,
  RATING_BEHAVIOR,
  RHYTHM,
  WRITING,
  confidenceFor,
} from './taste-profile.thresholds';
import {
  ENGINE_VERSION,
  emptySnapshot,
  type AspectSignature,
  type EraSignal,
  type EvidenceRef,
  type GenreSignal,
  type PersonSignal,
  type RatingBehavior,
  type TasteProfileSnapshot,
  type ViewingRhythm,
  type WritingSignature,
} from './taste-profile.model';
import { buildHeadline } from './taste-profile.templates';

/**
 * The taste engine (P0.5 §7).
 *
 * Pure and deterministic: same input, same output, same `sourceRevision`. It
 * never touches React, the network or storage — it is handed entries and film
 * metadata and returns a snapshot.
 *
 * What it may look at: ratings, aspects, genres, directors, cast, release
 * years, dates, and *structural* facts about text (does it exist, how long).
 * What it may never look at: the words themselves (§4.4).
 */

export interface TasteInput {
  entries: DiaryEntry[];
  films: Map<number, Film>;
  favoriteFilmIds: number[];
  now: string;
}

/* --- small helpers -------------------------------------------------------- */

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * A stable fingerprint of everything the result depends on. Two runs over the
 * same archive produce the same string, and any real change produces a new one.
 */
export const sourceRevisionOf = (input: TasteInput): string => {
  const parts = [...input.entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) =>
      [
        entry.id,
        entry.filmId,
        entry.overallRating,
        entry.mode,
        entry.hasText ? 1 : 0,
        entry.revision,
        entry.deletedAt ?? '',
      ].join(':'),
    );
  parts.push(`fav:${input.favoriteFilmIds.join(',')}`);
  parts.push(`v:${ENGINE_VERSION}`);

  // FNV-1a: short, stable across runs, and no dependency for four lines.
  let hash = 0x811c9dc5;
  const source = parts.join('|');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const evidenceOf = (
  entries: DiaryEntry[],
  films: Map<number, Film>,
  reason: string,
  contributionOf: (entry: DiaryEntry) => number,
): EvidenceRef[] =>
  entries
    .map((entry) => ({
      diaryEntryId: entry.id,
      filmId: entry.filmId,
      title: entry.filmTitle,
      posterPath: entry.posterPath ?? films.get(entry.filmId)?.posterPath ?? null,
      rating: entry.overallRating,
      occurredAt: entry.watchedAt,
      contribution: round(Math.max(0, Math.min(1, contributionOf(entry))), 3),
      reason,
    }))
    // Strongest first, then newest: a stable order for a stable snapshot.
    .sort(
      (left, right) =>
        right.contribution - left.contribution || right.occurredAt.localeCompare(left.occurredAt),
    )
    // One line per film. The same film rated twice is still one piece of
    // evidence, and showing it twice would overstate the signal.
    .filter((ref, index, all) => all.findIndex((other) => other.filmId === ref.filmId) === index)
    .slice(0, EVIDENCE_MAX);

/* --- signals -------------------------------------------------------------- */

const genreSignals = (
  rated: DiaryEntry[],
  films: Map<number, Film>,
  baseline: number,
  evidence: Record<string, EvidenceRef[]>,
): GenreSignal[] => {
  if (rated.length < GENRE.minArchive) return [];

  const byGenre = new Map<string, DiaryEntry[]>();
  for (const entry of rated) {
    for (const genre of films.get(entry.filmId)?.genres ?? []) {
      if (!genre) continue;
      const bucket = byGenre.get(genre) ?? [];
      bucket.push(entry);
      byGenre.set(genre, bucket);
    }
  }

  const signals: GenreSignal[] = [];
  for (const [genre, entries] of byGenre) {
    const average = mean(entries.map((entry) => entry.overallRating));
    const delta = average - baseline;

    const affinity = entries.length >= GENRE.minSupport && delta >= GENRE.affinityDelta;
    const tension =
      rated.length >= GENRE.minTensionArchive &&
      entries.length >= GENRE.minTensionSupport &&
      delta <= GENRE.tensionDelta;
    if (!affinity && !tension) continue;

    const key = `genre:${genre}`;
    evidence[key] = evidenceOf(
      entries,
      films,
      affinity ? `Оценка выше твоего среднего` : `Оценка ниже твоего среднего`,
      (entry) => Math.abs(entry.overallRating - baseline) / 4,
    );

    signals.push({
      genre,
      support: entries.length,
      average: round(average),
      delta: round(delta),
      kind: affinity ? 'affinity' : 'tension',
      evidenceKey: key,
    });
  }

  return signals
    .sort(
      (left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.support - left.support,
    )
    .slice(0, GENRE.maxShown);
};

const personSignals = (
  rated: DiaryEntry[],
  films: Map<number, Film>,
  baseline: number,
  kind: 'director' | 'actor',
  evidence: Record<string, EvidenceRef[]>,
): PersonSignal[] => {
  const rules = kind === 'director' ? DIRECTOR : ACTOR;
  if (rated.length < rules.minArchive) return [];

  const byPerson = new Map<string, DiaryEntry[]>();
  for (const entry of rated) {
    const film = films.get(entry.filmId);
    if (!film) continue;
    const names =
      kind === 'director'
        ? film.director
          ? [film.director]
          : []
        : film.cast.slice(0, 5).map((member) => member.name);

    for (const name of names) {
      if (!name) continue;
      const bucket = byPerson.get(name) ?? [];
      bucket.push(entry);
      byPerson.set(name, bucket);
    }
  }

  const signals: PersonSignal[] = [];
  for (const [name, entries] of byPerson) {
    const average = mean(entries.map((entry) => entry.overallRating));
    const delta = average - baseline;

    const qualifies =
      kind === 'director'
        ? entries.length >= DIRECTOR.minSupport &&
          (average >= DIRECTOR.minAverage || delta >= DIRECTOR.minDelta)
        : entries.length >= ACTOR.minSupport ||
          (entries.length === 2 && average >= ACTOR.strongPairAverage);
    // An actor also has to actually stand above the person's own average,
    // otherwise appearing often says nothing about taste.
    if (!qualifies || (kind === 'actor' && delta <= 0)) continue;

    const key = `${kind}:${name}`;
    evidence[key] = evidenceOf(
      entries,
      films,
      kind === 'director' ? 'Фильм этого режиссёра' : 'Фильм с этим актёром',
      (entry) => entry.overallRating / 5,
    );

    signals.push({
      name,
      support: entries.length,
      average: round(average),
      delta: round(delta),
      evidenceKey: key,
    });
  }

  return signals
    .sort((left, right) => right.support - left.support || right.average - left.average)
    .slice(0, rules.maxShown);
};

const aspectSignature = (
  rated: DiaryEntry[],
  films: Map<number, Film>,
  evidence: Record<string, EvidenceRef[]>,
): AspectSignature | null => {
  const deep = rated.filter((entry) => entry.mode === 'deep');
  if (deep.length < ASPECT.minDeep) return null;

  const overall = mean(deep.map((entry) => entry.preciseRating));
  const aspects = ASPECT_IDS.map((aspect) => {
    const values = deep
      .map((entry) => entry.aspects[aspect])
      .filter((value) => typeof value === 'number')
      .map((value) => value as number);
    return {
      aspect,
      average: round(mean(values)),
      delta: round(mean(values) - overall),
      support: values.length,
    };
  })
    .filter((item) => item.support > 0)
    .sort((left, right) => right.average - left.average);

  if (aspects.length < 2) return null;

  const lead = aspects[0]!;
  const next = aspects[1]!;
  // Without a clear leader there is no signature — just five similar numbers.
  if (lead.average - next.average < ASPECT.minLeadDelta) return null;

  const key = 'aspect:signature';
  evidence[key] = evidenceOf(
    deep,
    films,
    'Подробная оценка',
    (entry) => (entry.aspects[lead.aspect as keyof typeof entry.aspects] ?? 0) / 5,
  );

  return {
    aspects,
    leadAspect: lead.aspect,
    strictestAspect: aspects[aspects.length - 1]!.aspect,
    evidenceKey: key,
  };
};

const ratingBehavior = (
  rated: DiaryEntry[],
  films: Map<number, Film>,
  evidence: Record<string, EvidenceRef[]>,
): RatingBehavior | null => {
  if (rated.length < RATING_BEHAVIOR.minArchive) return null;

  const scores = rated.map((entry) => entry.overallRating);
  const average = mean(scores);
  const variance = mean(scores.map((score) => (score - average) ** 2));

  const key = 'rating:behavior';
  evidence[key] = evidenceOf(rated, films, 'Твоя оценка', (entry) => entry.overallRating / 5);

  return {
    average: round(average),
    median: round(median(scores)),
    generousShare: round(scores.filter((score) => score >= 4).length / scores.length),
    variance: round(variance),
    quickCount: rated.filter((entry) => entry.mode === 'quick').length,
    deepCount: rated.filter((entry) => entry.mode === 'deep').length,
    evidenceKey: key,
  };
};

const eraPreference = (
  rated: DiaryEntry[],
  films: Map<number, Film>,
  evidence: Record<string, EvidenceRef[]>,
): EraSignal[] => {
  if (rated.length < ERA.minArchive) return [];

  const byDecade = new Map<string, DiaryEntry[]>();
  for (const entry of rated) {
    const year = Number(films.get(entry.filmId)?.year ?? entry.releaseYear ?? '');
    if (!Number.isFinite(year) || year < 1900) continue;
    const decade = `${Math.floor(year / 10) * 10}-е`;
    const bucket = byDecade.get(decade) ?? [];
    bucket.push(entry);
    byDecade.set(decade, bucket);
  }

  return [...byDecade]
    .filter(([, entries]) => entries.length >= ERA.minSupport)
    .map(([decade, entries]) => {
      const key = `era:${decade}`;
      evidence[key] = evidenceOf(
        entries,
        films,
        'Фильм этого десятилетия',
        (entry) => entry.overallRating / 5,
      );
      return {
        decade,
        support: entries.length,
        average: round(mean(entries.map((entry) => entry.overallRating))),
        evidenceKey: key,
      };
    })
    .sort((left, right) => right.support - left.support)
    .slice(0, ERA.maxShown);
};

const viewingRhythm = (entries: DiaryEntry[], now: string): ViewingRhythm | null => {
  if (entries.length < RHYTHM.minEntries) return null;

  const nowMs = Date.parse(now);
  const dates = entries
    .map((entry) => Date.parse(entry.watchedAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!dates.length) return null;

  const last30Days = dates.filter((date) => nowMs - date <= 30 * 24 * 60 * 60 * 1000).length;

  const byMonth = new Map<string, number>();
  for (const date of dates) {
    const key = new Date(date).toISOString().slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  const busiest = [...byMonth].sort(
    (left, right) => right[1] - left[1] || right[0].localeCompare(left[0]),
  )[0];

  const gaps: number[] = [];
  for (let index = 1; index < dates.length; index += 1) {
    gaps.push((dates[index]! - dates[index - 1]!) / (24 * 60 * 60 * 1000));
  }

  return {
    last30Days,
    busiestMonth: busiest ? { month: busiest[0], count: busiest[1] } : null,
    medianGapDays: gaps.length ? round(median(gaps), 1) : null,
  };
};

/**
 * Writing habits from structure alone: whether a text exists and how long it
 * is. The words are never read (§4.4) — this function has no access to them
 * beyond `length`.
 */
const writingSignature = (
  entries: DiaryEntry[],
  films: Map<number, Film>,
  evidence: Record<string, EvidenceRef[]>,
): WritingSignature | null => {
  const written = entries.filter((entry) => entry.hasText && entry.text);
  if (written.length < WRITING.minWritten) return null;

  const lengths = written.map((entry) => {
    const revisions = entry.text?.revisions ?? [];
    const selected = revisions.find((revision) => revision.id === entry.text?.selectedRevisionId);
    return (selected?.text ?? '').length;
  });

  const key = 'writing:signature';
  evidence[key] = evidenceOf(written, films, 'Запись с текстом', (_entry) => 1);

  return {
    writtenCount: written.length,
    writtenShare: round(written.length / entries.length),
    medianLength: Math.round(median(lengths)),
    longFormCount: lengths.filter((length) => length >= WRITING.longFormChars).length,
    evidenceKey: key,
  };
};

/* --- the engine ----------------------------------------------------------- */

export const computeTasteProfile = (input: TasteInput): TasteProfileSnapshot => {
  const entries = input.entries.filter((entry) => !entry.deletedAt);
  const rated = entries.filter((entry) => entry.overallRating > 0);
  const confidence = confidenceFor(rated.length);
  const sourceRevision = sourceRevisionOf(input);

  const base = {
    ...emptySnapshot(input.now),
    sourceRevision,
    diaryCount: entries.length,
    ratedCount: rated.length,
    writtenCount: entries.filter((entry) => entry.hasText).length,
    confidence,
  };

  // Below three ratings nothing personal is claimed at all (§8).
  if (confidence === 'insufficient') return base;

  const evidence: Record<string, EvidenceRef[]> = {};
  const baseline = mean(rated.map((entry) => entry.overallRating));

  const genres = genreSignals(rated, input.films, baseline, evidence);
  const directors = personSignals(rated, input.films, baseline, 'director', evidence);
  const actors = personSignals(rated, input.films, baseline, 'actor', evidence);
  const aspects = aspectSignature(rated, input.films, evidence);
  const behavior = ratingBehavior(rated, input.films, evidence);
  const eras = eraPreference(rated, input.films, evidence);
  const rhythm = viewingRhythm(entries, input.now);
  const writing = writingSignature(entries, input.films, evidence);

  const snapshot: TasteProfileSnapshot = {
    ...base,
    genreSignals: genres,
    directorSignals: directors,
    actorSignals: actors,
    aspectSignature: aspects,
    ratingBehavior: behavior,
    eraPreference: eras,
    viewingRhythm: rhythm,
    writingSignature: writing,
    evidenceIndex: evidence,
    headline: null,
  };

  return { ...snapshot, headline: buildHeadline(snapshot) };
};
