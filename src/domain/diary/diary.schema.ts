import { isComplete } from '@domain/rating/rating.calculator';
import type { DiaryEntry } from './diary.types';

/**
 * Invariants that must hold before anything reaches storage, plus the ordering
 * the Diary shows. Kept out of components so both are testable.
 */

export class DiaryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiaryValidationError';
  }
}

/**
 * A deep entry carries all five aspects; a quick entry carries none. A part-way
 * rating exists only as a draft, never as a saved entry (spec §26).
 */
export const assertValidEntry = (entry: DiaryEntry): void => {
  if (entry.overallRating < 1 || entry.overallRating > 5) {
    throw new DiaryValidationError('overallRating must be 1-5');
  }
  if (entry.hasText !== false || entry.text !== null) {
    throw new DiaryValidationError('P0.2 entries carry no text');
  }
  if (entry.mode === 'quick') {
    const anyAspect = Object.values(entry.aspects).some((value) => value !== null);
    if (anyAspect) throw new DiaryValidationError('A quick entry must not carry aspects');
    return;
  }
  if (!isComplete(entry.aspects)) {
    throw new DiaryValidationError('A deep entry needs all five aspects');
  }
};

/**
 * Newest first by `updatedAt` (spec §33): re-rating a film brings its card back
 * to the top, which is what "newest/edited first" means.
 */
export const sortForDiary = (entries: readonly DiaryEntry[]): DiaryEntry[] =>
  [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** "12 июля 2026" — the date shown on a card. */
export const formatEntryDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
};
