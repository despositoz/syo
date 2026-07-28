import type { ReactNode } from 'react';
import { useTelegram } from '@app/telegram/telegramStore';
import { useRatingStore } from '../model/rating.store';
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
  const storageError = useRatingStore((state) => state.storageError);
  const retrySave = useRatingStore((state) => state.retrySave);
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

      {/*
        Autosave failing is the one error the user must hear about: everything
        on screen looks saved, but it exists only in memory. Assertive, because
        continuing to rate would quietly lose answers.
      */}
      {storageError ? (
        <div className={styles.storageError} role="alert" data-testid="rating-storage-error">
          <span>Не получилось сохранить оценку на устройстве.</span>
          <button type="button" onClick={() => void retrySave()} data-testid="rating-storage-retry">
            Повторить
          </button>
        </div>
      ) : null}

      <div className={`${styles.body} scroll-y`}>{children}</div>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
};
