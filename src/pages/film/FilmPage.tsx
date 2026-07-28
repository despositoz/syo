import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigationController, useServices } from '@app/appServices';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { filmRepository } from '@entities/film/film.repository';
import {
  emptyFilm,
  formatRating,
  formatRuntime,
  summaryOf,
  type Film,
} from '@entities/film/film.model';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { isTmdbConfigured } from '@shared/api/tmdb/tmdb.client';
import { ErrorBlock } from '@shared/ui/ErrorBlock/ErrorBlock';
import { ImageStage } from '@shared/ui/ImageStage/ImageStage';
import { Poster } from '@shared/ui/Poster/Poster';
import { Skeleton } from '@shared/ui/Skeleton/Skeleton';
import { TopShade } from '@shared/ui/TopShade/TopShade';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useScrollParallax } from '@shared/utils/parallax';
import { joinMeta } from '@shared/utils/text';
import { FilmToolbar } from './components/FilmToolbar';
import { FilmTitleGroup } from './components/FilmTitleGroup';
import { FilmActionRow } from './components/FilmActionRow';
import { FilmDetails } from './components/FilmDetails';
import { FilmCast } from './components/FilmCast';
import { useRatingStore, draftMatchesFilm } from '@features/rating/model/rating.store';
import { useJournalStore } from '@features/journal/model/journal.store';
import { prepareFilmPresentationCached, type FilmPresentation } from './film.presentation';
import { takeFilmOpening } from './filmOpening';
import styles from './FilmPage.module.css';

export interface FilmPageProps {
  filmId: number;
  initialTitle?: string;
}

const POSTER_WIDTH = 96;
/** Extra scale so a parallax shift never exposes an edge of the backdrop. */
const BACKDROP_OVERSCAN = 1.18;

/**
 * Loads the film cache-first, then refreshes from the network.
 * The screen is never cleared while refreshing.
 */
const useFilmData = (filmId: number) => {
  const [cached, setCached] = useState<Film | null>(null);
  const [cacheRead, setCacheRead] = useState(false);

  useEffect(() => {
    let active = true;
    setCacheRead(false);
    void filmRepository.getCached(filmId).then((film) => {
      if (!active) return;
      setCached(film);
      setCacheRead(true);
    });
    return () => {
      active = false;
    };
  }, [filmId]);

  const query = useQuery({
    queryKey: ['film', filmId],
    queryFn: ({ signal }) => filmRepository.fetchDetails(filmId, signal),
    enabled: cacheRead && isTmdbConfigured(),
  });

  return {
    film: query.data ?? cached,
    isPending: !cacheRead || (query.isPending && !cached),
    isError: query.isError,
    retry: () => void query.refetch(),
  };
};

/**
 * Consumes the preflight that the opening coordinator started before this route
 * was pushed (spec §17). The result is frozen: once it lands, the hero
 * composition never changes again.
 *
 * A deep link or a reload has no coordinator opening to join, so the page falls
 * back to running the preflight itself — the same function, one preflight.
 */
const useFilmPresentation = (filmId: number, film: Film | null): FilmPresentation | null => {
  const [presentation, setPresentation] = useState<FilmPresentation | null>(null);
  /**
   * One preflight per film id, shared by every run of this effect.
   * A plain "already started" boolean would leave the hero blank forever if the
   * effect is torn down and re-run before the promise resolves (StrictMode,
   * remounts) — the second run would skip, and the first run's result was
   * already discarded.
   */
  const inflight = useRef(new Map<number, Promise<FilmPresentation>>());

  useEffect(() => {
    const started = takeFilmOpening(filmId);
    const pending =
      started ??
      inflight.current.get(filmId) ??
      (() => {
        if (!film) return null;
        // Without detailed data there are no logo candidates yet, and
        // committing to text early would lock the hero into text for this whole
        // opening.
        if (!film.detailed && !film.logoCandidates.length) return null;
        const promise = prepareFilmPresentationCached(film);
        inflight.current.set(filmId, promise);
        return promise;
      })();

    if (!pending) return;

    let active = true;
    void pending.then((result) => {
      if (active) setPresentation(result);
    });
    return () => {
      active = false;
    };
  }, [filmId, film]);

  return presentation;
};

