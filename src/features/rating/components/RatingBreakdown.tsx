import { useId, useState } from 'react';
import { RATING_ASPECTS } from '@domain/rating/rating.constants';
import type { AspectScores } from '@domain/rating/rating.types';
import { OverallStars } from './OverallStars';
import styles from './RatingBreakdown.module.css';

export interface RatingBreakdownProps {
  aspects: AspectScores;
}

/**
 * "Как сложилась оценка" (spec §11.5).
 *
 * Collapsed by default, five compact rows, no charts and no per-aspect editing
 * here — changing a value means walking back through the flow.
 */
export const RatingBreakdown = ({ aspects }: RatingBreakdownProps) => {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className={styles.breakdown}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        data-testid="breakdown-toggle"
      >
        Как сложилась оценка
        <span className={styles.chevron} data-open={open || undefined} aria-hidden="true" />
      </button>

      {/*
        grid-template-rows 0fr → 1fr: the row animates without display:none,
        so the CTA below never jumps.
      */}
      <div className={styles.wrapper} data-open={open || undefined} id={id} role="region">
        <div className={styles.inner}>
          <dl className={styles.rows}>
            {RATING_ASPECTS.map((aspect) => {
              const value = aspects[aspect.id];
              return (
                <div className={styles.row} key={aspect.id}>
                  <dt className={styles.name}>{aspect.name}</dt>
                  <dd className={styles.value}>
                    <OverallStars displayScore={value ?? 0} size="small" />
                    <span className={styles.number}>{value ?? 0} из 5</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </div>
  );
};
