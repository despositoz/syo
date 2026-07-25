import type { AccentColor, Film } from '@entities/film/film.model';
import type { ImagePipeline } from '@shared/images/ImagePipeline';
import { imagePipeline } from '@shared/images/ImagePipeline';
import {
  classifyLogoImage,
  filterForTone,
  type CanvasFactory,
  type LogoTone,
} from '@shared/images/logoClassifier';
import { db, safeRead, safeWrite } from '@shared/storage/db';
import { selectLogoCandidate } from './film.logo';

/**
 * Film Presentation Preflight (spec §17).
 *
 * Everything that decides the *hero composition* is resolved before the page
 * transition starts, and then frozen. Metadata may still update afterwards;
 * the title group may not. That is what stops the text→logo flash.
 */

export type TitleMode = 'logo' | 'text';

/**
 * Why the hero looks the way it does.
 *
 * 'timeout' and 'load-error' are *transient*: the spec keeps text only until
 * the next opening, so they must not be cached as a permanent decision.
 * 'no-candidate' and 'unsafe' are properties of the artwork itself.
 */
export type TitleReason = 'logo' | 'no-candidate' | 'unsafe' | 'timeout' | 'load-error';

const DURABLE_REASONS: readonly TitleReason[] = ['logo', 'no-candidate', 'unsafe'];

export interface FilmPresentation {
  readonly filmId: number;
  readonly title: string;
  readonly year: string;
  readonly titleMode: TitleMode;
  readonly titleReason: TitleReason;
  readonly logoUrl: string;
  readonly logoTone: LogoTone | 'none';
  readonly logoFilter: string;
  readonly posterPreviewUrl: string;
  readonly posterUrl: string;
  readonly backdropPreviewUrl: string;
  readonly backdropUrl: string;
  readonly accent: AccentColor;
  readonly preparedAt: number;
}

/** The slice of ImagePipeline the preflight needs (kept small for tests). */
export interface PresentationPipeline {
  preview: ImagePipeline['preview'];
  poster: ImagePipeline['poster'];
  backdrop: ImagePipeline['backdrop'];
  logo: ImagePipeline['logo'];
  load: ImagePipeline['load'];
}

export interface PreflightDeps {
  pipeline?: PresentationPipeline;
  /** Canvas access for the contrast check; injected in tests. */
  canvasFactory?: CanvasFactory;
  /** How long the hero may wait for a logo before committing to text. */
  budgetMs?: number;
  /** Rendered logo width in CSS px. */
  logoWidth?: number;
  posterWidth?: number;
  backdropWidth?: number;
  preferredLanguage?: string;
  now?: () => number;
}

/**
 * Short enough that the hero is not visibly waiting, long enough for a cold
 * TMDB logo on a normal mobile connection (measured ~660 ms worst case, which
 * falls back to text and succeeds on the next opening).
 */
const DEFAULT_BUDGET_MS = 550;

const freeze = (presentation: FilmPresentation): FilmPresentation => Object.freeze(presentation);

const withTimeout = async <T>(promise: Promise<T>, budgetMs: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    return await Promise.race([promise.catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Runs the preflight. Never throws: a failed logo simply means a text title,
 * which is always a valid hero.
 */
export const prepareFilmPresentation = async (
  film: Film,
  deps: PreflightDeps = {},
): Promise<FilmPresentation> => {
  const pipeline = deps.pipeline ?? imagePipeline;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const logoWidth = deps.logoWidth ?? 300;
  const posterWidth = deps.posterWidth ?? 342;
  const backdropWidth = deps.backdropWidth ?? 780;
  const now = deps.now ?? (() => Date.now());

  const base = {
    filmId: film.id,
    title: film.title,
    year: film.year,
    accent: film.accent,
    // Poster is prepared before the backdrop (spec §22).
    posterPreviewUrl: pipeline.preview(film.posterPath, 'poster'),
    posterUrl: pipeline.poster(film.posterPath, posterWidth),
    backdropPreviewUrl: pipeline.preview(film.backdropPath || film.posterPath, 'backdrop'),
    backdropUrl: pipeline.backdrop(film.backdropPath || film.posterPath, backdropWidth),
    preparedAt: now(),
  };

  const textPresentation = (titleReason: TitleReason): FilmPresentation =>
    freeze({
      ...base,
      titleMode: 'text',
      titleReason,
      logoUrl: '',
      logoTone: 'none',
      logoFilter: 'none',
    });

  const candidate = selectLogoCandidate(film.logoCandidates, {
    preferredLanguage: deps.preferredLanguage ?? 'ru',
  });
  if (!candidate) return textPresentation('no-candidate');

  const logoUrl = pipeline.logo(candidate.filePath, logoWidth);

  // crossOrigin is required for the canvas read; TMDB serves permissive CORS,
  // and a tainted canvas is handled as 'unsafe' → text.
  // The load is *not* aborted on timeout: it keeps filling the HTTP cache, so
  // the next opening of this film usually makes the budget.
  const image = await withTimeout(pipeline.load(logoUrl, { crossOrigin: true }), budgetMs);
  if (!image) return textPresentation('timeout');

  const analysis = deps.canvasFactory
    ? classifyLogoImage(image, deps.canvasFactory)
    : classifyLogoImage(image);
  if (analysis.tone === 'unsafe') return textPresentation('unsafe');

  return freeze({
    ...base,
    titleMode: 'logo',
    titleReason: 'logo',
    logoUrl,
    logoTone: analysis.tone,
    logoFilter: filterForTone(analysis.tone),
  });
};

/* --- presentation cache -------------------------------------------- */

/**
 * The decision is cached so a second opening is identical *and* instant.
 * Cached decisions expire, otherwise a fixed logo would never be re-evaluated.
 */
const PRESENTATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const readCachedPresentation = async (
  filmId: number,
): Promise<{ mode: TitleMode; logoPath: string; tone: LogoTone | 'none' } | null> => {
  const row = await safeRead(() => db.presentations.get(filmId), undefined);
  if (!row) return null;
  if (Date.now() - row.cachedAt > PRESENTATION_TTL_MS) return null;
  return { mode: row.mode, logoPath: row.logoPath, tone: row.tone as LogoTone | 'none' };
};

export const writeCachedPresentation = async (presentation: FilmPresentation): Promise<void> => {
  // A transient failure must not freeze the hero into text forever.
  if (!DURABLE_REASONS.includes(presentation.titleReason)) return;
  await safeWrite(() =>
    db.presentations.put({
      filmId: presentation.filmId,
      mode: presentation.titleMode,
      logoPath: presentation.logoUrl,
      tone: presentation.logoTone,
      cachedAt: Date.now(),
    }),
  );
};

/**
 * Fast path: if a previous opening decided this film has no usable logo, stay
 * on text without trying again — re-trying is exactly the flash the spec
 * forbids. A logo that merely lost the budget last time is retried.
 */
export const prepareFilmPresentationCached = async (
  film: Film,
  deps: PreflightDeps = {},
): Promise<FilmPresentation> => {
  const cached = await readCachedPresentation(film.id);
  const presentation =
    cached?.mode === 'text'
      ? await prepareFilmPresentation({ ...film, logoCandidates: [] }, deps)
      : await prepareFilmPresentation(film, deps);
  await writeCachedPresentation(presentation);
  return presentation;
};
