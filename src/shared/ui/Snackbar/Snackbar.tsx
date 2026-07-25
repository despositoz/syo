import { useEffect } from 'react';
import { useSnackbarStore } from './snackbarStore';
import styles from './Snackbar.module.css';

/** Single transient message region. Polite: it never steals focus. */
export const Snackbar = () => {
  const current = useSnackbarStore((state) => state.current);
  const dismiss = useSnackbarStore((state) => state.dismiss);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(dismiss, current.duration);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  return (
    <div className={styles.region} role="status" aria-live="polite">
      {current ? (
        <div className={styles.snackbar} key={current.id}>
          {current.text}
        </div>
      ) : null}
    </div>
  );
};
