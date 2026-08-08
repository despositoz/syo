import type { ComponentType } from 'react';
import type { RootTab } from '@app/navigation/navigationTypes';
import { RATE_LABEL, TAB_LABELS } from '@app/routes';
import { DiaryIcon, FeedIcon, ProfileIcon, RateIcon } from '../icons';
import styles from './BottomBar.module.css';

export interface BottomBarProps {
  activeTab: RootTab;
  onSelectTab: (tab: RootTab) => void;
  onRate: () => void;
  /** Hidden on the Film Page and inside the picker. */
  hidden?: boolean;
}

const TAB_ICONS: Record<RootTab, ComponentType> = {
  feed: FeedIcon,
  diary: DiaryIcon,
  profile: ProfileIcon,
};

/** Which of the four columns each tab sits in — the indicator slides to it. */
const TAB_COLUMN: Record<RootTab, number> = { feed: 0, diary: 1, profile: 3 };

/**
 * Floating glass island (spec §10).
 *
 * Root screens only, labels always visible, active state carried by a material
 * indicator *and* by aria-current — colour is never the only signal.
 * The bar sits above --safe-bottom, so Telegram's own chrome never covers it.
 */
export const BottomBar = ({ activeTab, onSelectTab, onRate, hidden = false }: BottomBarProps) => {
  const renderTab = (tab: RootTab) => {
    const Icon = TAB_ICONS[tab];
    const active = activeTab === tab;
    return (
      <li key={tab} className={styles.item}>
        <button
          type="button"
          className={styles.tab}
          data-active={active}
          aria-current={active ? 'page' : undefined}
          onClick={() => onSelectTab(tab)}
        >
          <span className={styles.icon} aria-hidden="true">
            <Icon />
          </span>
          <span className={styles.label}>{TAB_LABELS[tab]}</span>
        </button>
      </li>
    );
  };

  return (
    <nav
      className={styles.bar}
      data-hidden={hidden}
      aria-label="Основная навигация"
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      <ul className={styles.list}>
        <li
          className={styles.selection}
          data-column={TAB_COLUMN[activeTab]}
          data-testid="bottom-bar-indicator"
          aria-hidden="true"
        />
        {renderTab('feed')}
        {renderTab('diary')}
        <li className={styles.item}>
          <button type="button" className={styles.rate} onClick={onRate}>
            <span className={styles.rateIcon} aria-hidden="true">
              <RateIcon />
            </span>
            <span className={styles.label}>{RATE_LABEL}</span>
          </button>
        </li>
        {renderTab('profile')}
      </ul>
    </nav>
  );
};
