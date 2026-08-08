/**
 * The local profile (P0.5 §6.1).
 *
 * Private by default and never leaves the device in this stage. The Telegram
 * identity is a *suggestion* the user can overwrite, not a locked field.
 */

export interface LocalProfile {
  id: 'local';
  displayName: string;
  bio: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramPhotoUrl: string | null;
  /** Order matters: this is the row the user arranged. Maximum five. */
  favoriteFilmIds: number[];
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export const PROFILE_SCHEMA_VERSION = 1;
export const NAME_MAX = 40;
export const BIO_MAX = 160;
export const FAVORITES_MAX = 5;

/**
 * Counts what a person would call a character: an emoji built from several
 * code points is one, not four. `Intl.Segmenter` is in every target browser;
 * the fallback only matters for an old test runner.
 */
export const graphemeLength = (value: string): number => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(value)) count += 1;
    return count;
  }
  return [...value].length;
};

/** Cuts to a grapheme count without splitting a character in half. */
export const truncateGraphemes = (value: string, limit: number): string => {
  if (graphemeLength(value) <= limit) return value;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
    let result = '';
    let count = 0;
    for (const { segment } of segmenter.segment(value)) {
      if (count >= limit) break;
      result += segment;
      count += 1;
    }
    return result;
  }
  return [...value].slice(0, limit).join('');
};

export type ProfileValidationError =
  'nameEmpty' | 'nameTooLong' | 'bioTooLong' | 'tooManyFavorites';

/** What is wrong with a draft, in the order the form should report it. */
export const validateProfile = (draft: {
  displayName: string;
  bio: string | null;
  favoriteFilmIds: number[];
}): ProfileValidationError[] => {
  const errors: ProfileValidationError[] = [];
  // A name of spaces is not a name.
  if (!draft.displayName.trim()) errors.push('nameEmpty');
  if (graphemeLength(draft.displayName) > NAME_MAX) errors.push('nameTooLong');
  if (draft.bio && graphemeLength(draft.bio) > BIO_MAX) errors.push('bioTooLong');
  if (new Set(draft.favoriteFilmIds).size > FAVORITES_MAX) errors.push('tooManyFavorites');
  return errors;
};

export interface TelegramIdentity {
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

/** The name Telegram suggests, before the user has said otherwise. */
export const suggestedName = (identity: TelegramIdentity): string =>
  [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim() || 'Ты';

export const emptyProfile = (
  identity: TelegramIdentity,
  now = new Date().toISOString(),
): LocalProfile => ({
  id: 'local',
  displayName: suggestedName(identity),
  bio: null,
  telegramFirstName: identity.firstName,
  telegramLastName: identity.lastName,
  telegramPhotoUrl: identity.photoUrl,
  favoriteFilmIds: [],
  createdAt: now,
  updatedAt: now,
  schemaVersion: PROFILE_SCHEMA_VERSION,
});

/** Initials for the gradient avatar. Never the SYO wordmark (§11.1). */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '·';
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toUpperCase();
};

/* --- favourites ---------------------------------------------------------- */

export interface FavoriteChange {
  ids: number[];
  /** Set when the list was already full and something has to give way. */
  needsReplacement: boolean;
}

/**
 * Adding a sixth favourite never silently drops one: the caller is told it has
 * to ask which film leaves (§14.2).
 */
export const addFavorite = (ids: number[], filmId: number): FavoriteChange => {
  if (ids.includes(filmId)) return { ids, needsReplacement: false };
  if (ids.length >= FAVORITES_MAX) return { ids, needsReplacement: true };
  return { ids: [...ids, filmId], needsReplacement: false };
};

export const removeFavorite = (ids: number[], filmId: number): number[] =>
  ids.filter((id) => id !== filmId);

export const replaceFavorite = (ids: number[], remove: number, add: number): number[] =>
  ids.includes(add) ? ids : ids.map((id) => (id === remove ? add : id));

/** Moves a favourite to an index, keeping everything else in order. */
export const moveFavorite = (ids: number[], filmId: number, to: number): number[] => {
  const from = ids.indexOf(filmId);
  if (from === -1) return ids;
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (from === target) return ids;

  const next = [...ids];
  next.splice(from, 1);
  next.splice(target, 0, filmId);
  return next;
};
