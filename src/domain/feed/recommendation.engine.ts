import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film, FilmSummary } from '@entities/film/film.model';
import type { FeedReason } from './feed.types';

/**
 * Which films to suggest, and what may honestly be said about why (P0.4 §13).
 *
 * Pure and deterministic: the same diary and the same candidates produce the
 * same order every time. `Math.random` has no place here — a feed that
 * reshuffles itself on every render is not a recommendation, it is a slot
 * machine.
 */

/** How a candidate arrived. The strongest real signal becomes the reason. */
export type CandidateSource = 'recommendations' | 'similar' | 'director' | 'genre' | 'trending';

export interface RecommendationCandidate {
  film: FilmSummary;
  source: CandidateSource;
  /** Which of the user's films produced this candidate. */
  seedFilmId: number | null;
  /** Position in the source list — TMDB's own ordering carries information. */
  sourceRank: number;
}

export interface SeedFilm {
  filmId: number;
  score: number;
  entry: DiaryEntry;
  film: Film | null;
}

export interface RankedRecommendation {
  candidate: RecommendationCandidate;
  score: number;
  reason: FeedReason;
}

export interface RankingInput {
  candidates: RecommendationCandidate[];
  seeds: SeedFilm[];
  /** Films by id, for director and genre comparisons. */
  films: Map<number, Film>;
  ratedFilmIds: Set<number>;
  suppressedFilmIds: Set<number>;
  watchlistFilmIds: Set<number>;
  /** Genres the user actually rates above their own average. */
  favouredGenres: Set<string>;
  limit?: number;
}

/** A rating this high is an endorsement worth building on (§13.3). */
export const SEED_MIN_SCORE = 4;
export const MAX_SEEDS = 5;

/**
 * The films worth recommending from: highly rated, most recent first. A low
 * score is not a negative seed, it is simply not a positive one.
 */
export const chooseSeeds = (entries: DiaryEntry[], films: Map<number, Film>): SeedFilm[] =>
  entries
    .filter((entry) => (entry.preciseRating || entry.overallRating) >= SEED_MIN_SCORE)
    .sort((left, right) => {
      // Recency first; a detailed entry with a strong aftertaste breaks ties.
      const byDate = right.updatedAt.localeCompare(left.updatedAt);
      if (byDate !== 0) return byDate;
      return (right.aspects.aftertaste ?? 0) - (left.aspects.aftertaste ?? 0);
    })
    .slice(0, MAX_SEEDS)
    .map((entry) => ({
      filmId: entry.filmId,
      score: entry.preciseRating || entry.overallRating,
      entry,
      film: films.get(entry.filmId) ?? null,
    }));

/* --- exclusions ---------------------------------------------------------- */

const isUsable = (film: FilmSummary): boolean => Boolean(film.id) && Boolean(film.title.trim());

/**
 * Everything that must never reach the feed (§13.4). Rated films are the
 * important one: recommending a film someone already has an opinion about is
 * the fastest way to look like nothing is being read.
 */
