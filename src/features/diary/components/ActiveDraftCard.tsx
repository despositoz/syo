import { draftProgressLabel } from '@domain/rating/rating.machine';
import { writingProgressLabel } from '@domain/writing/writing.machine';
import { isWritingDraft, type ActiveDraft } from '@domain/writing/writing.types';
import { Poster } from '@shared/ui/Poster/Poster';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { CloseIcon } from '@shared/ui/icons';
import styles from './ActiveDraftCard.module.css';

export interface ActiveDraftCardProps {
  draft: ActiveDraft;
  onContinue: () => void;
  onDelete: () => void;
}

/**
 * The unfinished rating, at the top of the Diary (spec §6.8 of P0.3's
 * predecessor). Says what is left in words, never "conversationStep=2".
 */
export const ActiveDraftCard = ({ draft, onContinue, onDelete }: ActiveDraftCardProps) => {
  const writing = isWritingDraft(draft);
  const film = writing ? draft.film : draft;
  const progress = writing ? writingProgressLabel(draft) : draftProgressLabel(draft);

  return (
    <div className={styles.card} data-testid="active-draft-card">
      <button
        type="button"
        className={styles.main}
        onClick={onContinue}
        data-testid="draft-continue"
      >
        <span className={styles.poster} data-poster-frame="">
          <Poster
            title={film.filmTitle}
            year={film.releaseYear ?? ''}
            posterPath={film.posterPath ?? ''}
            accent={{ hex: '#6f2a35', rgb: film.dominantColor ?? '111, 42, 53' }}
            requestWidth={56}
            decorative
          />
        </span>

        <span className={styles.body}>
          <span className={styles.title}>
            {writing ? 'Текст о ' : 'Ты не закончил '}«{film.filmTitle}»
          </span>
          <span className={styles.progress}>{progress}</span>
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
};
