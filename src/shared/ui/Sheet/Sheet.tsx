import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../IconButton/IconButton';
import { CloseIcon } from '../icons';
import styles from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal sheet used for secondary content (details, settings).
 * No drag gestures in this version — it opens and closes by explicit action.
 */
export const Sheet = ({ open, title, onClose, children }: SheetProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.scrim} aria-label="Закрыть" onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton label="Закрыть" variant="plain" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>
        <div className={`${styles.body} scroll-y`}>{children}</div>
      </div>
    </div>
  );
};