export const applyExclusions = (
  candidates: RecommendationCandidate[],
  input: Pick<RankingInput, 'ratedFilmIds' | 'suppressedFilmIds' | 'seeds'>,
): RecommendationCandidate[] => {
  const seedIds = new Set(input.seeds.map((seed) => seed.filmId));
  const seen = new Set<number>();

  return candidates.filter((candidate) => {
    const id = candidate.film.id;
    if (!isUsable(candidate.film)) return false;
    if (input.ratedFilmIds.has(id)) return false;
    if (input.suppressedFilmIds.has(id)) return false;
    if (seedIds.has(id)) return false;
    // The same film from two sources is one film.
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/* --- scoring ------------------------------------------------------------- */

const SOURCE_WEIGHT: Record<CandidateSource, number> = {
  recommendations: 3,
  similar: 2.4,
  director: 2.8,
  genre: 1.6,
  trending: 1,
};

/** A quality floor, never a reason. External ratings are not personal (§13.5). */
const qualityBonus = (film: FilmSummary): number => {
  if (film.voteCount < 50) return -0.6;
  if (film.rating >= 7.5) return 0.5;
  if (film.rating >= 6.5) return 0.2;
  if (film.rating > 0 && film.rating < 5.5) return -0.4;
  return 0;
};

const genreOverlap = (candidate: FilmSummary, favoured: Set<string>): number =>
  candidate.genres.filter((genre) => favoured.has(genre)).length;

const scoreCandidate = (candidate: RecommendationCandidate, input: RankingInput): number => {
  const seed = input.seeds.find((item) => item.filmId === candidate.seedFilmId);
  const seedFilm = seed?.film ?? null;
  const candidateFilm = input.films.get(candidate.film.id) ?? null;

  let score = SOURCE_WEIGHT[candidate.source];
  // TMDB's own ordering is information; it decays rather than cutting off.
  score += Math.max(0, 1 - candidate.sourceRank * 0.05);
  // A film the user loved carries more weight than one they merely liked.
  if (seed) score += (seed.score - SEED_MIN_SCORE) * 0.5;
  score += genreOverlap(candidate.film, input.favouredGenres) * 0.35;
  if (
    seedFilm &&
    candidateFilm &&
    seedFilm.director &&
    candidateFilm.director === seedFilm.director
  ) {
    score += 0.8;
  }
  // Already saved for later: it belongs in the watchlist lane, not here.
  if (input.watchlistFilmIds.has(candidate.film.id)) score -= 1.5;
  score += qualityBonus(candidate.film);

  return score;
};

/* --- reasons ------------------------------------------------------------- */

const titleOf = (films: Map<number, Film>, filmId: number | null, fallback: string): string =>
  (filmId !== null ? films.get(filmId)?.title : '') || fallback;

/**
 * The strongest *true* signal becomes the reason (§13.8). A director reason is
 * only produced when the director actually matches — never because the source
 * list happened to be called "similar".
 */
export const buildReason = (
  candidate: RecommendationCandidate,
  input: RankingInput,
  seedTitle?: string,
): FeedReason => {
  const seed = input.seeds.find((item) => item.filmId === candidate.seedFilmId);
  const seedFilm = seed?.film ?? null;
  const candidateFilm = input.films.get(candidate.film.id) ?? null;
  const source =
    seedTitle ?? titleOf(input.films, candidate.seedFilmId, seed?.entry.filmTitle ?? '');

  if (
    seedFilm?.director &&
    candidateFilm?.director &&
    candidateFilm.director === seedFilm.director
  ) {
    return {
      code: 'sameDirector',
      shortText: `Ещё один фильм ${seedFilm.director}`,
      sourceFilmIds: seed ? [seed.filmId] : [],
      sourcePersonIds: [],
      evidenceLabel: source || null,
    };
  }

  if (input.watchlistFilmIds.has(candidate.film.id)) {
    return {
      code: 'watchlist',
      shortText: 'Из твоего списка',
      sourceFilmIds: [],
      sourcePersonIds: [],
      evidenceLabel: null,
    };
  }

  if (candidate.source === 'trending') {
    return {
      code: 'trending',
      shortText: 'Сейчас часто смотрят',
      sourceFilmIds: [],
      sourcePersonIds: [],
      evidenceLabel: null,
    };
  }

  if (candidate.source === 'genre') {
    const shared = candidate.film.genres.find((genre) => input.favouredGenres.has(genre));
    if (shared) {
      return {
        code: 'genreAffinity',
        shortText: `${shared} у тебя обычно заходит`,
        sourceFilmIds: [],
        sourcePersonIds: [],
        evidenceLabel: shared,
      };
    }
  }

  if (seed && source) {
    return {
      code: seed.score >= 4.5 ? 'similarToHighlyRated' : 'relatedToRecentEntry',
      shortText:
        seed.score >= 4.5 ? `Похож на «${source}», который ты оценил высоко` : `После «${source}»`,
      sourceFilmIds: [seed.filmId],
      sourcePersonIds: [],
      evidenceLabel: source,
    };
  }

  // Nothing personal is known: say nothing personal (§13.10).
  return {
    code: 'popular',
    shortText: 'Заметный фильм',
    sourceFilmIds: [],
    sourcePersonIds: [],
    evidenceLabel: null,
  };
};

/* --- diversity ----------------------------------------------------------- */

/**
 * Greedy selection with a penalty for repetition (§13.7): the best remaining
 * candidate wins, but each pick makes its director, its genre and its seed
 * a little less attractive for the next one.
 */
export const diversify = (
  ranked: RankedRecommendation[],
  input: RankingInput,
  limit: number,
): RankedRecommendation[] => {
  const chosen: RankedRecommendation[] = [];
  const directorCount = new Map<string, number>();
  const genreCount = new Map<string, number>();
  const seedCount = new Map<number, number>();
  const pool = [...ranked];

  while (chosen.length < limit && pool.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    pool.forEach((item, index) => {
      const director = input.films.get(item.candidate.film.id)?.director ?? '';
      const penalty =
        (director ? (directorCount.get(director) ?? 0) * 1.2 : 0) +
        item.candidate.film.genres.reduce(
          (sum, genre) => sum + (genreCount.get(genre) ?? 0) * 0.3,
          0,
        ) +
        (item.candidate.seedFilmId !== null
          ? (seedCount.get(item.candidate.seedFilmId) ?? 0) * 0.7
          : 0);

      const adjusted = item.score - penalty;
      // Ties resolve by film id, so the order never depends on input order.
      if (
        adjusted > bestScore ||
        (adjusted === bestScore && item.candidate.film.id < pool[bestIndex]!.candidate.film.id)
      ) {
        bestScore = adjusted;
        bestIndex = index;
      }
    });

    const [picked] = pool.splice(bestIndex, 1);
    if (!picked) break;
    chosen.push(picked);

    const director = input.films.get(picked.candidate.film.id)?.director ?? '';
    if (director) directorCount.set(director, (directorCount.get(director) ?? 0) + 1);
    for (const genre of picked.candidate.film.genres) {
      genreCount.set(genre, (genreCount.get(genre) ?? 0) + 1);
    }
    if (picked.candidate.seedFilmId !== null) {
      seedCount.set(
        picked.candidate.seedFilmId,
        (seedCount.get(picked.candidate.seedFilmId) ?? 0) + 1,
      );
    }
  }

  return chosen;
};

/** Excludes, scores, explains and diversifies — the whole pipeline. */
export const rankCandidates = (input: RankingInput): RankedRecommendation[] => {
  const usable = applyExclusions(input.candidates, input);

  const ranked = usable
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, input),
      reason: buildReason(candidate, input),
    }))
    .sort(
      (left, right) => right.score - left.score || left.candidate.film.id - right.candidate.film.id,
    );

  return diversify(ranked, input, input.limit ?? 12);
};
