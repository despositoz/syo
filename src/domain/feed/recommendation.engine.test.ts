import { describe, expect, it } from 'vitest';
import {
  applyExclusions,
  buildReason,
  chooseSeeds,
  rankCandidates,
  type RankingInput,
  type RecommendationCandidate,
} from './recommendation.engine';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film, FilmSummary } from '@entities/film/film.model';
import { emptyAspects, type RatingValue } from '@domain/rating/rating.types';

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
  updatedAt: `2026-07-${String(10 + (filmId % 18)).padStart(2, '0')}T12:00:00.000Z`,
  clientMutationId: `mut-${filmId}`,
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

const candidate = (
  id: number,
  overrides: Partial<RecommendationCandidate> = {},
): RecommendationCandidate => ({
  film: summary(id),
  source: 'recommendations',
  seedFilmId: 1,
  sourceRank: 0,
  ...overrides,
});

const input = (overrides: Partial<RankingInput> = {}): RankingInput => ({
  candidates: [],
  seeds: [],
  films: new Map(),
  ratedFilmIds: new Set(),
  suppressedFilmIds: new Set(),
  watchlistFilmIds: new Set(),
  favouredGenres: new Set(),
  ...overrides,
});

describe('seeds', () => {
  it('takes only films the user actually liked', () => {
    const seeds = chooseSeeds([entry(1, 5), entry(2, 2), entry(3, 4)], new Map());
    expect(seeds.map((seed) => seed.filmId).sort()).toEqual([1, 3]);
  });

  it('does not treat a low score as a negative seed — it simply ignores it', () => {
    expect(chooseSeeds([entry(1, 1), entry(2, 2)], new Map())).toEqual([]);
  });

  it('prefers the most recent entries and never takes more than five', () => {
    const entries = Array.from({ length: 9 }, (_, index) => entry(index + 1, 5));
    const seeds = chooseSeeds(entries, new Map());
    expect(seeds).toHaveLength(5);
    expect(seeds[0]!.filmId).toBe(9);
  });
});

describe('exclusions', () => {
  const seeds = chooseSeeds([entry(1, 5)], new Map());

  it('drops a film the user has already rated', () => {
    const result = applyExclusions([candidate(42)], {
      ...input({ ratedFilmIds: new Set([42]) }),
      seeds,
    });
    expect(result).toEqual([]);
  });

  it('drops a film the user said they were not interested in', () => {
    const result = applyExclusions([candidate(42)], {
      ...input({ suppressedFilmIds: new Set([42]) }),
      seeds,
    });
    expect(result).toEqual([]);
  });

  it('collapses the same film arriving from two sources', () => {
    const result = applyExclusions(
      [candidate(42), candidate(42, { source: 'similar', sourceRank: 3 })],
      { ...input(), seeds },
    );
    expect(result).toHaveLength(1);
  });

  it('drops the seed itself', () => {
    const result = applyExclusions([candidate(1)], { ...input(), seeds });
    expect(result).toEqual([]);
  });

  it('drops a candidate with no title', () => {
    const result = applyExclusions([candidate(42, { film: summary(42, { title: '  ' }) })], {
      ...input(),
      seeds,
    });
    expect(result).toEqual([]);
  });

  it('keeps a candidate with no poster — typography can carry it', () => {
    const result = applyExclusions([candidate(42, { film: summary(42, { posterPath: '' }) })], {
      ...input(),
      seeds,
    });
    expect(result).toHaveLength(1);
  });
});

