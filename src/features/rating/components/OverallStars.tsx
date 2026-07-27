import { StarShape } from '@shared/ui/Star/StarShape';
import { formatScore } from '@domain/rating/rating.calculation';
import styles from './OverallStars.module.css';

export interface OverallStarsProps {
  /** Half-star steps. */
  displayScore: number;
  /** How many aspects are in — 0 means nothing is shown yet. */
  completed?: number;
  /** 0.3 … 1, never the only signal of completeness. */
  confidence?: number;
  size?: 'small' | 'large';
  /** Raw average, shown next to the stars once there is something to show. */
  rawScore?: number;
  showNumber?: boolean;
  label?: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/** How full star `index` is for a score of `score`: 0, 0.5 or 1. */
const fillFor = (score: number, star: number): number => {
  if (score >= star) return 1;
  if (score >= star - 0.5) return 0.5;
  return 0;
};

/**
 * The read-only overall (spec §8.3, §11).
 *
 * Never interactive — the detailed total is computed, never typed in. During
 * the flow it holds one position and only the fill changes.
 */
export const OverallStars = ({
  displayScore,
  completed,
  confidence = 1,
  size = 'small',
  rawScore,
  showNumber = false,
  label,
}: OverallStarsProps) => {
  const hasValue = completed === undefined || completed > 0;

  return (
    <div
      className={styles.overall}
      data-size={size}
      style={{ ['--overall-confidence' as string]: String(hasValue ? confidence : 0.3) }}
    >
      {label ? <span className={styles.label}>{label}</span> : null}

      <span className={styles.stars} data-empty={!hasValue || undefined}>
        {STARS.map((star) => (
          <StarShape
            key={star}
            fill={hasValue ? fillFor(displayScore, star) : 0}
            className={styles.shape}
            id={`overall-${size}-${star}`}
          />
        ))}
      </span>

      {showNumber && hasValue ? (
        <span className={styles.number}>{formatScore(rawScore ?? displayScore)} из 5</span>
      ) : null}

      {/*
        Completeness is stated in words too, never by opacity alone — but not
        before the first aspect is in: an empty overall shows no number at all.
      */}
      {completed !== undefined && completed > 0 && completed < 5 ? (
        <span className={styles.progress}>{completed} из 5</span>
      ) : null}
    </div>
  );
};
