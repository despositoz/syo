import { RATING_ASPECTS } from '@domain/rating/rating.constants';
import type { AspectScores, RatingAspectId } from '@domain/rating/rating.types';
import styles from './AspectProgress.module.css';

export interface AspectProgressProps {
  aspects: AspectScores;
  current: RatingAspectId;
  /** Which markers can be opened — completed ones and the current gap. */
  canOpen: (aspectId: RatingAspectId) => boolean;
  onSelect: (aspectId: RatingAspectId) => void;
}

/**
 * Five markers, and only five (spec §8.5, §8.6).
 *
 * No "2 из 5" in large type next to them, no progress line, no second bar —
 * the numeric state lives in the accessible label instead.
 */
export const AspectProgress = ({ aspects, current, canOpen, onSelect }: AspectProgressProps) => (
  <div className={styles.progress} role="group" aria-label="Этапы оценки">
    {RATING_ASPECTS.map((aspect) => {
      const value = aspects[aspect.id];
      const completed = value !== null;
      const isCurrent = aspect.id === current;
      const unlocked = canOpen(aspect.id);

      return (
        <button
          key={aspect.id}
          type="button"
          className={styles.marker}
          data-state={isCurrent ? 'current' : completed ? 'done' : 'future'}
          // A future aspect stays locked so none can be skipped.
          disabled={!unlocked || isCurrent}
          aria-current={isCurrent || undefined}
          aria-label={
            completed
              ? `${aspect.name}: ${value} из 5`
              : isCurrent
                ? `${aspect.name}: сейчас`
                : `${aspect.name}: ещё не оценено`
          }
          onClick={() => onSelect(aspect.id)}
          data-testid={`aspect-marker-${aspect.id}`}
        >
          <span className={styles.dot} aria-hidden="true" />
        </button>
      );
    })}
  </div>
);
