import { describe, expect, it } from 'vitest';
import { deriveMilestones, deriveObservations, type InsightInput } from './insight.engine';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film } from '@entities/film/film.model';
import { emptyAspects } from '@domain/rating/rating.types';
import type { RatingValue } from '@domain/rating/rating.types';

/**
 * The engine's whole job is to refuse to say things it cannot prove, so most
 * of these tests are about silence: not enough films, not enough difference,
 * not enough data — no claim.
 */

const film = (id: number, overrides: Partial<Film> = {}): Film =>
  ({
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
    voteCount: 100,
    accent: { hex: '#000', rgb: '0, 0, 0' },
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
  createdAt: `2026-07-${String(10 + (filmId % 18)).padStart(2, '0')}T12:00:00.000Z`,
  updatedAt: '2026-07-10T12:00:00.000Z',
  clientMutationId: `mut-${filmId}`,
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

const input = (entries: DiaryEntry[], films: Film[] = [], sourceRevision = 1): InsightInput => ({
  entries,
  films: new Map(films.map((item) => [item.id, item])),
  now: '2026-08-03T10:00:00.000Z',
  sourceRevision,
});

/** N films of one genre at the given scores, plus filler at 3. */
const genreLibrary = (genre: string, scores: number[], fillerScores: number[]) => {
  const films = [
    ...scores.map((_, index) => film(index + 1, { genres: [genre] })),
    ...fillerScores.map((_, index) => film(100 + index, { genres: ['Другое'] })),
  ];
  const entries = [
    ...scores.map((score, index) => entry(index + 1, score)),
    ...fillerScores.map((score, index) => entry(100 + index, score)),
  ];
  return { films, entries };
};

describe('nothing is said without data', () => {
  it('says nothing at all about an empty diary', () => {
    expect(deriveObservations(input([]))).toEqual([]);
  });

  it('two films of a genre do not make a pattern', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5], [3, 3, 3, 3]);
    const observations = deriveObservations(input(entries, films));
    expect(observations.filter((item) => item.observationCode === 'genreAffinity')).toHaveLength(0);
  });

  it('three genre films with too small a diary still say nothing', () => {
    // Six ratings is the floor for any taste claim at all.
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 5], [3, 3]);
    expect(deriveObservations(input(entries, films))).toEqual([]);
  });

  it('a difference smaller than the threshold is not a claim', () => {
    // 4.0 vs 3.8 overall — real, but not worth telling someone about.
    const { films, entries } = genreLibrary('Драма', [4, 4, 4], [3.7, 3.7, 3.7]);
    const observations = deriveObservations(input(entries, films));
    expect(observations.filter((item) => item.observationCode === 'genreAffinity')).toHaveLength(0);
  });
});

describe('genre affinity', () => {
  it('is claimed once the threshold is genuinely crossed', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 4.6], [3, 3, 3]);
    const [observation] = deriveObservations(input(entries, films)).filter(
      (item) => item.observationCode === 'genreAffinity',
    );

    expect(observation).toBeDefined();
    expect(observation!.headline).toContain('Фантастика');
    expect(observation!.evidence.filmIds.length).toBeGreaterThanOrEqual(3);
    expect(observation!.evidence.sampleSize).toBe(3);
    expect(observation!.evidence.values.genreAverage).toBeGreaterThan(
      observation!.evidence.values.overallAverage as number,
    );
  });

  it('stays medium confidence until there are five films', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 4.6], [3, 3, 3]);
    const [observation] = deriveObservations(input(entries, films)).filter(
      (item) => item.observationCode === 'genreAffinity',
    );
    expect(observation!.confidence).toBe('medium');

    const wide = genreLibrary('Фантастика', [5, 5, 5, 5, 4.6], [3, 3, 3]);
    const [stronger] = deriveObservations(input(wide.entries, wide.films)).filter(
      (item) => item.observationCode === 'genreAffinity',
    );
    expect(stronger!.confidence).toBe('high');
  });

  it('names the tension without insulting anyone', () => {
    const { films, entries } = genreLibrary('Хоррор', [2, 2, 2, 2], [4.5, 4.5, 4.5, 4.5]);
    const [tension] = deriveObservations(input(entries, films)).filter(
      (item) => item.observationCode === 'genreTension',
    );

    expect(tension).toBeDefined();
    expect(tension!.headline).toContain('Хоррор');
    expect(tension!.headline).not.toMatch(/не понимаешь|плохо разбираешься/i);
  });
});

