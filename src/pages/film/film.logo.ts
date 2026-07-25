import type { FilmLogoCandidate } from '@entities/film/film.model';

/**
 * Logo selection (spec §17 step 2).
 *
 * Deterministic: the same film always yields the same candidate, so the hero
 * composition cannot change between two openings.
 */

export interface LogoSelectionOptions {
  /** Preferred UI language, then English, then language-neutral art. */
  preferredLanguage?: string;
}

const MIN_WIDTH = 120;
const MIN_HEIGHT = 32;
/** A logo is a wide lockup; anything near-square is usually an icon. */
const MIN_ASPECT = 1.1;
const MAX_ASPECT = 9;
/** The shape a hero title group is designed around. */
const IDEAL_ASPECT = 3;

export const isUsableLogo = (candidate: FilmLogoCandidate): boolean => {
  if (!candidate.filePath) return false;
  if (candidate.width && candidate.width < MIN_WIDTH) return false;
  if (candidate.height && candidate.height < MIN_HEIGHT) return false;
  if (
    candidate.aspectRatio &&
    (candidate.aspectRatio < MIN_ASPECT || candidate.aspectRatio > MAX_ASPECT)
  )
    return false;
  return true;
};

const languageRank = (language: string | null, preferred: string): number => {
  if (language === preferred) return 0;
  if (language === 'en') return 1;
  if (language === null || language === '') return 2;
  return 3;
};

const qualityScore = (candidate: FilmLogoCandidate): number =>
  candidate.voteAverage * Math.log2(candidate.voteCount + 2);

/** Ordered best-first. Callers may walk the list if a candidate fails to load. */
export const rankLogoCandidates = (
  candidates: readonly FilmLogoCandidate[],
  options: LogoSelectionOptions = {},
): FilmLogoCandidate[] => {
  const preferred = (options.preferredLanguage ?? 'ru').toLowerCase();
  return candidates
    .filter(isUsableLogo)
    .slice()
    .sort((left, right) => {
      const byLanguage =
        languageRank(left.language, preferred) - languageRank(right.language, preferred);
      if (byLanguage !== 0) return byLanguage;

      const byQuality = qualityScore(right) - qualityScore(left);
      if (Math.abs(byQuality) > 0.15) return byQuality;

      const leftAspect = Math.abs((left.aspectRatio || IDEAL_ASPECT) - IDEAL_ASPECT);
      const rightAspect = Math.abs((right.aspectRatio || IDEAL_ASPECT) - IDEAL_ASPECT);
      if (leftAspect !== rightAspect) return leftAspect - rightAspect;

      // Final tiebreak keeps the order stable across sessions.
      return left.filePath.localeCompare(right.filePath);
    });
};

export const selectLogoCandidate = (
  candidates: readonly FilmLogoCandidate[],
  options: LogoSelectionOptions = {},
): FilmLogoCandidate | null => rankLogoCandidates(candidates, options)[0] ?? null;
