import { BackControl } from '@shared/ui/BackControl/BackControl';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BookmarkIcon } from '@shared/ui/icons';
import styles from './FilmToolbar.module.css';

export interface FilmToolbarProps {
  onBack: () => void;
  inWatchlist: boolean;
  /** Only ever true when the hero button has left the viewport (spec §16). */
  showBookmark: boolean;
  onToggleWatchlist: () => void;
}

export const FilmToolbar = ({
  onBack,
  inWatchlist,
  showBookmark,
  onToggleWatchlist,
}: FilmToolbarProps) => (
  <div className={styles.toolbar}>
    <BackControl onBack={onBack} label="Назад к ленте" />
    <div className={styles.right}>
      {showBookmark ? (
        <IconButton
          label={inWatchlist ? 'Убрать из «Посмотреть позже»' : 'Посмотреть позже'}
          active={inWatchlist}
          onClick={onToggleWatchlist}
          data-testid="watchlist-toolbar"
        >
          <BookmarkIcon filled={inWatchlist} />
        </IconButton>
      ) : null}
    </div>
  </div>
);
