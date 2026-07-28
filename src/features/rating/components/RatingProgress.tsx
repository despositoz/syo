import { RATING_ASPECTS, DEEP_STEP_COUNT } from '@domain/rating/rating.constants';
import type { AspectScores } from '@domain/rating/rating.types';
import styles from './RatingProgress.module.css';

export interface RatingProgressProps {
  aspects: AspectScores;
  currentStep: number;
  /** Which steps can be opened — answered ones and the current gap. */
  canOpen: (step: number) => boolean;
  onSelect: (step: number) => void;
}

/**
 * Five markers plus a quiet "3 из 5" (spec §22).
 *
 * No long progress bar, no percentages. A future marker is genuinely disabled,
 * so a step can never be skipped by tapping ahead.
 */
export const RatingProgress = ({
  aspects,
  currentStep,
  canOpen,
  onSelect,
}: RatingProgressProps) => (
  <div className={styles.progress}>
    <div className={styles.markers} role="group" aria-label="Шаги оценки">
      {RATING_ASPECTS.map((aspect, step) => {
        const value = aspects[aspect.id];
        const answered = value !== null;
        const isCurrent = step === currentStep;
        const unlocked = canOpen(step);

        return (
          <button
            key={aspect.id}
            type="button"
            className={styles.marker}
            data-state={isCurrent ? 'current' : answered ? 'done' : 'future'}
            disabled={!unlocked || isCurrent}
            aria-current={isCurrent || undefined}
            aria-label={
              answered
                ? `${aspect.shortName}: ${value} из 5`
                : isCurrent
                  ? `${aspect.shortName}: сейчас`
                  : `${aspect.shortName}: ещё не оценено`
            }
            onClick={() => onSelect(step)}
            data-testid={`step-marker-${step + 1}`}
          >
            <span className={styles.dot} aria-hidden="true" />
          </button>
        );
      })}
    </div>

    <span className={styles.counter} aria-hidden="true">
      {currentStep + 1} из {DEEP_STEP_COUNT}
    </span>
  </div>
);
