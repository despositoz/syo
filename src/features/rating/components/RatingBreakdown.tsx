import { useId, useState } from 'react';
import { RATING_ASPECTS } from '@domain/rating/rating.constants';
import type { AspectScores } from '@domain/rating/rating.types';
import { RatingSummary } from './RatingSummary';
import styles from './RatingBreakdown.module.css';

export interface RatingBreakdownProps {
  aspects: AspectScores;
  /** Collapsed on the result page, open on a saved entry. */
  defaultOpen?: boolean;
}

/**
 * "Как сложилась оценка" (spec §26): five compact rows, collapsed by default.
 *
 * No radar chart, no bars, no percentages — and nothing editable here: the
 * total is computed, so an aspect is changed by walking back through the flow.
 */
export const RatingBreakdown = ({ aspects, defaultOpen = false }: RatingBreakdownProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={styles.breakdown}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid="breakdown-toggle"
      >
        <span>Как сложилась оценка</span>
        <span className={styles.chevron} data-open={open || undefined} aria-hidden="true" />
      </button>

      {/*
        `hidden` rather than CSS-only collapsing: a screen reader must not read
        five rows that a sighted user cannot see.
      */}
      <div className={styles.panel} id={panelId} hidden={!open}>
        <ul className={styles.list}>
          {RATING_ASPECTS.map((aspect) => {
            const value = aspects[aspect.id];
            if (value === null) return null;
            return (
              <li key={aspect.id} className={styles.row}>
                <span className={styles.name}>{aspect.shortName}</span>
                <RatingSummary overallRating={value} size="small" />
                <span className="sr-only">
                  {aspect.shortName}: {value} из 5
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
