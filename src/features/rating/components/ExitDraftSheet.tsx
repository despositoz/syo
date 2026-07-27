import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import styles from './FlowSheets.module.css';

export interface ExitDraftSheetProps {
  open: boolean;
  /** Editing an existing entry asks a different question than a new rating. */
  editing?: boolean;
  onClose: () => void;
  onLeave: () => void;
  onDiscard: () => void | Promise<void>;
}

/**
 * Closing a flow that has data (spec §8.11, §18.5). Never a system confirm();
 * leaving keeps the draft, and discarding is a separate, quiet action.
 */
export const ExitDraftSheet = ({
  open,
  editing = false,
  onClose,
  onLeave,
  onDiscard,
}: ExitDraftSheetProps) => (
  <Sheet
    open={open}
    title={editing ? 'Сохранить изменения позже?' : 'Ты не закончил оценку'}
    onClose={onClose}
  >
    {!editing ? (
      <p className={styles.text}>Продолжишь с этого места, когда вернёшься.</p>
    ) : null}

    <div className={styles.actions}>
      <Button variant="primary" block onClick={onLeave} data-testid="exit-later">
        Продолжить позже
      </Button>
      <Button variant="secondary" block onClick={onClose}>
        Остаться
      </Button>
      <Button variant="destructive" block onClick={() => void onDiscard()} data-testid="exit-discard">
        {editing ? 'Отменить изменения' : 'Удалить черновик'}
      </Button>
    </div>
  </Sheet>
);
