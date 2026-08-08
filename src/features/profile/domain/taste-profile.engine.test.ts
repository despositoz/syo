import { describe, expect, it } from 'vitest';
import { computeTasteProfile, sourceRevisionOf, type TasteInput } from './taste-profile.engine';
import type { DiaryEntry } from '@domain/diary/diary.types';
import type { Film } from '@entities/film/film.model';
import { emptyAspects, type RatingValue } from '@domain/rating/rating.types';

const NOW = '2026-08-09T12:00:00.000Z';

const film = (id: number, overrides: Partial<Film> = {}): Film =>
  ({
    id,
    title: `Фильм ${id}`,
    originalTitle: `Movie ${id}`,
    year: '2020',
    releaseDate: '2020-05-01',
    genres: ['драма'],
    posterPath: '/p.jpg',
    backdropPath: '/b.jpg',
    overview: '',
    rating: 7,
    voteCount: 500,
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
  releaseYear: '2020',
  mode: 'quick',
  overallRating: score as RatingValue,
  preciseRating: score,
  aspects: emptyAspects(),
  hasText: false,
  text: null,
  watchedAt: `2026-07-${String((filmId % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  createdAt: `2026-07-${String((filmId % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  updatedAt: `2026-07-${String((filmId % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  clientMutationId: `mut-${filmId}`,
  revision: 1,
  syncStatus: 'local',
  deletedAt: null,
  ...overrides,
});

const input = (
  entries: DiaryEntry[],
  films: Film[] = [],
  favorites: number[] = [],
): TasteInput => ({
  entries,
  films: new Map(films.map((item) => [item.id, item])),
  favoriteFilmIds: favorites,
  now: NOW,
});

/** A believable archive: sci-fi rated high, the rest ordinary. */
const archive = (count: number) => {
  const entries: DiaryEntry[] = [];
  const films: Film[] = [];
  for (let index = 0; index < count; index += 1) {
    const sci = index % 2 === 0;
    films.push(
      film(100 + index, {
        genres: sci ? ['фантастика', 'драма'] : ['драма'],
        director: index % 3 === 0 ? 'Дени Вильнёв' : `Режиссёр ${index}`,
      }),
    );
    entries.push(entry(100 + index, sci ? 5 : 3));
  }
  return { entries, films };
};

describe('how much data is enough', () => {
  it('says nothing personal with no ratings at all', () => {
    const snapshot = computeTasteProfile(input([]));

    expect(snapshot.confidence).toBe('insufficient');
    expect(snapshot.headline).toBeNull();
    expect(snapshot.genreSignals).toHaveLength(0);
    expect(Object.keys(snapshot.evidenceIndex)).toHaveLength(0);
  });

  it('says nothing personal with two ratings', () => {
    const { entries, films } = archive(2);
    const snapshot = computeTasteProfile(input(entries, films));

    expect(snapshot.confidence).toBe('insufficient');
    expect(snapshot.headline).toBeNull();
  });

  it('is forming at three ratings and hedges what it says', () => {
    const { entries, films } = archive(3);
    const snapshot = computeTasteProfile(input(entries, films));

    expect(snapshot.confidence).toBe('forming');
    // Three films is not a taste; the copy must not pretend otherwise.
    expect(snapshot.headline?.text).toMatch(/Пока|складывается/);
  });

  it('is still forming at fourteen and stable at fifteen', () => {
    const fourteen = archive(14);
    const fifteen = archive(15);

    expect(computeTasteProfile(input(fourteen.entries, fourteen.films)).confidence).toBe('forming');
    expect(computeTasteProfile(input(fifteen.entries, fifteen.films)).confidence).toBe('stable');
  });
});

describe('determinism', () => {
  it('gives the same revision for the same archive', () => {
    const { entries, films } = archive(8);
    const first = computeTasteProfile(input(entries, films));
    const second = computeTasteProfile(input([...entries].reverse(), films));

    // Order of the array is not a change to the archive.
    expect(second.sourceRevision).toBe(first.sourceRevision);
    expect(second.headline?.text).toBe(first.headline?.text);
    expect(second.genreSignals).toEqual(first.genreSignals);
  });

  it('changes the revision when a rating changes', () => {
    const { entries, films } = archive(8);
    const before = sourceRevisionOf(input(entries, films));

    const changed = entries.map((item, index) =>
      index === 0 ? { ...item, overallRating: 1 as RatingValue, revision: 2 } : item,
    );
    expect(sourceRevisionOf(input(changed, films))).not.toBe(before);
  });

  it('changes the revision when the favourites are rearranged', () => {
    const { entries, films } = archive(8);
    expect(sourceRevisionOf(input(entries, films, [1, 2]))).not.toBe(
      sourceRevisionOf(input(entries, films, [2, 1])),
    );
  });
});

describe('genre signals', () => {
  it('needs a real archive before any genre means anything', () => {
    const { entries, films } = archive(5);
    expect(computeTasteProfile(input(entries, films)).genreSignals).toHaveLength(0);
  });

  it('finds the genre that sits above the personal average', () => {
    const { entries, films } = archive(10);
    const snapshot = computeTasteProfile(input(entries, films));

    const sci = snapshot.genreSignals.find((signal) => signal.genre === 'фантастика');
    expect(sci?.kind).toBe('affinity');
    expect(sci!.support).toBeGreaterThanOrEqual(3);
    expect(sci!.delta).toBeGreaterThan(0);
  });

  it('never calls a genre a favourite on the strength of one film', () => {
    const { entries, films } = archive(8);
    films.push(film(999, { genres: ['вестерн'] }));
    entries.push(entry(999, 5));

    const snapshot = computeTasteProfile(input(entries, films));
    expect(snapshot.genreSignals.some((signal) => signal.genre === 'вестерн')).toBe(false);
  });

  it('describes a low-scoring genre as tension, not as dislike', () => {
    const entries: DiaryEntry[] = [];
    const films: Film[] = [];
    for (let index = 0; index < 6; index += 1) {
      films.push(film(200 + index, { genres: ['драма'] }));
      entries.push(entry(200 + index, 5));
    }
    for (let index = 0; index < 4; index += 1) {
      films.push(film(300 + index, { genres: ['ужасы'] }));
      entries.push(entry(300 + index, 2));
    }

    const snapshot = computeTasteProfile(input(entries, films));
    const horror = snapshot.genreSignals.find((signal) => signal.genre === 'ужасы');
    expect(horror?.kind).toBe('tension');
    expect(snapshot.headline?.text).not.toMatch(/не любишь|плохо|ничего не понимаешь/i);
  });
});

describe('people', () => {
  it('needs two strong films before naming a director', () => {
    const { entries, films } = archive(8);
    const director = computeTasteProfile(input(entries, films)).directorSignals[0];

    expect(director?.name).toBe('Дени Вильнёв');
    expect(director!.support).toBeGreaterThanOrEqual(2);
  });

  it('skips films whose metadata never arrived', () => {
    const { entries } = archive(8);
    // No cached films at all: nothing to attribute, and no crash.
    const snapshot = computeTasteProfile(input(entries, []));

    expect(snapshot.directorSignals).toHaveLength(0);
    expect(snapshot.genreSignals).toHaveLength(0);
    expect(snapshot.ratingBehavior).not.toBeNull();
  });

  it('does not claim an actor matters when the films are ordinary', () => {
    const entries: DiaryEntry[] = [];
    const films: Film[] = [];
    for (let index = 0; index < 9; index += 1) {
      films.push(
        film(400 + index, {
          cast: [
            { id: 1, name: 'Актриса Тест', character: 'Она', profilePath: '' },
          ] as Film['cast'],
        }),
      );
      // Every film is exactly average, so recurrence says nothing.
      entries.push(entry(400 + index, 3));
    }

    expect(computeTasteProfile(input(entries, films)).actorSignals).toHaveLength(0);
  });
});

describe('aspects', () => {
  const deepEntry = (filmId: number, aspects: Record<string, number>) =>
    entry(filmId, 4, {
      mode: 'deep',
      aspects: aspects as never,
      preciseRating:
        Object.values(aspects).reduce((a, b) => a + b, 0) / Object.values(aspects).length,
    });

  const deepArchive = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      deepEntry(500 + index, {
        story: 3,
        characters: 3,
        direction: 5,
        sound: 2,
        aftertaste: 4,
      }),
    );

  it('is built only from detailed ratings', () => {
    const quickOnly = Array.from({ length: 10 }, (_, index) => entry(600 + index, 4));
    expect(computeTasteProfile(input(quickOnly)).aspectSignature).toBeNull();
  });

  it('needs five detailed entries', () => {
    expect(computeTasteProfile(input(deepArchive(4))).aspectSignature).toBeNull();
    expect(computeTasteProfile(input(deepArchive(5))).aspectSignature).not.toBeNull();
  });

  it('names the aspect that leads and the one judged hardest', () => {
    const signature = computeTasteProfile(input(deepArchive(6))).aspectSignature!;

    expect(signature.leadAspect).toBe('direction');
    expect(signature.strictestAspect).toBe('sound');
  });

  it('says nothing when no aspect stands out', () => {
    const flat = Array.from({ length: 6 }, (_, index) =>
      deepEntry(700 + index, { story: 4, characters: 4, direction: 4, sound: 4, aftertaste: 4 }),
    );
    expect(computeTasteProfile(input(flat)).aspectSignature).toBeNull();
  });
});

describe('evidence', () => {
  it('every signal carries the films it came from', () => {
    const { entries, films } = archive(12);
    const snapshot = computeTasteProfile(input(entries, films));

    const keys = [
      ...snapshot.genreSignals.map((signal) => signal.evidenceKey),
      ...snapshot.directorSignals.map((signal) => signal.evidenceKey),
      snapshot.ratingBehavior?.evidenceKey,
    ].filter(Boolean) as string[];

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(snapshot.evidenceIndex[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('evidence points at entries that actually exist', () => {
    const { entries, films } = archive(10);
    const snapshot = computeTasteProfile(input(entries, films));
    const ids = new Set(entries.map((item) => item.id));

    for (const refs of Object.values(snapshot.evidenceIndex)) {
      for (const ref of refs) expect(ids.has(ref.diaryEntryId)).toBe(true);
    }
  });

  it('a headline that claims something has evidence behind it', () => {
    const { entries, films } = archive(16);
    const snapshot = computeTasteProfile(input(entries, films));

    if (snapshot.headline && snapshot.headline.templateId !== 'forming') {
      expect(snapshot.headline.evidenceKeys.length).toBeGreaterThan(0);
      for (const key of snapshot.headline.evidenceKeys) {
        expect(snapshot.evidenceIndex[key]).toBeDefined();
      }
    }
  });
});

describe('the archive itself', () => {
  it('ignores a deleted entry', () => {
    const { entries, films } = archive(10);
    const withDeleted = entries.map((item, index) =>
      index === 0 ? { ...item, deletedAt: '2026-08-01T00:00:00.000Z' } : item,
    );

    expect(computeTasteProfile(input(withDeleted, films)).ratedCount).toBe(entries.length - 1);
  });

  it('comes back unchanged when a deletion is undone', () => {
    const { entries, films } = archive(10);
    const before = computeTasteProfile(input(entries, films));

    const deleted = entries.map((item, index) =>
      index === 0 ? { ...item, deletedAt: '2026-08-01T00:00:00.000Z' } : item,
    );
    const restored = deleted.map((item) => ({ ...item, deletedAt: null }));

    expect(computeTasteProfile(input(restored, films)).sourceRevision).toBe(before.sourceRevision);
  });

  it('reads only the length of a text, never its words', () => {
    const { entries, films } = archive(8);
    const withText = entries.map((item, index) =>
      index < 4
        ? {
            ...item,
            hasText: true,
            text: {
              selectedRevisionId: 'r1',
              revisions: [
                {
                  id: 'r1',
                  parentRevisionId: null,
                  kind: 'user' as const,
                  origin: 'manual' as const,
                  text: 'Это очень личная запись о фильме, которую нельзя анализировать',
                  changeSummary: null,
                  createdAt: NOW,
                  promptVersion: null,
                  requestId: null,
                },
              ],
              conversation: null,
              spoiler: false,
            },
          }
        : item,
    );

    const snapshot = computeTasteProfile(input(withText, films));
    expect(snapshot.writingSignature?.writtenCount).toBe(4);
    expect(snapshot.writingSignature?.medianLength).toBeGreaterThan(0);
    // Nothing anywhere in the snapshot quotes what was written.
    expect(JSON.stringify(snapshot)).not.toContain('очень личная запись');
  });

  it('handles the same film rated twice without counting it twice in a genre', () => {
    const { entries, films } = archive(8);
    const duplicate = [...entries, { ...entries[0]!, id: 'entry-duplicate' }];

    const snapshot = computeTasteProfile(input(duplicate, films));
    expect(snapshot.ratedCount).toBe(9);
    // The film appears once per evidence list, not twice.
    for (const refs of Object.values(snapshot.evidenceIndex)) {
      const filmIds = refs.map((ref) => ref.filmId);
      expect(new Set(filmIds).size).toBe(filmIds.length);
    }
  });
});
