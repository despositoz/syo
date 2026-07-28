import { draftProgressLabel } from '@domain/rating/rating.machine';
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

/**
 * The unfinished rating, at the top of the Diary (spec §6.8 of P0.3's
 * predecessor). Says what is left in words, never "conversationStep=2".
 */
export const ActiveDraftCard = ({ draft, onContinue, onDelete }: ActiveDraftCardProps) => (
  <div className={styles.card} data-testid="active-draft-card">
    <button type="button" className={styles.main} onClick={onContinue} data-testid="draft-continue">
      <span className={styles.poster}>
        <Poster
          title={draft.filmTitle}
          year={draft.releaseYear ?? ''}
          posterPath={draft.posterPath ?? ''}
          accent={{ hex: '#6f2a35', rgb: draft.dominantColor ?? '111, 42, 53' }}
          width={56}
          decorative
        />
      </span>

      <span className={styles.body}>
        <span className={styles.title}>Ты не закончил «{draft.filmTitle}»</span>
        <span className={styles.progress}>{draftProgressLabel(draft)}</span>
      </span>

      <span className={styles.action}>Продолжить</span>
    </button>

    <IconButton
      label="Удалить черновик"
      variant="plain"
      onClick={onDelete}
      data-testid="draft-delete"
    >
      <CloseIcon />
    </IconButton>
  </div>
);
