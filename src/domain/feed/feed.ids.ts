/**
 * Deterministic feed item ids (P0.4 §6.7).
 *
 * The id is what makes a refresh a *reconciliation* rather than a redraw: an
 * item whose logical content has not changed keeps its id, so React keeps its
 * DOM node, the scroll anchor still resolves, and a dismissal still applies.
 * Conversely, when the evidence behind an observation genuinely changes, the
 * id changes with it — that is what lets a dismissed claim come back once it
 * is a different claim.
 */

export const recommendationId = (filmId: number, seedFilmId: number, version = 1): string =>
  `rec:movie:${filmId}:seed:${seedFilmId}:v${version}`;

export const collectionId = (kind: string, key: string | number, version = 1): string =>
  `collection:${kind}:${key}:v${version}`;

export const observationId = (
  code: string,
  subject: string | number,
  sourceRevision: number,
): string => `observation:${code}:${subject}:revision-${sourceRevision}`;

export const milestoneId = (code: string, value: number): string => `milestone:${code}:${value}`;

/** Month-grained: the same film may return in a later month, not this one. */
export const watchlistReturnId = (filmId: number, isoDate: string): string =>
  `watchlist:return:${filmId}:${isoDate.slice(0, 7)}`;

/** Day-grained: trending is a fact about a day. */
export const fallbackId = (source: string, filmId: number, isoDate: string): string =>
  `fallback:${source}:${filmId}:${isoDate.slice(0, 10)}`;
