import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  /** Fills the row — used for the sticky CTA. */
  block?: boolean;
  children: ReactNode;
}

/**
 * The app's text button. Height is at least 52px so a CTA always clears the
 * minimum touch target with room to spare (spec §20.8).
 */
export const Button = ({
  variant = 'primary',
  block = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={[styles.button, block ? styles.block : '', className].filter(Boolean).join(' ')}
    data-variant={variant}
    {...rest}
  >
    {children}
  </button>
);
