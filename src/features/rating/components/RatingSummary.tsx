import { StarShape } from '@shared/ui/Star/StarShape';
import { formatPrecise } from '@domain/rating/rating.calculator';
import type { RatingValue } from '@domain/rating/rating.types';
import styles from './RatingSummary.module.css';

export interface RatingSummaryProps {
  /** Whole stars, 1-5. Null renders the empty outline. */
  overallRating: RatingValue | null;
  /** Shown as a secondary number when it differs from the whole star. */
  preciseRating?: number;
  size?: 'small' | 'large';
  /** "Сейчас" during the deep flow; omitted on the result. */
  label?: string;
  showNumber?: boolean;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * The read-only total (spec §25, §26).
 *
 * Never interactive — a deep total is computed, never typed in. Stars lead;
 * the precise number is deliberately secondary.
 */
export const RatingSummary = ({
  overallRating,
  preciseRating,
  size = 'small',
  label,
  showNumber = false,
}: RatingSummaryProps) => (
  <div className={styles.summary} data-size={size}>
    {label ? <span className={styles.label}>{label}</span> : null}

    <span className={styles.stars} aria-hidden="true">
      {STARS.map((star) => (
        <StarShape
          key={star}
          fill={overallRating !== null && overallRating >= star ? 1 : 0}
          className={styles.shape}
          id={`summary-${size}-${star}`}
        />
      ))}
    </span>

    {showNumber && overallRating !== null ? (
      <span className={styles.number}>{formatPrecise(preciseRating ?? overallRating)}</span>
    ) : null}

    <span className="sr-only">
      {overallRating === null ? 'Оценка не выбрана' : `${overallRating} из 5`}
    </span>
  </div>
);
