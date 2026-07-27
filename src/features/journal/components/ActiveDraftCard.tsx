import { completedAspectCount } from '@domain/rating/rating.calculation';
import type { RatingDraft } from '@domain/rating/rating.types';
import { Poster } from '@shared/ui/Poster/Poster';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { CloseIcon } from '@shared/ui/icons';
import styles from './ActiveDraftCard.module.css';

export interface ActiveDraftCardProps {
  draft: RatingDraft;
  onContinue: () => void;
  onDelete: () => void;
}

/** What is left to do, in words rather than a progress bar. */
const progressLabel = (draft: RatingDraft): string => {
  if (draft.currentScreen === 'result') return 'Осталось сохранить';
  if (draft.mode === 'quick') {
    return draft.quickScore === null ? 'Оценка не выбрана' : 'Осталось сохранить';
  }
  return `${completedAspectCount(draft.aspects)} из 5`;
};

/**
 * The unfinished rating, at the top of the Diary (spec §16.4).
 * A wide compact card — deliberately not a banner.
 */
export const ActiveDraftCard = ({ draft, onContinue, onDelete }: ActiveDraftCardProps) => (
  <div className={styles.card} data-testid="active-draft-card">
    <button type="button" className={styles.main} onClick={onContinue}>
      <span className={styles.poster}>
        <Poster
          title={draft.film.title}
          year={draft.film.releaseYear ? String(draft.film.releaseYear) : ''}
          posterPath={draft.film.posterPath ?? ''}
          accent={{ hex: '#6f2a35', rgb: draft.film.dominantColor ?? '111, 42, 53' }}
          width={56}
          decorative
        />
      </span>

      <span className={styles.body}>
        <span className={styles.title}>Ты не закончил «{draft.film.title}»</span>
        <span className={styles.progress}>{progressLabel(draft)}</span>
      </span>

      <span className={styles.action} aria-hidden="true">
        Продолжить
      </span>
    </button>

    <IconButton label="Удалить черновик" variant="plain" onClick={onDelete} data-testid="draft-delete">
      <CloseIcon />
    </IconButton>
  </div>
);
