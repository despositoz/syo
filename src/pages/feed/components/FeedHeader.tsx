import { IconButton } from '@shared/ui/IconButton/IconButton';
import { SearchIcon } from '@shared/ui/icons';
import styles from './FeedHeader.module.css';

export interface FeedHeaderProps {
  onSearch: () => void;
  onProfile: () => void;
}

/**
 * First screen has no "Лента" heading (spec §12): a compact wordmark, search
 * and avatar. Controls stay inside the content safe area and clear of the
 * Telegram control cluster on the right.
 */
export const FeedHeader = ({ onSearch, onProfile }: FeedHeaderProps) => (
  <header className={styles.header}>
    <span className={styles.wordmark} aria-label="SYO">
      SYO
    </span>
    <div className={styles.actions}>
      <IconButton label="Поиск фильма" variant="plain" onClick={onSearch}>
        <SearchIcon />
      </IconButton>
      <button type="button" className={styles.avatar} onClick={onProfile} aria-label="Профиль">
        <span aria-hidden="true">S</span>
      </button>
    </div>
  </header>
);
