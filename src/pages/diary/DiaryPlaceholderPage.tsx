import { useEffect, useState } from 'react';
import { useNavigationController } from '@app/appServices';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import type { WatchlistEntry } from '@entities/watchlist/watchlist.model';
import { Poster } from '@shared/ui/Poster/Poster';
import { plural } from '@shared/utils/text';
import styles from './DiaryPlaceholderPage.module.css';

/**
 * Placeholder with real content: the watchlist already works offline, so the
 * screen is useful rather than empty. Diary entries arrive in a later phase.
 */
export const DiaryPlaceholderPage = () => {
  const navigation = useNavigationController();
  const entries = useWatchlistStore((state) => state.entries);
  const hydrate = useWatchlistStore((state) => state.hydrate);
  const [items, setItems] = useState<WatchlistEntry[]>([]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setItems(Object.values(entries).sort((left, right) => right.addedAt - left.addedAt));
  }, [entries]);

  return (
    <div className={styles.page}>
      <div className={`${styles.scroll} scroll-y`}>
        <main className={styles.content}>
          <h1 className={styles.title}>Дневник</h1>
          <p className={styles.lead}>
            Здесь появятся твои записи о просмотренном. Пока — то, что ты отложил.
          </p>

          <section aria-labelledby="watchlist-title">
            <h2 className={styles.sectionTitle} id="watchlist-title">
              Посмотреть позже · {items.length}{' '}
              {plural(items.length, ['фильм', 'фильма', 'фильмов'])}
            </h2>

            {items.length ? (
              <ul className={styles.list}>
                {items.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={styles.item}
                      onClick={() => navigation.openFilm({ filmId: entry.id, title: entry.title })}
                    >
                      <Poster
                        title={entry.title}
                        year={entry.year}
                        posterPath={entry.posterPath}
                        accent={entry.accent}
                        width={64}
                        decorative
                      />
                      <span className={styles.itemBody}>
                        <span className={styles.itemTitle}>{entry.title}</span>
                        <span className={styles.itemMeta}>{entry.year}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Пока пусто. Открой фильм и нажми «Посмотреть позже».</p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};
