import { useConnectivityStore } from '@app/connectivity/ConnectivityController';
import styles from './SyncIndicator.module.css';

/**
 * Transient sync state — never a permanent "Offline" plate (spec §24).
 *
 * It appears only when a sync has been running long enough to be worth
 * explaining, or when a real error is left behind. Going offline on its own
 * shows nothing: everything still works from IndexedDB.
 */
export const SyncIndicator = () => {
  const status = useConnectivityStore((state) => state.syncStatus);

  if (status !== 'slow' && status !== 'error') return null;

  const text = status === 'slow' ? 'Синхронизация…' : 'Изменения сохранены локально';

  return (
    <div className={styles.indicator} data-status={status} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      {text}
    </div>
  );
};
