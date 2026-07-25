import { forwardRef } from 'react';
import type { AccentColor } from '@entities/film/film.model';
import { BookmarkIcon } from '@shared/ui/icons';
import styles from './FilmActionRow.module.css';

export interface FilmActionRowProps {
  /** The film's dominant colour, mixed into the primary button. */
  accent: AccentColor;
  inWatchlist: boolean;
  onRate: () => void;
  onToggleWatchlist: () => void;
}

/**
 * The film's action row: primary CTA and the watchlist bookmark on one line,
 * roughly 4:1, same height.
 *
 * This row is the *hero projection* of the single watchlist function — the
 * toolbar bookmark only appears once this row leaves the viewport (spec §16).
 */
export const FilmActionRow = forwardRef<HTMLDivElement, FilmActionRowProps>(
  function FilmActionRow({ accent, inWatchlist, onRate, onToggleWatchlist }, ref) {
    return (
      <div
        className={styles.row}
        ref={ref}
        style={{ ['--film-accent-rgb' as string]: accent.rgb }}
      >
        <button type="button" className={styles.primary} onClick={onRate}>
          Начать оценку
          <span className={styles.hint}>Следующий этап</span>
        </button>

        <button
          type="button"
          className={styles.bookmark}
          data-active={inWatchlist}
          aria-pressed={inWatchlist}
          aria-label={inWatchlist ? 'Убрать из «Посмотреть позже»' : 'Посмотреть позже'}
          onClick={onToggleWatchlist}
          data-testid="watchlist-hero"
        >
          <span className={styles.icon} aria-hidden="true">
            <BookmarkIcon filled={inWatchlist} />
          </span>
        </button>
      </div>
    );
  },
);
