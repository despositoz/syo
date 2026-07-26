import type { NavigationController } from '@app/navigation/NavigationController';
import { filmRepository } from '@entities/film/film.repository';
import type { FilmSummary } from '@entities/film/film.model';
import { filmFromSummary } from '@shared/api/tmdb/tmdb.mappers';
import { prepareFilmPresentationCached, type FilmPresentation } from './film.presentation';

/**
 * Film opening coordinator (spec §17).
 *
 * The preflight starts on the tap, *before* the route is pushed — not after the
 * page mounts. Detailed data → logo candidate → decode → contrast → frozen
 * presentation all run while the page transition is still playing.
 *
 * FilmPage then consumes the very same promise, so there is exactly one
 * preflight per opening and the title group is never re-decided mid-flight.
 *
 * The push is *not* awaited. Blocking the tap for a preflight budget would add
 * input lag to every cold opening (spec §28) to save a few frames of a blank
 * title on a warm one — the wrong trade. Data does not wait for animation, and
 * animation does not wait for data.
 */

/** Openings are keyed by film id; only the most recent few are worth keeping. */
const MAX_TRACKED = 8;
const openings = new Map<number, Promise<FilmPresentation>>();

const remember = (filmId: number, promise: Promise<FilmPresentation>): void => {
  openings.set(filmId, promise);
  while (openings.size > MAX_TRACKED) {
    const oldest = openings.keys().next().value;
    if (oldest === undefined) break;
    openings.delete(oldest);
  }
};

/**
 * Starts (or joins) the preflight for a film. Never rejects: a failed load still
 * produces a valid text-title presentation from the summary we already have.
 */
export const startFilmOpening = (summary: FilmSummary): Promise<FilmPresentation> => {
  const existing = openings.get(summary.id);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Logos only arrive with detailed data, so the preflight needs it first.
      // load() already falls back to cache and then to the summary.
      const { film } = await filmRepository.load(summary.id, summary);
      return await prepareFilmPresentationCached(film);
    } catch {
      // This promise is consumed with `void ... .then()` in two places, so a
      // rejection here would be an unhandled rejection *and* a permanently
      // blank hero. The summary alone is always a valid text-title hero.
      return prepareFilmPresentationCached(filmFromSummary(summary));
    }
  })();

  remember(summary.id, promise);
  return promise;
};

/** The in-flight or resolved preflight for a film, if an opening started one. */
export const takeFilmOpening = (filmId: number): Promise<FilmPresentation> | null =>
  openings.get(filmId) ?? null;

/** Test seam. */
export const resetFilmOpenings = (): void => {
  openings.clear();
};

/**
 * The one way a film is opened from a list: preflight first, route second,
 * both inside the tap's gesture so fullscreen and haptics stay in context.
 */
export const openFilmWithPreflight = (
  navigation: NavigationController,
  summary: FilmSummary,
): void => {
  void startFilmOpening(summary);
  navigation.openFilm({ filmId: summary.id, title: summary.title });
};
