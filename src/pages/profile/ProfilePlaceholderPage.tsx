import { useThemeStore, THEME_LABELS, type ThemePreference } from '@app/theme/themeStore';
import { useTelegram } from '@app/telegram/telegramStore';
import { useConnectivityStore } from '@app/connectivity/ConnectivityController';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { useWatchlistCount } from '@entities/watchlist/watchlist.store';
import { plural } from '@shared/utils/text';
import styles from './ProfilePlaceholderPage.module.css';

const THEME_OPTIONS: ThemePreference[] = ['cinema', 'graphite', 'system'];

/**
 * Placeholder that already carries the settings this version actually has:
 * theme choice, plus an honest status block for debugging on a real device.
 */
export const ProfilePlaceholderPage = () => {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const telegram = useTelegram();
  const online = useConnectivityStore((state) => state.online);
  const pending = useConnectivityStore((state) => state.pendingCount);
  const tier = usePerformanceStore((state) => state.tier);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);
  const watchlistCount = useWatchlistCount();

  return (
    <div className={styles.page}>
      <div className={`${styles.scroll} scroll-y`}>
        <main className={styles.content}>
          <h1 className={styles.title}>Профиль</h1>
          <p className={styles.lead}>
            Здесь появится твой вкус: статистика, любимые жанры и годы. Пока — настройки.
          </p>

          <section aria-labelledby="theme-title">
            <h2 className={styles.sectionTitle} id="theme-title">
              Тема
            </h2>
            <div className={styles.themes} role="radiogroup" aria-labelledby="theme-title">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={preference === option}
                  className={styles.theme}
                  data-active={preference === option}
                  onClick={() => setPreference(option)}
                >
                  {THEME_LABELS[option]}
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="status-title">
            <h2 className={styles.sectionTitle} id="status-title">
              Состояние
            </h2>
            <dl className={styles.status}>
              <div className={styles.row}>
                <dt>Отложено</dt>
                <dd>
                  {watchlistCount} {plural(watchlistCount, ['фильм', 'фильма', 'фильмов'])}
                </dd>
              </div>
              <div className={styles.row}>
                <dt>Сеть</dt>
                <dd>{online ? 'Онлайн' : 'Офлайн'}</dd>
              </div>
              {pending > 0 ? (
                <div className={styles.row}>
                  <dt>Ждут синхронизации</dt>
                  <dd>{pending}</dd>
                </div>
              ) : null}
              <div className={styles.row}>
                <dt>Среда</dt>
                <dd>{telegram.inTelegram ? `Telegram ${telegram.version}` : 'Браузер'}</dd>
              </div>
              <div className={styles.row}>
                <dt>Fullscreen</dt>
                <dd>{telegram.fullscreen}</dd>
              </div>
              <div className={styles.row}>
                <dt>Графика</dt>
                <dd>
                  {tier}
                  {reducedMotion ? ' · reduce motion' : ''}
                </dd>
              </div>
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
};
