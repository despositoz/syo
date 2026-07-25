/** Application models. Deliberately free of any TMDB field naming. */

export interface AccentColor {
  hex: string;
  /** "r, g, b" — for rgba() composition in CSS. */
  rgb: string;
}

export interface FilmSummary {
  id: number;
  title: string;
  originalTitle: string;
  /** "1999" or "" when unknown. */
  year: string;
  releaseDate: string;
  genres: string[];
  posterPath: string;
  backdropPath: string;
  overview: string;
  /** External rating, 0–10. 0 means "no rating". */
  rating: number;
  voteCount: number;
  accent: AccentColor;
}

export interface FilmLogoCandidate {
  filePath: string;
  /** ISO-639-1, or null for text-free logos. */
  language: string | null;
  width: number;
  height: number;
  aspectRatio: number;
  voteAverage: number;
  voteCount: number;
}

export interface FilmCastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string;
}

export interface FilmDetails {
  runtime: number;
  director: string;
  cast: FilmCastMember[];
  logoCandidates: FilmLogoCandidate[];
  tagline: string;
  countries: string[];
  productionCompanies: string[];
  originalLanguage: string;
  budget: number;
  revenue: number;
  /** True when details were merged from the network (not a summary stub). */
  detailed: boolean;
}

export type Film = FilmSummary & FilmDetails;

const GENRE_ACCENTS: ReadonlyArray<readonly [RegExp, AccentColor]> = [
  [/ужас/i, { hex: '#78343d', rgb: '120, 52, 61' }],
  [/триллер/i, { hex: '#68464d', rgb: '104, 70, 77' }],
  [/драм/i, { hex: '#435973', rgb: '67, 89, 115' }],
  [/фантаст/i, { hex: '#45645f', rgb: '69, 100, 95' }],
  [/боев|приключ/i, { hex: '#75503a', rgb: '117, 80, 58' }],
  [/комед/i, { hex: '#6b5b3a', rgb: '107, 91, 58' }],
  [/детект|крими/i, { hex: '#4a4d6b', rgb: '74, 77, 107' }],
  [/фэнтези/i, { hex: '#5e4776', rgb: '94, 71, 118' }],
  [/мультф|аниме/i, { hex: '#5e5578', rgb: '94, 85, 120' }],
  [/документ/i, { hex: '#435c50', rgb: '67, 92, 80' }],
  [/мелодрам|роман/i, { hex: '#6f3448', rgb: '111, 52, 72' }],
];

export const DEFAULT_ACCENT: AccentColor = { hex: '#6f2a35', rgb: '111, 42, 53' };

/** Accent used by the poster's typographic fallback and by hero ambient light. */
export const accentForGenres = (genres: readonly string[]): AccentColor => {
  for (const genre of genres) {
    const match = GENRE_ACCENTS.find(([pattern]) => pattern.test(genre));
    if (match) return match[1];
  }
  return DEFAULT_ACCENT;
};

export const emptyFilm = (id: number, title = 'Без названия'): Film => ({
  id,
  title,
  originalTitle: '',
  year: '',
  releaseDate: '',
  genres: [],
  posterPath: '',
  backdropPath: '',
  overview: '',
  rating: 0,
  voteCount: 0,
  accent: DEFAULT_ACCENT,
  runtime: 0,
  director: '',
  cast: [],
  logoCandidates: [],
  tagline: '',
  countries: [],
  productionCompanies: [],
  originalLanguage: '',
  budget: 0,
  revenue: 0,
  detailed: false,
});

export const summaryOf = (film: Film | FilmSummary): FilmSummary => ({
  id: film.id,
  title: film.title,
  originalTitle: film.originalTitle,
  year: film.year,
  releaseDate: film.releaseDate,
  genres: film.genres,
  posterPath: film.posterPath,
  backdropPath: film.backdropPath,
  overview: film.overview,
  rating: film.rating,
  voteCount: film.voteCount,
  accent: film.accent,
});

export const formatRuntime = (minutes: number): string => {
  if (!minutes || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
};

export const formatRating = (rating: number): string =>
  rating > 0 ? rating.toFixed(1).replace('.', ',') : '';
