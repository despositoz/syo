import { useEffect } from 'react';
import { useOptionalServices } from '@app/appServices';
import styles from './ErrorBlock.module.css';

export const FILM_ERROR_MESSAGE = 'Не получилось загрузить информацию о фильме.';
export const RETRY_LABEL = 'Повторить';

export interface ErrorBlockProps {
  /** Calm, human, no jokes (spec §25). */
  message?: string;
  onRetry?: () => void;
  /** Full-screen only when there is neither local nor network data. */
  variant?: 'block' | 'screen';
}

export const ErrorBlock = ({
  message = FILM_ERROR_MESSAGE,
  onRetry,
  variant = 'block',
}: ErrorBlockProps) => {
  const services = useOptionalServices();

  // A screen-level failure is the one error worth feeling. Block-level errors
  // (missing cast, missing backdrop) stay silent — they are not interruptions.
  useEffect(() => {
    if (variant !== 'screen') return;
    services?.haptics.trigger('criticalError', message);
  }, [variant, message, services]);

  return (
    <div className={styles.root} data-variant={variant} role="alert">
      <p className={styles.message}>{message}</p>
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {RETRY_LABEL}
        </button>
      ) : null}
    </div>
  );
};