describe('reasons are only as strong as the evidence', () => {
  const seeds = chooseSeeds([entry(1, 5)], new Map([[1, film(1, { director: 'Вильнёв' })]]));

  it('names the director only when the director really matches', () => {
    const context = input({
      seeds,
      films: new Map([
        [1, film(1, { director: 'Вильнёв' })],
        [42, film(42, { director: 'Вильнёв' })],
      ]),
    });
    expect(buildReason(candidate(42), context).code).toBe('sameDirector');

    const different = input({
      seeds,
      films: new Map([
        [1, film(1, { director: 'Вильнёв' })],
        [42, film(42, { director: 'Нолан' })],
      ]),
    });
    expect(different.films.size).toBe(2);
    expect(buildReason(candidate(42), different).code).not.toBe('sameDirector');
  });

  it('claims a genre only when that genre is genuinely favoured', () => {
    const withAffinity = input({
      seeds,
      favouredGenres: new Set(['Фантастика']),
      films: new Map([[1, film(1)]]),
    });
    const scienceFiction = candidate(42, {
      source: 'genre',
      film: summary(42, { genres: ['Фантастика'] }),
    });
    expect(buildReason(scienceFiction, withAffinity).code).toBe('genreAffinity');

    const withoutAffinity = input({ seeds, films: new Map([[1, film(1)]]) });
    expect(buildReason(scienceFiction, withoutAffinity).code).not.toBe('genreAffinity');
  });

  it('keeps a trending reason impersonal', () => {
    const reason = buildReason(
      candidate(42, { source: 'trending', seedFilmId: null }),
      input({ films: new Map() }),
    );
    expect(reason.code).toBe('trending');
    expect(reason.shortText).toBe('Сейчас часто смотрят');
    expect(reason.sourceFilmIds).toEqual([]);
  });

  it('names the exact source film when there is one', () => {
    const context = input({ seeds, films: new Map([[1, film(1, { title: 'Дюна' })]]) });
    const reason = buildReason(candidate(42), context);
    expect(reason.shortText).toContain('Дюна');
    expect(reason.sourceFilmIds).toEqual([1]);
  });

  it('never promises how the user will feel', () => {
    const context = input({ seeds, films: new Map([[1, film(1, { title: 'Дюна' })]]) });
    for (const source of ['recommendations', 'similar', 'genre', 'trending'] as const) {
      const reason = buildReason(candidate(42, { source }), context);
      expect(reason.shortText).not.toMatch(/точно понравится|идеально|уверен|алгоритм/i);
    }
  });
});

describe('ranking', () => {
  it('is deterministic for the same inputs', () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      candidate(index + 10, { sourceRank: index }),
    );
    const context = input({ candidates, seeds: chooseSeeds([entry(1, 5)], new Map()) });

    const first = rankCandidates(context).map((item) => item.candidate.film.id);
    const second = rankCandidates({ ...context, candidates: [...candidates].reverse() }).map(
      (item) => item.candidate.film.id,
    );
    expect(first).toEqual(second);
  });

  it('spreads directors instead of stacking one', () => {
    const director = 'Вильнёв';
    const films = new Map([
      [1, film(1, { director })],
      ...[10, 11, 12, 13].map((id) => [id, film(id, { director })] as const),
      [20, film(20, { director: 'Другой' })],
    ]);
    const candidates = [10, 11, 12, 13, 20].map((id, index) =>
      candidate(id, { sourceRank: index }),
    );

    const ranked = rankCandidates(
      input({ candidates, films, seeds: chooseSeeds([entry(1, 5)], films), limit: 3 }),
    );

    // The other director gets in ahead of the fourth film by the same one.
    expect(ranked.map((item) => item.candidate.film.id)).toContain(20);
  });

  it('shows one film once', () => {
    const candidates = [candidate(42), candidate(42, { source: 'genre' }), candidate(43)];
    const ranked = rankCandidates(
      input({ candidates, seeds: chooseSeeds([entry(1, 5)], new Map()) }),
    );
    expect(new Set(ranked.map((item) => item.candidate.film.id)).size).toBe(ranked.length);
  });

  it('pushes an obscure candidate below a well-known one', () => {
    const strong = candidate(10, { film: summary(10, { rating: 7.8, voteCount: 4000 }) });
    const obscure = candidate(11, { film: summary(11, { rating: 4.5, voteCount: 12 }) });
    const ranked = rankCandidates(
      input({ candidates: [obscure, strong], seeds: chooseSeeds([entry(1, 5)], new Map()) }),
    );
    expect(ranked[0]!.candidate.film.id).toBe(10);
  });

  it('makes no personal claim at all on a cold start', () => {
    const ranked = rankCandidates(
      input({
        candidates: [candidate(10, { source: 'trending', seedFilmId: null })],
        seeds: [],
      }),
    );
    expect(ranked[0]!.reason.code).toBe('trending');
    expect(ranked[0]!.reason.sourceFilmIds).toEqual([]);
  });

  it('after a single rating, points at that exact film', () => {
    const films = new Map([[1, film(1, { title: 'Дюна' })]]);
    const ranked = rankCandidates(
      input({
        candidates: [candidate(10)],
        films,
        seeds: chooseSeeds([entry(1, 5)], films),
      }),
    );
    expect(ranked[0]!.reason.shortText).toContain('Дюна');
  });
});