describe('director and actor', () => {
  const director = 'Дени Вильнёв';

  it('two films by one director are not an affinity', () => {
    const films = [film(1, { director }), film(2, { director }), film(3, {}), film(4, {})];
    const entries = [entry(1, 5), entry(2, 5), entry(3, 3), entry(4, 3)];
    const observations = deriveObservations(input(entries, films));
    expect(observations.filter((item) => item.observationCode === 'directorAffinity')).toHaveLength(
      0,
    );
  });

  it('three qualifying films are', () => {
    const films = [
      film(1, { director }),
      film(2, { director }),
      film(3, { director }),
      film(4, {}),
    ];
    const entries = [entry(1, 5), entry(2, 4.6), entry(3, 4.4), entry(4, 3)];
    const [observation] = deriveObservations(input(entries, films)).filter(
      (item) => item.observationCode === 'directorAffinity',
    );

    expect(observation!.headline).toContain(director);
    expect(observation!.evidence.filmIds).toHaveLength(3);
  });

  it('skips films whose director was never cached', () => {
    // Three films, no director data anywhere: no claim, no crash.
    const films = [film(1), film(2), film(3)];
    const entries = [entry(1, 5), entry(2, 5), entry(3, 5)];
    expect(
      deriveObservations(input(entries, films)).filter(
        (item) => item.observationCode === 'directorAffinity',
      ),
    ).toHaveLength(0);
  });

  it('needs three films before it mentions an actor', () => {
    const actor = { id: 7, name: 'Тильда Суинтон', character: '', profilePath: '' };
    const twoFilms = [film(1, { cast: [actor] }), film(2, { cast: [actor] }), film(3, {})];
    expect(
      deriveObservations(input([entry(1, 5), entry(2, 5), entry(3, 2)], twoFilms)).filter(
        (item) => item.observationCode === 'actorRecurrence',
      ),
    ).toHaveLength(0);

    const threeFilms = [...twoFilms, film(4, { cast: [actor] })];
    const [observation] = deriveObservations(
      input([entry(1, 5), entry(2, 5), entry(3, 2), entry(4, 5)], threeFilms),
    ).filter((item) => item.observationCode === 'actorRecurrence');

    expect(observation!.headline).toContain('Тильда Суинтон');
    expect(observation!.headline).not.toMatch(/любим/i);
  });
});

describe('aspect signature', () => {
  const deep = (filmId: number, aspects: Record<string, number>): DiaryEntry =>
    entry(filmId, 4, {
      mode: 'deep',
      aspects: { ...emptyAspects(), ...aspects } as DiaryEntry['aspects'],
    });

  it('ignores quick ratings entirely', () => {
    const entries = Array.from({ length: 6 }, (_, index) => entry(index + 1, 4));
    expect(
      deriveObservations(input(entries)).filter(
        (item) => item.observationCode === 'aspectSignature',
      ),
    ).toHaveLength(0);
  });

  it('needs five detailed entries', () => {
    const four = Array.from({ length: 4 }, (_, index) =>
      deep(index + 1, { direction: 5, story: 2, characters: 2, sound: 2, aftertaste: 2 }),
    );
    expect(
      deriveObservations(input(four)).filter((item) => item.observationCode === 'aspectSignature'),
    ).toHaveLength(0);

    const five = Array.from({ length: 5 }, (_, index) =>
      deep(index + 1, { direction: 5, story: 2, characters: 2, sound: 2, aftertaste: 2 }),
    );
    const [observation] = deriveObservations(input(five)).filter(
      (item) => item.observationCode === 'aspectSignature',
    );
    expect(observation!.headline).toContain('Режиссура');
    // A statement about the ratings, never about the person.
    expect(observation!.headline).not.toMatch(/^Ты /);
  });
});

