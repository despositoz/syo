import { useCallback, type ReactNode } from 'react';
import { imagePipeline } from '@shared/images/ImagePipeline';
import { Poster } from '@shared/ui/Poster/Poster';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BookmarkIcon, MenuIcon } from '@shared/ui/icons';
import { joinMeta } from '@shared/utils/text';
import type { FilmSummary } from '@entities/film/film.model';
import type {
  CinematicRecommendationItem,
  CompactCollectionItem,
  DiscoveryFallbackItem,
  MilestoneItem,
  ObservationItem,
  WatchlistReturnItem,
} from '@domain/feed/feed.types';
import { useCardParallax } from '../model/useCardParallax';
import { useCardSwipe, type SwipeDirection } from '../model/useCardSwipe';
import styles from './FeedCards.module.css';

/**
 * The feed's compositions (P0.4 §17).
 *
 * Markup rule throughout: the card container is never a button. The film link,
 * the bookmark and the menu are separate controls, so nothing is nested inside
 * anything clickable and the keyboard order stays sane (§20.10).
 */

export interface CardActions {
  onOpenFilm: (film: FilmSummary) => void;
  onBookmark: (film: FilmSummary) => void;
  onDismiss: () => void;
  onWhy?: () => void;
  isBookmarked: (filmId: number) => boolean;
  onSwipeThreshold?: (direction: SwipeDirection) => void;
}

/* --- shared shell -------------------------------------------------------- */

/**
 * Wraps a film card in the swipe gesture and its action backgrounds. The
 * gesture is an accelerator: every action behind it also exists as a button.
 */
const SwipeHost = ({
  children,
  bookmarked,
  onBookmark,
  onDismiss,
  onThreshold,
}: {
  children: ReactNode;
  bookmarked: boolean;
  onBookmark: () => void;
  onDismiss: () => void;
  onThreshold?: (direction: SwipeDirection) => void;
}) => {
  const commit = useCallback(
    (direction: SwipeDirection) => {
      if (direction === 'right') onBookmark();
      else onDismiss();
    },
    [onBookmark, onDismiss],
  );

  const swipe = useCardSwipe({
    onCommit: commit,
    ...(onThreshold ? { onThreshold } : {}),
    // Swiping right on something already saved must not remove it (§20.2).
    allowRight: !bookmarked,
  });

  return (
    <div className={styles.swipeHost}>
      <div className={styles.actionLayer} aria-hidden="true">
        <span
          className={styles.actionSide}
          data-side="right"
          data-armed={swipe.direction === 'right' && swipe.armed}
        >
          <BookmarkIcon /> Посмотреть позже
        </span>
        <span
          className={styles.actionSide}
          data-side="left"
          data-armed={swipe.direction === 'left' && swipe.armed}
        >
          Неинтересно
        </span>
      </div>

      <div
        className={styles.swipeCard}
        data-dragging={swipe.dragging}
        style={{ transform: `translate3d(${swipe.offset}px, 0, 0)` }}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
  );
};

const FilmControls = ({
  film,
  actions,
  inline = false,
}: {
  film: FilmSummary;
  actions: CardActions;
  inline?: boolean;
}) => {
  const bookmarked = actions.isBookmarked(film.id);
  return (
    <div className={styles.cardActions} data-inline={inline}>
      <IconButton
        label={bookmarked ? 'Убрать из «Посмотреть позже»' : 'Посмотреть позже'}
        aria-pressed={bookmarked}
        onClick={() => actions.onBookmark(film)}
        data-testid="feed-bookmark"
      >
        <BookmarkIcon filled={bookmarked} />
      </IconButton>

      {actions.onWhy ? (
        <IconButton label="Почему это здесь?" onClick={actions.onWhy} data-testid="feed-why">
          <MenuIcon />
        </IconButton>
      ) : null}
    </div>
  );
};

/* --- cinematic recommendation -------------------------------------------- */

