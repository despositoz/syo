import type { DiaryEntry } from '@domain/diary/diary.types';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import styles from './FlowSheets.module.css';

export interface DuplicateFilmSheetProps {
  open: boolean;
  entry: DiaryEntry | null;
  onClose: () => void;
  onEdit: () => void;
  onOpenEntry: () => void;
}

/**
 * One film, one entry (spec §38). Rating an already-rated film offers to edit
 * or to open what exists — it never quietly creates a second card.
 */
export const DuplicateFilmSheet = ({
  open,
  entry,
  onClose,
  onEdit,
  onOpenEntry,
}: DuplicateFilmSheetProps) => {
  if (!entry) return null;

  return (
    <Sheet open={open} title="Ты уже оценивал этот фильм" onClose={onClose}>
      <p className={styles.text}>Можно изменить оценку или открыть сохранённую запись.</p>

      <div className={styles.actions}>
        <Button variant="primary" block onClick={onEdit} data-testid="duplicate-edit">
          Изменить оценку
        </Button>
        <Button variant="secondary" block onClick={onOpenEntry} data-testid="duplicate-open">
          Открыть запись
        </Button>
        <Button variant="ghost" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
};
