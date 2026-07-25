import { z } from 'zod';

/**
 * Every external payload passes through Zod before it becomes an app model.
 * Schemas are permissive about *extra* fields and strict about the ones we use.
 */

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? '');
const nullableNumber = z
  .number()
  .nullish()
  .transform((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0));

export const tmdbGenreSchema = z.object({
  id: z.number(),
  name: nullableString,
});

export const tmdbMovieSummarySchema = z.object({
  id: z.number(),
  title: nullableString,
  name: nullableString.optional(),
  original_title: nullableString,
  original_language: nullableString,
  release_date: nullableString,
  overview: nullableString,
  poster_path: nullableString,
  backdrop_path: nullableString,
  vote_average: nullableNumber,
  vote_count: nullableNumber,
  adult: z.boolean().nullish(),
  genre_ids: z.array(z.number()).nullish(),
  genres: z.array(tmdbGenreSchema).nullish(),
});

export const tmdbPagedSchema = z.object({
  page: nullableNumber,
  total_pages: nullableNumber,
  total_results: nullableNumber,
  results: z.array(z.unknown()),
});

export const tmdbCastMemberSchema = z.object({
  id: z.number(),
  name: nullableString,
  character: nullableString,
  profile_path: nullableString,
  order: nullableNumber,
});

export const tmdbCrewMemberSchema = z.object({
  id: z.number(),
  name: nullableString,
  job: nullableString,
  department: nullableString,
});

export const tmdbLogoSchema = z.object({
  file_path: nullableString,
  iso_639_1: z.string().nullish(),
  width: nullableNumber,
  height: nullableNumber,
  aspect_ratio: nullableNumber,
  vote_average: nullableNumber,
  vote_count: nullableNumber,
});

export const tmdbMovieDetailsSchema = tmdbMovieSummarySchema.extend({
  runtime: nullableNumber,
  tagline: nullableString,
  budget: nullableNumber,
  revenue: nullableNumber,
  production_countries: z
    .array(z.object({ iso_3166_1: nullableString, name: nullableString }))
    .nullish(),
  production_companies: z.array(z.object({ id: z.number(), name: nullableString })).nullish(),
  credits: z
    .object({
      cast: z.array(tmdbCastMemberSchema).nullish(),
      crew: z.array(tmdbCrewMemberSchema).nullish(),
    })
    .nullish(),
  images: z
    .object({
      logos: z.array(tmdbLogoSchema).nullish(),
    })
    .nullish(),
});

export type TmdbMovieSummary = z.infer<typeof tmdbMovieSummarySchema>;
export type TmdbMovieDetails = z.infer<typeof tmdbMovieDetailsSchema>;
export type TmdbLogo = z.infer<typeof tmdbLogoSchema>;

/** Genre ids → names, so summaries from list endpoints carry genre labels too. */
export const tmdbGenreListSchema = z.object({
  genres: z.array(tmdbGenreSchema),
});
