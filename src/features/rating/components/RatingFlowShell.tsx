import type { ReactNode } from 'react';
import { useTelegram } from '@app/telegram/telegramStore';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BackIcon, CloseIcon } from '@shared/ui/icons';
import styles from './RatingFlowShell.module.css';

export interface RatingFlowShellProps {
  onBack: () => void;
  onClose?: () => void;
  /** Sits between the controls — progress markers, for instance. */
  headerCenter?: ReactNode;
  children: ReactNode;
  /** Sticky bottom area (CTA), padded clear of the home indicator. */
  footer?: ReactNode;
  /** "r, g, b" of the film — drives the ambient and the primary surfaces. */
  accentRgb?: string;
}

/**
 * The frame every rating screen sits in (spec §5.1, §20.7).
 *
 * Controls live inside the content-safe rect, so they never end up under the
 * Telegram close/menu cluster. In non-fullscreen Telegram owns the back
 * button and ours is not rendered — there are never two.
 */
export const RatingFlowShell = ({
  onBack,
  onClose,
  headerCenter,
  children,
  footer,
  accentRgb,
}: RatingFlowShellProps) => {
  const chromeMode = useTelegram().chromeMode;
  const ownBackButton = chromeMode === 'custom';

  return (
    <section
      className={styles.screen}
      style={accentRgb ? { ['--film-accent-rgb' as string]: accentRgb } : undefined}
    >
      <header className={styles.header}>
        <div className={styles.headerSide}>
          {ownBackButton ? (
            <IconButton label="Назад" onClick={onBack} data-testid="rating-back">
              <BackIcon />
            </IconButton>
          ) : null}
        </div>

        <div className={styles.headerCenter}>{headerCenter}</div>

        <div className={styles.headerSide} data-align="end">
          {onClose ? (
            <IconButton label="Закрыть оценку" onClick={onClose} data-testid="rating-close">
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className={`${styles.body} scroll-y`}>{children}</div>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
};
