import { describe, expect, it } from 'vitest';
import { mapMovieDetails, mapMovieList, mapMovieSummary } from './tmdb.mappers';
import { tmdbMovieDetailsSchema, tmdbMovieSummarySchema } from './tmdb.schemas';
import { DEFAULT_ACCENT } from '@entities/film/film.model';

const rawSummary = {
  id: 693134,
  title: 'Дюна: Часть вторая',
  original_title: 'Dune: Part Two',
  original_language: 'en',
  release_date: '2024-02-27',
  overview: '  Пол Атрейдес объединяется с фременами.  ',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  vote_average: 8.14,
  vote_count: 6800,
  adult: false,
  genre_ids: [878, 12],
};

describe('tmdb summary mapper', () => {
  it('maps a raw payload into the app model', () => {
    const film = mapMovieSummary(tmdbMovieSummarySchema.parse(rawSummary));

    expect(film).toMatchObject({
      id: 693134,
      title: 'Дюна: Часть вторая',
      originalTitle: 'Dune: Part Two',
      year: '2024',
      posterPath: '/poster.jpg',
      rating: 8.1,
    });
    expect(film.overview).toBe('Пол Атрейдес объединяется с фременами.');
    expect(film.genres).toEqual(['Фантастика', 'Приключения']);
  });

  it('tolerates null fields without throwing', () => {
    const film = mapMovieSummary(
      tmdbMovieSummarySchema.parse({
        id: 1,
        title: null,
        name: 'Без постера',
        original_title: null,
        original_language: null,
        release_date: null,
        overview: null,
        poster_path: null,
        backdrop_path: null,
        vote_average: null,
        vote_count: null,
      }),
    );

    expect(film.title).toBe('Без постера');
    expect(film.year).toBe('');
    expect(film.posterPath).toBe('');
    expect(film.rating).toBe(0);
    expect(film.accent).toEqual(DEFAULT_ACCENT);
  });

  it('derives a genre accent instead of a random colour', () => {
    const horror = mapMovieSummary(
      tmdbMovieSummarySchema.parse({ ...rawSummary, genre_ids: [27] }),
    );
    expect(horror.accent.hex).toBe('#78343d');
  });

  it('drops adult titles, duplicates and untitled rows', () => {
    const films = mapMovieList([
      { ...rawSummary, id: 1 },
      { ...rawSummary, id: 1 },
      { ...rawSummary, id: 2, adult: true },
      { ...rawSummary, id: 3, title: '', name: '' },
      { ...rawSummary, id: 4 },
    ]);

    expect(films.map((film) => film.id)).toEqual([1, 4]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ ...rawSummary, id: index + 1 }));
    expect(mapMovieList(many, 5)).toHaveLength(5);
  });
});

describe('tmdb details mapper', () => {
  const rawDetails = {
    ...rawSummary,
    runtime: 166,
    tagline: 'Долг зовёт',
    budget: 190_000_000,
    revenue: 711_000_000,
    genres: [{ id: 878, name: 'Фантастика' }],
    production_countries: [{ iso_3166_1: 'US', name: 'США' }],
    production_companies: [{ id: 1, name: 'Legendary' }],
    credits: {
      cast: [
        { id: 2, name: 'Зендея', character: 'Чани', profile_path: '/z.jpg', order: 1 },
        { id: 1, name: 'Тимоти Шаламе', character: 'Пол', profile_path: '/t.jpg', order: 0 },
        { id: 3, name: 'Без фото', character: 'Гость', profile_path: null, order: 2 },
      ],
      crew: [
        { id: 9, name: 'Ханс Циммер', job: 'Original Music Composer', department: 'Sound' },
        { id: 10, name: 'Дени Вильнёв', job: 'Director', department: 'Directing' },
      ],
    },
    images: {
      logos: [
        {
          file_path: '/logo.png',
          iso_639_1: 'ru',
          width: 800,
          height: 260,
          aspect_ratio: 3.07,
          vote_average: 5.3,
          vote_count: 3,
        },
      ],
    },
  };

  it('extracts director, ordered cast and logo candidates', () => {
    const film = mapMovieDetails(tmdbMovieDetailsSchema.parse(rawDetails));

    expect(film.director).toBe('Дени Вильнёв');
    expect(film.cast.map((person) => person.name)).toEqual(['Тимоти Шаламе', 'Зендея']);
    expect(film.logoCandidates).toHaveLength(1);
    expect(film.logoCandidates[0]?.language).toBe('ru');
    expect(film.runtime).toBe(166);
    expect(film.detailed).toBe(true);
  });

  it('never erases cached values with empty ones', () => {
    const previous = mapMovieDetails(tmdbMovieDetailsSchema.parse(rawDetails));
    const stripped = mapMovieDetails(
      tmdbMovieDetailsSchema.parse({
        ...rawDetails,
        overview: null,
        poster_path: null,
        credits: { cast: [], crew: [] },
        images: { logos: [] },
      }),
      previous,
    );

    expect(stripped.overview).toBe(previous.overview);
    expect(stripped.posterPath).toBe('/poster.jpg');
    expect(stripped.cast).toEqual(previous.cast);
    expect(stripped.logoCandidates).toEqual(previous.logoCandidates);
  });
});