export const FilmPage = ({ filmId, initialTitle }: FilmPageProps) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();
  const showSnackbar = useSnackbarStore((state) => state.show);

  const scrollRef = useRef<HTMLDivElement>(null);
  const backdropLayerRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const actionRowRef = useRef<HTMLDivElement>(null);

  const { film, isPending, isError, retry } = useFilmData(filmId);
  const presentation = useFilmPresentation(filmId, film);

  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);
  const ambientEnabled = usePerformanceStore((state) => state.ambientEnabled);

  /*
   * Parallax: only the backdrop lags behind, with the ambient light following
   * it. The poster scrolls with the title and metadata as one solid block —
   * a poster drifting against the text reads as a glitch, not as depth.
   */
  const layers = useMemo(
    () => [
      {
        ref: backdropLayerRef,
        speed: reducedMotion ? 0.86 : 0.42,
        // Carries the CSS overscan, plus the growth on a pull-down.
        baseScale: BACKDROP_OVERSCAN,
        stretch: reducedMotion ? 0 : 0.16,
      },
      { ref: ambientRef, speed: reducedMotion ? 0.86 : 0.42 },
    ],
    [reducedMotion],
  );
  useScrollParallax(scrollRef, layers, true);

  /* --- one watchlist function, two projections (spec §16) ----------------- */
  const inWatchlist = useWatchlistStore((state) => Boolean(state.entries[filmId]));
  const toggleWatchlist = useWatchlistStore((state) => state.toggle);
  const [actionRowVisible, setActionRowVisible] = useState(true);

  useEffect(() => {
    const target = actionRowRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setActionRowVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [film]);

  const onToggleWatchlist = useCallback(() => {
    if (!film) return;
    void toggleWatchlist(summaryOf(film)).then((result) => {
      // One dedupe key for both projections: they can never double-fire.
      haptics.trigger(
        result.inWatchlist ? 'bookmarkAdd' : 'bookmarkRemove',
        `watchlist:${film.id}`,
      );
      showSnackbar(result.message);
    });
  }, [film, toggleWatchlist, haptics, showSnackbar]);

  /*
   * The CTA is the only entrance to the rating flow. Its label states what
   * will actually happen: continue an unfinished draft, change a saved
   * rating, or start a new one.
   */
  const draft = useRatingStore((state) => state.draft);
  const savedEntry = useJournalStore((state) =>
    state.entries.find((entry) => entry.filmId === filmId),
  );
  const hasOwnDraft = draftMatchesFilm(draft, filmId);
  const ctaLabel = hasOwnDraft
    ? 'Продолжить оценку'
    : savedEntry
      ? 'Изменить оценку'
      : 'Начать оценку';

  const onRate = useCallback(() => {
    navigation.openRating({ kind: 'rateMode', filmId });
  }, [navigation, filmId]);

  /* --- render ------------------------------------------------------------ */

  if (!film && isError) {
    return (
      <div className={styles.page}>
        <FilmToolbar
          onBack={() => navigation.goBack()}
          inWatchlist={false}
          showBookmark={false}
          onToggleWatchlist={() => {}}
        />
        <ErrorBlock variant="screen" onRetry={retry} />
      </div>
    );
  }

  const view = film ?? emptyFilm(filmId, initialTitle ?? '');
  const meta = joinMeta([
    view.year,
    formatRuntime(view.runtime),
    view.genres.slice(0, 2).join(', '),
  ]);

  return (
    <div className={styles.page}>
      <FilmToolbar
        onBack={() => navigation.goBack()}
        inWatchlist={inWatchlist}
        showBookmark={!actionRowVisible && Boolean(film)}
        onToggleWatchlist={onToggleWatchlist}
      />

      <div className={`${styles.scroll} scroll-y`} ref={scrollRef}>
        <header className={styles.hero}>
          <div className={styles.backdrop}>
            <ImageStage
              path={view.backdropPath}
              kind="backdrop"
              accent={view.accent}
              width={780}
              priority
              layerRef={backdropLayerRef}
              overscan={BACKDROP_OVERSCAN}
            />
          </div>

          {ambientEnabled ? (
            <div
              className={styles.ambient}
              ref={ambientRef}
              aria-hidden="true"
              style={{ ['--ambient-rgb' as string]: view.accent.rgb }}
            />
          ) : null}

          <div className={styles.heroScrim} aria-hidden="true" />
          <TopShade />

          <div className={styles.heroContent}>
            <div className={styles.posterHolder}>
              <Poster
                title={view.title}
                year={view.year}
                posterPath={view.posterPath}
                accent={view.accent}
                width={POSTER_WIDTH}
                priority
                decorative
              />
            </div>

            <div className={styles.heroText}>
              <FilmTitleGroup
                title={view.title || initialTitle || ''}
                presentation={presentation}
              />

              {meta ? <p className={styles.meta}>{meta}</p> : null}

              {view.rating > 0 ? (
                <p className={styles.rating}>
                  <span aria-hidden="true">★</span> {formatRating(view.rating)}
                  <span className={styles.ratingSource}> · TMDB</span>
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <main className={styles.content}>
          <FilmActionRow
            ref={actionRowRef}
            accent={view.accent}
            inWatchlist={inWatchlist}
            onRate={onRate}
            ctaLabel={ctaLabel}
            onToggleWatchlist={onToggleWatchlist}
          />

          {isPending && !view.overview ? (
            <div className={styles.skeletons} aria-hidden="true">
              <Skeleton height={18} radius={8} />
              <Skeleton height={18} radius={8} />
              <Skeleton height={18} width="70%" radius={8} />
            </div>
          ) : null}

          {view.overview ? <p className={styles.overview}>{view.overview}</p> : null}

          {view.director ? (
            <p className={styles.director}>
              <span className={styles.directorLabel}>Режиссёр</span>
              {view.director}
            </p>
          ) : null}

          <FilmDetails film={view} />
          <FilmCast cast={view.cast} />

          {isError && film ? (
            <p className={styles.staleNote}>
              Показаны сохранённые данные.{' '}
              <button type="button" onClick={retry}>
                Обновить
              </button>
            </p>
          ) : null}
        </main>
      </div>
    </div>
  );
};
