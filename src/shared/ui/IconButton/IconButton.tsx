import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon button has no visible text. */
  label: string;
  children: ReactNode;
  variant?: 'glass' | 'plain';
  /** Pressed/selected state — announced, not only coloured. */
  active?: boolean;
}

/**
 * 44×44 minimum touch zone, semantic <button>, always labelled.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, variant = 'glass', active = false, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
      {...rest}
    >
      <span className={styles.icon} aria-hidden="true">
        {children}
      </span>
    </button>
  );
});
