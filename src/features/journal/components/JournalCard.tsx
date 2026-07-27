import type { JournalEntry } from '@domain/journal/journal.types';
import type { JournalView } from '@domain/journal/journal.types';
import { formatScore } from '@domain/rating/rating.calculation';
import { Poster } from '@shared/ui/Poster/Poster';
import { OverallStars } from '@features/rating/components/OverallStars';
import styles from './JournalCard.module.css';

export interface JournalCardProps {
  entry: JournalEntry;
  view: JournalView;
  highlighted?: boolean;
  onOpen: (entry: JournalEntry) => void;
}

/**
 * One saved film (spec §16.6, §16.7).
 *
 * The poster is the content; the personal score is the only rating shown. No
 * TMDB number, no review excerpt, no "Только оценка" label on every card.
 */
export const JournalCard = ({ entry, view, highlighted = false, onOpen }: JournalCardProps) => {
  const year = entry.film.releaseYear ? String(entry.film.releaseYear) : '';

  return (
    <button
      type="button"
      className={styles.card}
      data-view={view}
      data-highlighted={highlighted || undefined}
      onClick={() => onOpen(entry)}
      aria-label={`${entry.film.title}. Твоя оценка ${formatScore(entry.displayScore)} из 5`}
      data-testid={`journal-card-${entry.id}`}
    >
      <span className={styles.poster}>
        <Poster
          title={entry.film.title}
          year={year}
          posterPath={entry.film.posterPath ?? ''}
          accent={{ hex: '#6f2a35', rgb: entry.film.dominantColor ?? '111, 42, 53' }}
          width={view === 'grid' ? 160 : 64}
          decorative
        />
      </span>

      <span className={styles.body}>
        <span className={styles.title}>{entry.film.title}</span>
        <span className={styles.score} aria-hidden="true">
          <OverallStars displayScore={entry.displayScore} size="small" />
          {/* A quiet marker that a breakdown exists — never the five aspects. */}
          {entry.mode === 'detailed' ? <span className={styles.detailedDot} /> : null}
        </span>
      </span>
    </button>
  );
};
