import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigationController } from '@app/appServices';
import { filmRepository } from '@entities/film/film.repository';
import { openFilmWithPreflight } from '@pages/film/filmOpening';
import { feedRepository } from '@entities/feed/feed.repository';
import type { FilmSummary } from '@entities/film/film.model';
import { isTmdbConfigured } from '@shared/api/tmdb/tmdb.client';
import { BackControl } from '@shared/ui/BackControl/BackControl';
import { ErrorBlock } from '@shared/ui/ErrorBlock/ErrorBlock';
import { Skeleton } from '@shared/ui/Skeleton/Skeleton';
import { SearchField } from './components/SearchField';
import { ResultRow } from './components/ResultRow';
import styles from './MoviePickerPage.module.css';

const SEARCH_DEBOUNCE_MS = 280;

/**
 * "Что ты посмотрел?" is the first thing on the screen — no eyebrow line above
 * it, and no "SYO слушает после фильма" (spec §14).
 */
export const MoviePickerPage = () => {
  const navigation = useNavigationController();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const configured = isTmdbConfigured();

  const popular = useQuery({
    queryKey: ['picker', 'popular'],
    queryFn: ({ signal }) => feedRepository.fetchPopular(signal),
    enabled: configured,
  });

  const search = useQuery({
    queryKey: ['picker', 'search', debounced],
    queryFn: ({ signal }) => filmRepository.search(debounced, signal),
    enabled: configured && debounced.length >= 2,
  });

  const searching = debounced.length >= 2;
  const results: FilmSummary[] = searching ? (search.data ?? []) : (popular.data ?? []);
  const loading = searching ? search.isPending : popular.isPending;
  const failed = searching ? search.isError : popular.isError;

  const openFilm = (film: FilmSummary) => {
    void filmRepository.saveSummaryAsFilm(film);
    // Preflight starts here, before the route is pushed (spec §17).
    openFilmWithPreflight(navigation, film);
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <BackControl onBack={() => navigation.goBack()} label="Закрыть выбор фильма" />
      </div>

      <div className={`${styles.scroll} scroll-y`}>
        <main className={styles.content}>
          <h1 className={styles.title}>Что ты посмотрел?</h1>

          <SearchField
            value={query}
            onChange={(value) => {
              setQuery(value);
              navigation.registerDeliberateAction();
            }}
            onClear={() => setQuery('')}
          />

          <section aria-label={searching ? 'Результаты поиска' : 'Популярное сегодня'}>
            <h2 className={styles.sectionTitle}>
              {searching ? 'Результаты' : 'Популярное сегодня'}
            </h2>

            {!configured ? (
              <ErrorBlock message="TMDB-токен не настроен. Добавь VITE_TMDB_API_KEY в .env." />
            ) : null}

            {loading && configured ? (
              <div className={styles.skeletons} aria-hidden="true">
                {[0, 1, 2, 3, 4].map((index) => (
                  <Skeleton key={index} height={76} radius="var(--radius-md)" />
                ))}
              </div>
            ) : null}

            {failed && !results.length ? (
              <ErrorBlock
                message="Не получилось загрузить список фильмов."
                onRetry={() => void (searching ? search.refetch() : popular.refetch())}
              />
            ) : null}

            {!loading && configured && searching && !results.length && !failed ? (
              <p className={styles.empty}>Ничего не нашлось. Попробуй другое название.</p>
            ) : null}

            <ul className={styles.results}>
              {results.map((film) => (
                <ResultRow key={film.id} film={film} onSelect={openFilm} />
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
};
