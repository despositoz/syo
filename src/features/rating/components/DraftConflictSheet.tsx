import type { RatingDraft } from '@domain/rating/rating.types';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import styles from './FlowSheets.module.css';

export interface DraftConflictSheetProps {
  open: boolean;
  draft: RatingDraft | null;
  onClose: () => void;
  onContinue: () => void;
  onDiscard: () => void | Promise<void>;
}

const shortTitle = (title: string): string => (title.length > 24 ? `${title.slice(0, 22)}…` : title);

/**
 * Two active drafts are not allowed (spec §12.10), so starting another film
 * asks first. The destructive option is present but never the primary one.
 */
export const DraftConflictSheet = ({
  open,
  draft,
  onClose,
  onContinue,
  onDiscard,
}: DraftConflictSheetProps) => {
  if (!draft) return null;

  return (
    <Sheet open={open} title={`Ты не закончил «${draft.film.title}»`} onClose={onClose}>
      <p className={styles.text}>Можно продолжить или удалить черновик и начать новый фильм.</p>

      <div className={styles.actions}>
        <Button variant="primary" block onClick={onContinue} data-testid="conflict-continue">
          Продолжить «{shortTitle(draft.film.title)}»
        </Button>
        <Button variant="secondary" block onClick={onClose}>
          Остаться
        </Button>
        <Button variant="destructive" block onClick={() => void onDiscard()} data-testid="conflict-discard">
          Удалить черновик и начать новый
        </Button>
      </div>
    </Sheet>
  );
};
