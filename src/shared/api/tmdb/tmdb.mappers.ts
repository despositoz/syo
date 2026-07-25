import {
  accentForGenres,
  emptyFilm,
  type Film,
  type FilmCastMember,
  type FilmLogoCandidate,
  type FilmSummary,
} from '@entities/film/film.model';
import type { TmdbLogo, TmdbMovieDetails, TmdbMovieSummary } from './tmdb.schemas';

/** TMDB movie genre ids are stable; keeping them local avoids an extra request. */
const GENRE_NAMES: Record<number, string> = {
  28: 'Боевик',
  12: 'Приключения',
  16: 'Мультфильм',
  35: 'Комедия',
  80: 'Криминал',
  99: 'Документальный',
  18: 'Драма',
  10751: 'Семейный',
  14: 'Фэнтези',
  36: 'История',
  27: 'Ужасы',
  10402: 'Музыка',
  9648: 'Детектив',
  10749: 'Мелодрама',
  878: 'Фантастика',
  10770: 'Телефильм',
  53: 'Триллер',
  10752: 'Военный',
  37: 'Вестерн',
};

const yearOf = (releaseDate: string): string =>
  /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : '';

const genreNames = (movie: TmdbMovieSummary): string[] => {
  const fromObjects = (movie.genres ?? []).map((genre) => genre.name).filter(Boolean);
  if (fromObjects.length) return fromObjects;
  return (movie.genre_ids ?? [])
    .map((id) => GENRE_NAMES[id])
    .filter((name): name is string => Boolean(name));
};

export const mapMovieSummary = (movie: TmdbMovieSummary): FilmSummary => {
  const genres = genreNames(movie);
  return {
    id: movie.id,
    title: movie.title || movie.name || 'Без названия',
    originalTitle: movie.original_title,
    year: yearOf(movie.release_date),
    releaseDate: movie.release_date,
    genres,
    posterPath: movie.poster_path,
    backdropPath: movie.backdrop_path,
    overview: movie.overview.trim(),
    rating: Number(movie.vote_average.toFixed(1)),
    voteCount: movie.vote_count,
    accent: accentForGenres(genres),
  };
};

/** Drops adult titles and entries too broken to render. */
export const mapMovieList = (results: unknown[], limit = 20): FilmSummary[] => {
  const seen = new Set<number>();
  const films: FilmSummary[] = [];
  for (const raw of results) {
    const candidate = raw as Partial<TmdbMovieSummary> & { adult?: boolean | null };
    if (!candidate || typeof candidate.id !== 'number') continue;
    if (candidate.adult) continue;
    if (seen.has(candidate.id)) continue;
    const parsed = safeParseSummary(candidate);
    if (!parsed) continue;
    seen.add(parsed.id);
    films.push(parsed);
    if (films.length >= limit) break;
  }
  return films;
};

const safeParseSummary = (candidate: unknown): FilmSummary | null => {
  const movie = candidate as TmdbMovieSummary;
  const title = movie.title || movie.name;
  if (!title) return null;
  return mapMovieSummary({
    ...movie,
    title: movie.title ?? title,
    original_title: movie.original_title ?? '',
    original_language: movie.original_language ?? '',
    release_date: movie.release_date ?? '',
    overview: movie.overview ?? '',
    poster_path: movie.poster_path ?? '',
    backdrop_path: movie.backdrop_path ?? '',
    vote_average: movie.vote_average ?? 0,
    vote_count: movie.vote_count ?? 0,
  });
};

export const mapLogoCandidate = (logo: TmdbLogo): FilmLogoCandidate | null => {
  if (!logo.file_path) return null;
  const width = logo.width;
  const height = logo.height;
  const aspectRatio = logo.aspect_ratio || (width && height ? width / height : 0);
  return {
    filePath: logo.file_path,
    language: logo.iso_639_1 ?? null,
    width,
    height,
    aspectRatio,
    voteAverage: logo.vote_average,
    voteCount: logo.vote_count,
  };
};

const mapCast = (details: TmdbMovieDetails): FilmCastMember[] =>
  (details.credits?.cast ?? [])
    .filter((person) => person.name && person.profile_path)
    .sort((left, right) => left.order - right.order)
    .slice(0, 10)
    .map((person) => ({
      id: person.id,
      name: person.name,
      character: person.character,
      profilePath: person.profile_path,
    }));

const mapDirector = (details: TmdbMovieDetails): string =>
  (details.credits?.crew ?? []).find((person) => person.job === 'Director')?.name ?? '';

export const mapMovieDetails = (details: TmdbMovieDetails, previous?: Film | null): Film => {
  const summary = mapMovieSummary(details);
  const base = previous ?? emptyFilm(details.id, summary.title);
  const logoCandidates = (details.images?.logos ?? [])
    .map(mapLogoCandidate)
    .filter((candidate): candidate is FilmLogoCandidate => candidate !== null);

  return {
    ...base,
    ...summary,
    // A detailed payload with an empty field must not erase a good cached value.
    overview: summary.overview || base.overview,
    posterPath: summary.posterPath || base.posterPath,
    backdropPath: summary.backdropPath || base.backdropPath,
    genres: summary.genres.length ? summary.genres : base.genres,
    accent: summary.genres.length ? summary.accent : base.accent,
    runtime: details.runtime || base.runtime,
    director: mapDirector(details) || base.director,
    cast: mapCast(details).length ? mapCast(details) : base.cast,
    logoCandidates: logoCandidates.length ? logoCandidates : base.logoCandidates,
    tagline: details.tagline || base.tagline,
    countries: (details.production_countries ?? []).map((country) => country.name).filter(Boolean),
    productionCompanies: (details.production_companies ?? [])
      .map((company) => company.name)
      .filter(Boolean),
    originalLanguage: details.original_language || base.originalLanguage,
    budget: details.budget || base.budget,
    revenue: details.revenue || base.revenue,
    detailed: true,
  };
};

/** A summary is enough to render a card; details fill in later. */
export const filmFromSummary = (summary: FilmSummary, previous?: Film | null): Film => ({
  ...emptyFilm(summary.id, summary.title),
  ...(previous ?? {}),
  ...summary,
  detailed: previous?.detailed ?? false,
});
