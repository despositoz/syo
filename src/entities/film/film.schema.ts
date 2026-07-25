import { z } from 'zod';
import type { Film, FilmSummary } from './film.model';

/**
 * Cached data is external data too: an old schema version or a partially
 * written row must degrade to "no cache", never crash the screen.
 */

const accentSchema = z.object({
  hex: z.string(),
  rgb: z.string(),
});

export const filmSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  originalTitle: z.string(),
  year: z.string(),
  releaseDate: z.string(),
  genres: z.array(z.string()),
  posterPath: z.string(),
  backdropPath: z.string(),
  overview: z.string(),
  rating: z.number(),
  voteCount: z.number(),
  accent: accentSchema,
});

export const filmSchema = filmSummarySchema.extend({
  runtime: z.number(),
  director: z.string(),
  cast: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      character: z.string(),
      profilePath: z.string(),
    }),
  ),
  logoCandidates: z.array(
    z.object({
      filePath: z.string(),
      language: z.string().nullable(),
      width: z.number(),
      height: z.number(),
      aspectRatio: z.number(),
      voteAverage: z.number(),
      voteCount: z.number(),
    }),
  ),
  tagline: z.string(),
  countries: z.array(z.string()),
  productionCompanies: z.array(z.string()),
  originalLanguage: z.string(),
  budget: z.number(),
  revenue: z.number(),
  detailed: z.boolean(),
});

export const parseCachedFilm = (value: unknown): Film | null => {
  const parsed = filmSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const parseCachedSummaries = (value: unknown): FilmSummary[] => {
  const parsed = z.array(filmSummarySchema).safeParse(value);
  return parsed.success ? parsed.data : [];
};