export const CinematicRecommendationCard = ({
  item,
  actions,
}: {
  item: CinematicRecommendationItem;
  actions: CardActions;
}) => {
  const { frameRef, layerRef } = useCardParallax<HTMLButtonElement>({ travel: 72 });
  const { film } = item;
  const backdrop = film.backdropPath ? imagePipeline.backdrop(film.backdropPath, 780) : '';

  return (
    <SwipeHost
      bookmarked={actions.isBookmarked(film.id)}
      onBookmark={() => actions.onBookmark(film)}
      onDismiss={actions.onDismiss}
      {...(actions.onSwipeThreshold ? { onThreshold: actions.onSwipeThreshold } : {})}
    >
      <article
        className={styles.cinematic}
        style={{ ['--card-accent-rgb' as string]: film.accent.rgb }}
        data-testid="feed-cinematic"
        data-item-id={item.id}
      >
        <button
          type="button"
          className={styles.cinematicMedia}
          ref={frameRef}
          onClick={() => actions.onOpenFilm(film)}
          aria-label={`${film.title}. ${item.reason.shortText}`}
          data-testid="feed-open-film"
        >
          {/*
            A missing backdrop stays missing: the accent gradient carries the
            frame. A vertical poster is never stretched across it (§4.2).
          */}
          {backdrop ? (
            <span className={styles.cinematicLayer} ref={layerRef as never}>
              <img className={styles.cinematicImage} src={backdrop} alt="" loading="lazy" />
            </span>
          ) : null}
          <span className={styles.cinematicScrim} aria-hidden="true" />
        </button>

        <div className={styles.cinematicBody}>
          <h3 className={styles.cinematicTitle}>{film.title}</h3>
          <p className={styles.meta}>{joinMeta([film.year, film.genres[0] ?? ''])}</p>
          <p className={styles.reason}>{item.reason.shortText}</p>
        </div>

        <FilmControls film={film} actions={actions} />
      </article>
    </SwipeHost>
  );
};

/* --- observation ---------------------------------------------------------- */

