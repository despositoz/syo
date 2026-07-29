import { formatPrecise } from '@domain/rating/rating.calculator';
import { formatEntryDate } from '@domain/diary/diary.schema';
import { textExcerpt } from '@domain/diary/diary.text';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { Poster } from '@shared/ui/Poster/Poster';
import { RatingSummary } from '@features/rating/components/RatingSummary';
import styles from './DiaryEntryCard.module.css';

export interface DiaryEntryCardProps {
  entry: DiaryEntry;
  view: 'grid' | 'list';
  highlighted?: boolean;
  onOpen: (entry: DiaryEntry) => void;
}

/**
 * One saved rating (spec §33).
 *
 * Compact — the Diary is not the Feed: poster 2:3, no backdrop, no SYO
 * wordmark, and a missing poster falls back to typography.
 */
export const DiaryEntryCard = ({
  entry,
  view,
  highlighted = false,
  onOpen,
}: DiaryEntryCardProps) => (
  <button
    type="button"
    className={styles.card}
    data-view={view}
    data-highlighted={highlighted || undefined}
    onClick={() => onOpen(entry)}
    aria-label={`${entry.filmTitle}. Твоя оценка ${entry.overallRating} из 5`}
    data-testid={`diary-card-${entry.id}`}
  >
    <span className={styles.poster}>
      <Poster
        title={entry.filmTitle}
        year={entry.releaseYear ?? ''}
        posterPath={entry.posterPath ?? ''}
        accent={{ hex: '#6f2a35', rgb: '111, 42, 53' }}
        width={view === 'grid' ? 160 : 64}
        decorative
      />
    </span>

    <span className={styles.body}>
      <span className={styles.title}>{entry.filmTitle}</span>
      {entry.releaseYear ? <span className={styles.year}>{entry.releaseYear}</span> : null}

      <span className={styles.score}>
        <RatingSummary overallRating={entry.overallRating} size="small" />
        {/* The precise number only earns its place when it differs. */}
        {entry.preciseRating !== entry.overallRating ? (
          <span className={styles.precise}>{formatPrecise(entry.preciseRating)}</span>
        ) : null}
      </span>

      {/*
        A real excerpt of what the user wrote — never a generated summary. A
        spoiler text shows only that it exists (spec §23.2).
      */}
      {entry.hasText && entry.text ? (
        entry.text.spoiler ? (
          <span className={styles.excerpt} data-spoiler="true" data-testid="card-excerpt">
            Есть текст со спойлерами
          </span>
        ) : (
          <span className={styles.excerpt} data-testid="card-excerpt">
            {textExcerpt(entry.text, view === 'grid' ? 90 : 140)}
          </span>
        )
      ) : null}

      <span className={styles.date}>{formatEntryDate(entry.updatedAt)}</span>
    </span>
  </button>
);
