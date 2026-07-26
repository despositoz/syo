import { useRef } from 'react';
import { useNavigationController } from '@app/appServices';
import type { FilmSummary } from '@entities/film/film.model';
import { filmRepository } from '@entities/film/film.repository';
import { ErrorBlock } from '@shared/ui/ErrorBlock/ErrorBlock';
import { Skeleton } from '@shared/ui/Skeleton/Skeleton';
import { openFilmWithPreflight } from '@pages/film/filmOpening';
import { useFeed } from './feed.service';
import { FeedHeader } from './components/FeedHeader';
import { CinematicCard } from './components/CinematicCard';
import { CompactCard } from './components/CompactCard';
import styles from './FeedPage.module.css';

/**
 * The first screen. It opens immediately with whatever is cached; the network
 * refresh lands in place, without clearing the list.
 */
export const FeedPage = () => {
  const navigation = useNavigationController();
  const scrollRef = useRef<HTMLDivElement>(null);
  const feed = useFeed();

  const openFilm = (film: FilmSummary) => {
    // The summary is stored first, so the Film Page has data even offline.
    void filmRepository.saveSummaryAsFilm(film);
    // Preflight starts here, before the route is pushed (spec §17).
    openFilmWithPreflight(navigation, film);
  };

  const [hero, ...rest] = feed.items;

  return (
    <div className={styles.page}>
      <div className={`${styles.scroll} scroll-y`} ref={scrollRef}>
        <FeedHeader
          onSearch={() => navigation.openPicker()}
          onProfile={() => navigation.selectTab('profile')}
        />

        <main className={styles.content}>
          {feed.hasFatalError ? (
            <ErrorBlock
              variant="screen"
              message="Не получилось загрузить ленту."
              onRetry={feed.retry}
            />
          ) : null}

          {feed.isEmpty && !feed.hasFatalError ? (
            <div className={styles.skeletons} aria-hidden="true">
              <Skeleton height="52vh" radius="var(--radius-xl)" />
              <Skeleton height={104} radius="var(--radius-lg)" />
              <Skeleton height={104} radius="var(--radius-lg)" />
            </div>
          ) : null}

          {hero ? <CinematicCard film={hero.film} scrollRef={scrollRef} onOpen={openFilm} /> : null}

          {rest.length ? (
            <section className={styles.list} aria-label="Другие фильмы">
              {rest.map((item) => (
                <CompactCard key={item.id} film={item.film} onOpen={openFilm} />
              ))}
            </section>
          ) : null}

          {feed.isStaleAfterError ? (
            <p className={styles.staleNote}>
              Показаны сохранённые данные.{' '}
              <button type="button" onClick={feed.retry}>
                Обновить
              </button>
            </p>
          ) : null}
        </main>
      </div>
    </div>
  );
};