export const ObservationCard = ({
  item,
  expanded,
  onToggle,
  evidenceFilms,
  onOpenFilm,
  onDismiss,
}: {
  item: ObservationItem;
  expanded: boolean;
  onToggle: () => void;
  /** Whatever is cached for the evidence ids — missing ones fall back. */
  evidenceFilms: Array<{ id: number; title: string; posterPath: string; score: number | null }>;
  onOpenFilm: (filmId: number) => void;
  onDismiss: () => void;
}) => (
  <article className={styles.observation} data-testid="feed-observation" data-item-id={item.id}>
    {/* One depth layer for the whole collage, not five drifting posters. */}
    <div className={styles.collage} aria-hidden="true">
      {evidenceFilms.slice(0, 4).map((film) => (
        <span className={styles.collageFrame} key={film.id} data-poster-frame="">
          <Poster title={film.title} posterPath={film.posterPath} requestWidth={92} decorative />
        </span>
      ))}
    </div>

    <h3 className={styles.observationHeadline}>{item.headline}</h3>
    {item.supportingText ? (
      <p className={styles.observationSupport}>{item.supportingText}</p>
    ) : null}

    <div className={styles.cardActions} data-inline="true">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`evidence-${item.id}`}
        data-testid="feed-observation-toggle"
      >
        {expanded ? 'Скрыть' : 'Откуда это'}
      </button>
      <button type="button" onClick={onDismiss} data-testid="feed-observation-dismiss">
        Скрыть наблюдение
      </button>
    </div>

    {expanded ? (
      <div className={styles.evidence} id={`evidence-${item.id}`} data-testid="feed-evidence">
        {/* Plain language, never a formula or a confidence percentage (§10.3). */}
        <p className={styles.evidenceLine}>Считано по {item.evidence.sampleSize} твоим оценкам</p>
        <div className={styles.evidenceFilms}>
          {evidenceFilms.map((film) => (
            <button
              type="button"
              className={styles.evidenceFilm}
              key={film.id}
              onClick={() => onOpenFilm(film.id)}
              data-testid="feed-evidence-film"
            >
              <span className={styles.evidencePoster} data-poster-frame="">
                <Poster
                  title={film.title}
                  posterPath={film.posterPath}
                  requestWidth={64}
                  decorative
                />
              </span>
              <span className={styles.evidenceTitle}>{film.title}</span>
              {film.score !== null ? (
                <span className={styles.evidenceScore}>{film.score}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    ) : null}
  </article>
);

/* --- milestone ------------------------------------------------------------ */

export const MilestoneCard = ({
  item,
  posters,
}: {
  item: MilestoneItem;
  posters: Array<{ id: number; title: string; posterPath: string }>;
}) => (
  <article className={styles.milestone} data-testid="feed-milestone" data-item-id={item.id}>
    <span className={styles.milestoneValue}>{item.value}</span>
    <h3 className={styles.milestoneHeadline}>{item.headline}</h3>
    {item.supportingText ? <p className={styles.meta}>{item.supportingText}</p> : null}

    {posters.length ? (
      <div className={styles.milestonePosters} aria-hidden="true">
        {posters.slice(0, 3).map((film) => (
          <span className={styles.milestonePoster} key={film.id} data-poster-frame="">
            <Poster title={film.title} posterPath={film.posterPath} requestWidth={64} decorative />
          </span>
        ))}
      </div>
    ) : null}
  </article>
);

/* --- watchlist return and discovery --------------------------------------- */

const FilmRow = ({
  film,
  label,
  supporting,
  actions,
  testId,
  itemId,
}: {
  film: FilmSummary;
  label: string | null;
  supporting: string | null;
  actions: CardActions;
  testId: string;
  itemId: string;
}) => (
  <SwipeHost
    bookmarked={actions.isBookmarked(film.id)}
    onBookmark={() => actions.onBookmark(film)}
    onDismiss={actions.onDismiss}
    {...(actions.onSwipeThreshold ? { onThreshold: actions.onSwipeThreshold } : {})}
  >
    <article className={styles.row} data-testid={testId} data-item-id={itemId}>
      <span className={styles.rowPoster} data-poster-frame="">
        <Poster
          title={film.title}
          year={film.year}
          posterPath={film.posterPath}
          accent={film.accent}
          requestWidth={128}
          decorative
        />
      </span>

      <span className={styles.rowBody}>
        {label ? <span className={styles.label}>{label}</span> : null}
        <button
          type="button"
          className={styles.rowTitle}
          onClick={() => actions.onOpenFilm(film)}
          data-testid="feed-open-film"
        >
          {film.title}
        </button>
        {supporting ? <span className={styles.meta}>{supporting}</span> : null}
      </span>

      <FilmControls film={film} actions={actions} inline />
    </article>
  </SwipeHost>
);

export const WatchlistReturnCard = ({
  item,
  actions,
}: {
  item: WatchlistReturnItem;
  actions: CardActions;
}) => (
  <FilmRow
    film={item.film}
    label="Из твоего списка"
    // Context, never pressure: no countdown, no "you still haven't" (§12.3).
    supporting={item.reason?.evidenceLabel ?? 'Ты добавил его некоторое время назад'}
    actions={actions}
    testId="feed-watchlist-return"
    itemId={item.id}
  />
);

export const DiscoveryCard = ({
  item,
  actions,
}: {
  item: DiscoveryFallbackItem;
  actions: CardActions;
}) => (
  <FilmRow
    film={item.film}
    // No label: it does not pretend to be personal (§17.6).
    label={null}
    supporting={item.reason?.shortText ?? null}
    actions={actions}
    testId="feed-discovery"
    itemId={item.id}
  />
);

/* --- collection rail ------------------------------------------------------ */

export const CompactCollectionCard = ({
  item,
  onOpenFilm,
}: {
  item: CompactCollectionItem;
  onOpenFilm: (film: FilmSummary) => void;
}) => (
  <section className={styles.collection} data-testid="feed-collection" data-item-id={item.id}>
    <h3 className={styles.collectionTitle}>{item.title}</h3>
    {item.subtitle ? <p className={styles.meta}>{item.subtitle}</p> : null}

    <div className={styles.rail}>
      {item.films.map(({ film }) => (
        <button
          type="button"
          className={styles.railItem}
          key={film.id}
          onClick={() => onOpenFilm(film)}
          data-testid="feed-open-film"
        >
          <span className={styles.railPoster} data-poster-frame="">
            <Poster
              title={film.title}
              posterPath={film.posterPath}
              accent={film.accent}
              requestWidth={232}
              decorative
            />
          </span>
          <span className={styles.railTitle}>{film.title}</span>
        </button>
      ))}
    </div>
  </section>
);
