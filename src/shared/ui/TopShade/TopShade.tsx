import styles from './TopShade.module.css';

export interface TopShadeProps {
  /** Dense but *short* layer behind the status bar and controls. */
  chrome?: boolean;
  /** Soft vignette that ties the controls to the image. Never deep. */
  vignette?: boolean;
  className?: string;
}

/**
 * The top darkening is two separate things (spec §19).
 *
 * A big black lid is forbidden: the chrome shade covers only the safe area plus
 * the control row, and the vignette stays shallow so it never lands on the logo
 * or on faces. Safe-area is never "fixed" by darkening.
 */
export const TopShade = ({ chrome = true, vignette = true, className }: TopShadeProps) => (
  <div className={[styles.root, className].filter(Boolean).join(' ')} aria-hidden="true">
    {chrome ? <div className={styles.chrome} /> : null}
    {vignette ? <div className={styles.vignette} /> : null}
  </div>
);