describe('writing depth', () => {
  const withText = (filmId: number, length: number): DiaryEntry =>
    entry(filmId, 4, {
      hasText: true,
      text: {
        selectedRevisionId: 'rev-1',
        revisions: [
          {
            id: 'rev-1',
            parentRevisionId: null,
            kind: 'user',
            origin: 'manual',
            text: 'а'.repeat(length),
            changeSummary: null,
            createdAt: '2026-07-10T12:00:00.000Z',
            promptVersion: null,
            requestId: null,
          },
        ],
        conversation: null,
        spoiler: false,
      },
    });

  it('needs four texts', () => {
    const three = [withText(1, 500), withText(2, 400), withText(3, 300)];
    expect(
      deriveObservations(input(three)).filter((item) => item.observationCode === 'writingDepth'),
    ).toHaveLength(0);
  });

  it('ranks by length alone and says nothing about why', () => {
    const entries = [withText(1, 100), withText(2, 900), withText(3, 500), withText(4, 300)];
    const [observation] = deriveObservations(input(entries)).filter(
      (item) => item.observationCode === 'writingDepth',
    );

    expect(observation!.evidence.filmIds).toEqual([2, 3, 4]);
    expect(observation!.supportingText).toBeNull();
    // Nothing from the text itself may appear anywhere in the item.
    expect(JSON.stringify(observation)).not.toContain('аааа');
  });
});

describe('identity and evidence', () => {
  it('gives the same observation the same id across runs', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 4.6], [3, 3, 3]);
    const first = deriveObservations(input(entries, films, 27));
    const second = deriveObservations(input(entries, films, 27));
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
  });

  it('changes the id when the diary has moved on', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 4.6], [3, 3, 3]);
    const before = deriveObservations(input(entries, films, 27))[0]!;
    const after = deriveObservations(input(entries, films, 28))[0]!;
    expect(before.id).not.toBe(after.id);
  });

  it('never produces an observation without evidence', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 4.6], [3, 3, 3]);
    for (const observation of deriveObservations(input(entries, films))) {
      expect(observation.evidence.filmIds.length).toBeGreaterThan(0);
      expect(observation.evidence.sampleSize).toBeGreaterThan(0);
      expect(observation.evidence.calculationVersion).toBe(1);
    }
  });

  it('never claims certainty it does not have', () => {
    const { films, entries } = genreLibrary('Фантастика', [5, 5, 4.6], [3, 3, 3]);
    for (const observation of deriveObservations(input(entries, films))) {
      expect(observation.headline).not.toMatch(/точно|наверняка|идеально|обожаешь/i);
      if (observation.confidence === 'medium') {
        expect(observation.headline).not.toMatch(/всегда|никогда/i);
      }
    }
  });
});

describe('milestones', () => {
  it('marks the very first rating', () => {
    const milestones = deriveMilestones(input([entry(1, 4)]));
    expect(milestones.map((item) => item.milestoneCode)).toContain('ratings:1');
  });

  it('counts real films, not app opens', () => {
    const entries = Array.from({ length: 25 }, (_, index) => entry(index + 1, 4));
    const codes = deriveMilestones(input(entries)).map((item) => item.milestoneCode);
    expect(codes).toContain('ratings:10');
    expect(codes).toContain('ratings:25');
    expect(codes).not.toContain('ratings:50');
  });

  it('keeps a stable id, so the same milestone is never new twice', () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry(index + 1, 4));
    const first = deriveMilestones(input(entries, [], 4));
    const later = deriveMilestones(input(entries, [], 9));
    expect(first.map((item) => item.id)).toEqual(later.map((item) => item.id));
  });

  it('celebrates a third film of one director, exactly at the third', () => {
    const director = 'Дени Вильнёв';
    const films = [film(1, { director }), film(2, { director }), film(3, { director })];
    const two = deriveMilestones(input([entry(1, 4), entry(2, 4)], films));
    expect(two.some((item) => item.milestoneCode.startsWith('director:'))).toBe(false);

    const three = deriveMilestones(input([entry(1, 4), entry(2, 4), entry(3, 4)], films));
    const milestone = three.find((item) => item.milestoneCode.startsWith('director:'))!;
    expect(milestone.headline).toBe(`Третий фильм ${director}`);
  });

  it('never sounds like a game', () => {
    const entries = Array.from({ length: 25 }, (_, index) => entry(index + 1, 4));
    for (const milestone of deriveMilestones(input(entries))) {
      expect(milestone.headline).not.toMatch(/уровн|киноман|достижени|очк/i);
    }
  });
});
