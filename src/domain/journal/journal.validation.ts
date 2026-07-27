import { isComplete } from '@domain/rating/rating.calculation';
import type { JournalEntry, JournalMonth } from './journal.types';

/**
 * Invariants that must hold before anything reaches storage, plus the grouping
 * used by the Diary. Kept out of components so both are testable.
 */

export class JournalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalValidationError';
  }
}

/**
 * A detailed entry must carry all five aspects: a partially rated film exists
 * only as a draft, never as a saved entry (spec §13.6).
 */
export const assertValidEntry = (entry: JournalEntry): void => {
  if (entry.mode === 'quick') {
    if (entry.quickScore === null) {
      throw new JournalValidationError('A quick entry needs a score');
    }
    if (entry.aspects !== null) {
      throw new JournalValidationError('A quick entry must not carry aspects');
    }
    return;
  }
  if (!entry.aspects || !isComplete(entry.aspects)) {
    throw new JournalValidationError('A detailed entry needs all five aspects');
  }
};

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

export const monthKey = (isoDate: string): string => isoDate.slice(0, 7);

export const monthLabel = (isoDate: string): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
};

/**
 * Groups by `createdAt` — the date the entry was added. Editing changes
 * `updatedAt` only, so a re-rated film never jumps to another month.
 */
export const groupByMonth = (entries: readonly JournalEntry[]): JournalMonth[] => {
  const sorted = [...entries].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const months = new Map<string, JournalMonth>();

  for (const entry of sorted) {
    const key = monthKey(entry.createdAt);
    const existing = months.get(key);
    if (existing) existing.entries.push(entry);
    else months.set(key, { key, label: monthLabel(entry.createdAt), entries: [entry] });
  }

  return [...months.values()];
};
