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
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      /*
       * Keep Tab inside the dialog. `aria-modal` tells assistive tech the rest
       * of the page is inert, but it does not stop the browser tabbing into
       * the controls behind the scrim — the keyboard would simply walk out of
       * a modal that claims to be modal.
       */
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [
        // Scoped to the dialog's own ref, not the document: a focus trap has to
        // enumerate what is focusable inside it, and there is no ref-based way
        // to ask that question.
        // eslint-disable-next-line no-restricted-syntax
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.offsetParent !== null || node === document.activeElement);

      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
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
