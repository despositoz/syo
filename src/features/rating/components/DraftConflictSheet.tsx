import type { ActiveDraft } from '@domain/writing/writing.types';
import { draftFilmTitle } from '@features/drafts/draftCoordinator';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import styles from './FlowSheets.module.css';

export interface DraftConflictSheetProps {
  open: boolean;
  draft: ActiveDraft | null;
  /**
   * 'film' — another film is mid-rating.
   * 'mode' — this film is mid-rating in the other mode, so switching loses it.
   */
  reason?: 'film' | 'mode';
  onClose: () => void;
  onContinue: () => void;
  /** Discards the existing draft *and* starts the new one — never just deletes. */
  onDiscard: () => void | Promise<void>;
}

const shortTitle = (title: string): string =>
  title.length > 24 ? `${title.slice(0, 22)}…` : title;

/**
 * Two active drafts are not allowed (spec §12.10), so anything that would
 * destroy one asks first. The destructive option is present but never primary,
 * and it always continues into the action the user asked for — deleting a draft
 * and then dropping them on an unchanged screen would be its own bug.
 */
export const DraftConflictSheet = ({
  open,
  draft,
  reason = 'film',
  onClose,
  onContinue,
  onDiscard,
}: DraftConflictSheetProps) => {
  if (!draft) return null;

  const byMode = reason === 'mode';
  const filmTitle = draftFilmTitle(draft);

  return (
    <Sheet
      open={open}
      title={byMode ? 'Оценка этого фильма уже начата' : `Ты не закончил «${filmTitle}»`}
      onClose={onClose}
    >
      <p className={styles.text}>
        {byMode
          ? 'Если начать в другом режиме, уже выбранные оценки пропадут.'
          : 'Можно продолжить или удалить черновик и начать новый фильм.'}
      </p>

      <div className={styles.actions}>
        <Button variant="primary" block onClick={onContinue} data-testid="conflict-continue">
          {byMode ? 'Продолжить начатое' : `Продолжить «${shortTitle(filmTitle)}»`}
        </Button>
        <Button variant="secondary" block onClick={onClose}>
          Остаться
        </Button>
        <Button
          variant="destructive"
          block
          onClick={() => void onDiscard()}
          data-testid="conflict-discard"
        >
          {byMode ? 'Начать заново в другом режиме' : 'Удалить черновик и начать новый'}
        </Button>
      </div>
    </Sheet>
  );
};
