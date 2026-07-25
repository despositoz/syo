import { useChromeMode } from '@app/telegram/telegramStore';
import { IconButton } from '../IconButton/IconButton';
import { BackIcon } from '../icons';
import styles from './BackControl.module.css';

export interface BackControlProps {
  onBack: () => void;
  label?: string;
}

/**
 * The single source of truth for "never two back buttons" (spec §9).
 *
 * Chrome mode A (fullscreen / browser): our own button is rendered.
 * Chrome mode B (Telegram chrome): Telegram's BackButton is shown by
 * NavigationController and this renders nothing at all.
 */
export const BackControl = ({ onBack, label = 'Назад' }: BackControlProps) => {
  const chromeMode = useChromeMode();
  if (chromeMode === 'telegram') return null;

  return (
    <IconButton
      label={label}
      className={styles.back}
      onClick={onBack}
      data-testid="app-back-button"
    >
      <BackIcon />
    </IconButton>
  );
};
