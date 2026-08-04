import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import type { FeedItem, FeedReason } from '@domain/feed/feed.types';
import { summaryOf, type Film, type FilmSummary } from '@entities/film/film.model';
import { useWatchlistStore } from '@entities/watchlist/watchlist.store';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { openFilmWithPreflight } from '@pages/film/filmOpening';
import { FeedHeader } from '@pages/feed/components/FeedHeader';
import { Skeleton } from '@shared/ui/Skeleton/Skeleton';
import { Button } from '@shared/ui/Button/Button';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { feedAnalytics } from '../model/feed.analytics';
import { useFeedStore, visibleItems } from '../model/feed.store';
import { useFeedScroll } from '../model/useFeedScroll';
import { usePullToRefresh } from '../model/usePullToRefresh';
import {
  CinematicRecommendationCard,
  CompactCollectionCard,
  DiscoveryCard,
  MilestoneCard,
  ObservationCard,
  WatchlistReturnCard,
  type CardActions,
} from '../components/FeedCards';
import styles from './FeedPage.module.css';

/**
 * The Feed (P0.4).
 *
 * One personal stream: recommendations with checkable reasons, observations
 * with evidence, milestones, watchlist returns, and neutral discovery when
 * there is nothing personal to say yet. The page wires state to composition —
 * assembling, ranking and storage all happen outside React.
 */

/**
 * The posters an observation or a milestone shows as its evidence, taken from
 * the film cache. A missing film simply drops out: the card stays readable and
 * the fallback carries the title (§10.5).
 */
const evidenceFor = (
  filmIds: readonly number[],
  films: Map<number, Film>,
  scoreOf: (filmId: number) => number | null,
) =>
  filmIds
    .map((filmId) => {
      const film = films.get(filmId);
      if (!film) return null;
      return {
        id: filmId,
        title: film.title,
        posterPath: film.posterPath ?? '',
        score: scoreOf(filmId),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

/** Which card renders which item. There is no universal `.feed-card`. */
const CardForItem = ({
  item,
  actions,
  expanded,
  onToggleExpand,
  films,
  scoreOf,
}: {
  item: FeedItem;
  actions: CardActions;
  expanded: boolean;
  onToggleExpand: () => void;
  films: Map<number, Film>;
  scoreOf: (filmId: number) => number | null;
}) => {
  switch (item.kind) {
    case 'cinematicRecommendation':
      return <CinematicRecommendationCard item={item} actions={actions} />;
    case 'compactCollection':
      return <CompactCollectionCard item={item} onOpenFilm={actions.onOpenFilm} />;
    case 'observation':
      return (
        <ObservationCard
          item={item}
          expanded={expanded}
          onToggle={onToggleExpand}
          evidenceFilms={evidenceFor(item.evidence.filmIds, films, scoreOf)}
          onOpenFilm={(filmId) => {
            const film = films.get(filmId);
            if (film) actions.onOpenFilm(summaryOf(film));
          }}
          onDismiss={actions.onDismiss}
        />
      );
    case 'milestone':
      return <MilestoneCard item={item} posters={evidenceFor(item.filmIds, films, () => null)} />;
    case 'watchlistReturn':
      return <WatchlistReturnCard item={item} actions={actions} />;
    case 'discoveryFallback':
      return <DiscoveryCard item={item} actions={actions} />;
  }
};

export const FeedPage = () => {
  const navigation = useNavigationController();
  const { haptics } = useServices();

  const snapshot = useFeedStore((state) => state.snapshot);
  const hydrated = useFeedStore((state) => state.hydrated);
  const refreshing = useFeedStore((state) => state.refreshing);
  const refreshError = useFeedStore((state) => state.refreshError);
  const newItemIds = useFeedStore((state) => state.newItemIds);
  const expandedId = useFeedStore((state) => state.expandedObservationId);

  const hydrate = useFeedStore((state) => state.hydrate);
  const refresh = useFeedStore((state) => state.refresh);
  const rebuildLocal = useFeedStore((state) => state.rebuildLocal);
  const dismissItem = useFeedStore((state) => state.dismissItem);
  const markShown = useFeedStore((state) => state.markShown);
  const markOpened = useFeedStore((state) => state.markOpened);
  const savePosition = useFeedStore((state) => state.savePosition);
  const clearNewItems = useFeedStore((state) => state.clearNewItems);
  const toggleObservation = useFeedStore((state) => state.toggleObservation);

  const watchlist = useWatchlistStore((state) => state.entries);
  const toggleWatchlist = useWatchlistStore((state) => state.toggle);
  const diaryEntries = useDiaryStore((state) => state.entries);
  const showSnackbar = useSnackbarStore((state) => state.show);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [why, setWhy] = useState<{ reason: FeedReason; item: FeedItem } | null>(null);

  const {
    headerVisible,
    restorePosition,
    preserveDuringUpdate,
    scrollToTop,
    atTop,
    currentAnchor,
  } = useFeedScroll(scrollRef);

  const items = useMemo(() => visibleItems(snapshot), [snapshot]);
  const films = useFeedStore((state) => state.films);

  /** A film's own rating, for the numbers an observation shows beside it. */
  const scoreOf = useCallback(
    (filmId: number) =>
      diaryEntries.find((entry) => entry.filmId === filmId)?.overallRating ?? null,
    [diaryEntries],
  );

  /* --- lifecycle --------------------------------------------------------- */

  useEffect(() => {
    void hydrate().then(() => {
      const saved = useFeedStore.getState().position;
      if (saved) {
        restorePosition(saved);
        feedAnalytics.track('feed_position_restored', {});
      }
      feedAnalytics.track('feed_opened', { items: useFeedStore.getState().snapshot.items.length });
      /*
       * Cache first, network second: whatever was stored is already on screen,
       * and the remote candidates arrive behind it without clearing anything
       * (§15.4).
       */
      void refresh();
    });
    // Once per mount: hydration reads storage and restores the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local data changed → observations and milestones are recomputed offline.
  const diaryRevision = diaryEntries.reduce((sum, entry) => sum + entry.revision, 0);
  useEffect(() => {
    if (!hydrated) return;
    void preserveDuringUpdate(() => rebuildLocal());
  }, [diaryRevision, hydrated, preserveDuringUpdate, rebuildLocal]);

  // Tapping the active tab again: to the top, then refresh (§22.7).
  useEffect(
    () =>
      navigation.setActiveTabInterceptor('feed', () => {
        if (!atTop()) {
          scrollToTop(true);
          return;
        }
        void refresh({ manual: true });
      }),
    [navigation, atTop, scrollToTop, refresh],
  );

  /* --- what the user sees ------------------------------------------------- */

  const seen = useRef(new Set<string>());
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !items.length) return;

    const pending = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.feedItem;
          if (!id) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (seen.current.has(id) || pending.has(id)) continue;
            // Seen means looked at, not scrolled past (§35.2).
            pending.set(
              id,
              window.setTimeout(() => {
                pending.delete(id);
                seen.current.add(id);
                markShown([id]);
                feedAnalytics.track('feed_item_seen', { itemId: id });
              }, 800),
            );
          } else {
            const timer = pending.get(id);
            if (timer) {
              clearTimeout(timer);
              pending.delete(id);
            }
          }
        }
      },
      { root, threshold: [0.5] },
    );

    root.querySelectorAll('[data-feed-item]').forEach((node) => observer.observe(node));
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      observer.disconnect();
    };
  }, [items, markShown]);

  /* --- actions ------------------------------------------------------------ */

  const openFilm = useCallback(
    (film: FilmSummary, itemId: string) => {
      // The anchor is where this card sits right now, so coming back puts it
      // back under the same finger (§22.2).
      const anchor = currentAnchor();
      void savePosition({
        anchorItemId: anchor?.anchorItemId ?? itemId,
        anchorOffset: anchor?.anchorOffset ?? 0,
        scrollTopFallback: scrollRef.current?.scrollTop ?? 0,
      });
      void markOpened(itemId);
      feedAnalytics.track('feed_item_opened', { itemId, filmId: film.id });
      haptics.trigger('movieOpen', `feed:${film.id}`);
      openFilmWithPreflight(navigation, film);
    },
    [navigation, haptics, markOpened, savePosition, currentAnchor],
  );

  const bookmark = useCallback(
    (film: FilmSummary) => {
      const wasSaved = Boolean(watchlist[film.id]);
      void toggleWatchlist(film).then(() => {
        feedAnalytics.track(wasSaved ? 'feed_item_dismissed' : 'feed_bookmark_added', {
          filmId: film.id,
        });
      });
      showSnackbar(wasSaved ? 'Убрано из списка' : 'Добавлено в «Посмотреть позже»');
    },
    [watchlist, toggleWatchlist, showSnackbar],
  );

  const dismiss = useCallback(
    (item: FeedItem, action: 'dismiss' | 'notInterested') => {
      void dismissItem(item, action).then((undo) => {
        feedAnalytics.track('feed_item_dismissed', { itemId: item.id, action });
        haptics.trigger('diaryEntryDeleted', `feed:${item.id}`);
        showSnackbar('Скрыто', 6000, {
          label: 'Вернуть',
          onAction: () => {
            void undo().then(() => {
              feedAnalytics.track('feed_action_undone', { itemId: item.id });
              haptics.trigger('undoDelete', `feed:${item.id}`);
            });
          },
        });
      });
    },
    [dismissItem, haptics, showSnackbar],
  );

  const actionsFor = useCallback(
    (item: FeedItem): CardActions => ({
      onOpenFilm: (film) => openFilm(film, item.id),
      onBookmark: bookmark,
      onDismiss: () => dismiss(item, 'notInterested'),
      isBookmarked: (filmId) => Boolean(watchlist[filmId]),
      ...(item.reason
        ? {
            onWhy: () => {
              setWhy({ reason: item.reason!, item });
              feedAnalytics.track('recommendation_reason_opened', { itemId: item.id });
            },
          }
        : {}),
      onSwipeThreshold: () => haptics.trigger('ratingValueChange', `swipe:${item.id}`),
    }),
    [openFilm, bookmark, dismiss, watchlist, haptics],
  );

  /* --- pull to refresh ---------------------------------------------------- */

  const onPullRefresh = useCallback(async () => {
    const result = await preserveDuringUpdate(() => refresh({ manual: true }));
    feedAnalytics.track(result === 'unchanged' ? 'feed_refresh_no_change' : 'feed_refreshed', {});

    if (result === 'new') haptics.trigger('ratingSaved', `feed:refresh:${Date.now()}`);
    // No new content earns no success haptic and no celebration (§21.7).
    else if (result === 'unchanged') showSnackbar('Пока ничего нового');
    else showSnackbar('Не получилось обновить');
    return result;
  }, [preserveDuringUpdate, refresh, haptics, showSnackbar]);

  const pull = usePullToRefresh({
    scrollRef,
    onRefresh: onPullRefresh,
    onArmed: () => haptics.trigger('tabSelection', 'feed:pull'),
    disabled: why !== null,
  });

  /* --- render ------------------------------------------------------------- */

  const empty = hydrated && items.length === 0 && !refreshing;

  /*
   * The one error worth feeling: nothing cached, nothing local, nothing
   * fetched. Fired once — a retry that fails again does not buzz twice.
   */
  const announcedEmpty = useRef(false);
  useEffect(() => {
    if (!empty || announcedEmpty.current) return;
    announcedEmpty.current = true;
    haptics.trigger('criticalError', 'feed:empty');
  }, [empty, haptics]);
  const showSkeletons = !hydrated && items.length === 0;

  return (
    <div className={styles.page}>
      <div className={styles.shade} aria-hidden="true" />

      <div
        className={`${styles.scroll} scroll-y`}
        ref={scrollRef}
        {...pull.handlers}
        data-testid="feed-scroll"
      >
        <div className={styles.header} data-hidden={!headerVisible || undefined}>
          <FeedHeader
            onSearch={() => navigation.openPicker()}
            onProfile={() => navigation.selectTab('profile')}
          />
        </div>

        <main className={styles.content}>
          {/* The pull marker takes the space the finger asks for, no more. */}
          <div
            className={styles.pullMarker}
            style={{ height: `${Math.round(pull.progress * 56)}px` }}
            data-state={pull.state}
            data-testid="feed-pull-marker"
            aria-hidden={!pull.active}
          >
            {pull.state === 'refreshing'
              ? 'Обновляем'
              : pull.state === 'armed'
                ? 'Отпусти'
                : pull.active
                  ? 'Потяни'
                  : ''}
          </div>

          {newItemIds.length ? (
            <button
              type="button"
              className={styles.newItems}
              onClick={() => {
                clearNewItems();
                scrollToTop(true);
              }}
              data-testid="feed-new-items"
            >
              Есть новое
            </button>
          ) : null}

          {showSkeletons ? (
            <div className={styles.skeletons} data-testid="feed-skeletons" aria-hidden="true">
              <Skeleton height="52vh" radius="var(--radius-xl)" />
              <Skeleton height={104} radius="var(--radius-lg)" />
            </div>
          ) : null}

          {/* Honest cold start: an invitation, never a fake personal claim. */}
          {hydrated && diaryEntries.length === 0 && items.length > 0 ? (
            <section className={styles.invitation} data-testid="feed-invitation">
              <p className={styles.invitationTitle}>Оцени первый фильм</p>
              <p className={styles.invitationText}>
                Здесь появятся личные наблюдения и рекомендации по твоим оценкам.
              </p>
            </section>
          ) : null}

          {items.map((item) => (
            <div key={item.id} data-item-id={item.id} data-feed-item={item.id}>
              <CardForItem
                item={item}
                actions={actionsFor(item)}
                films={films}
                scoreOf={scoreOf}
                expanded={expandedId === item.id}
                onToggleExpand={() => {
                  toggleObservation(expandedId === item.id ? null : item.id);
                  if (expandedId !== item.id) {
                    feedAnalytics.track('observation_expanded', { itemId: item.id });
                  }
                }}
              />
            </div>
          ))}

          {/* A failed refresh keeps the feed and says so quietly (§25.4). */}
          {refreshError !== 'none' && items.length > 0 ? (
            <p className={styles.staleNote} data-testid="feed-stale-note">
              Показываем сохранённую ленту.{' '}
              <button type="button" onClick={() => void refresh({ manual: true })}>
                Обновить
              </button>
            </p>
          ) : null}

          {empty ? (
            <div className={styles.invitation} data-testid="feed-empty">
              <p className={styles.invitationTitle}>Не получилось загрузить ленту.</p>
              <p className={styles.invitationText}>
                Нет сохранённой ленты и нет связи. Оценки и Дневник на месте.
              </p>
              <Button
                variant="primary"
                onClick={() => void refresh({ manual: true })}
                data-testid="feed-retry"
              >
                Попробовать снова
              </Button>
            </div>
          ) : null}

          {items.length > 0 && !refreshing ? (
            <p className={styles.end} data-testid="feed-end">
              Это вся лента на сейчас
            </p>
          ) : null}
        </main>
      </div>

      {/* Why is this here (§7.3) — the reason, its sources, and a way out. */}
      <Sheet open={why !== null} title="Почему это здесь?" onClose={() => setWhy(null)}>
        {why ? (
          <div className={styles.why}>
            <p className={styles.whyReason}>{why.reason.shortText}</p>
            {why.reason.evidenceLabel ? (
              <p className={styles.invitationText}>{why.reason.evidenceLabel}</p>
            ) : null}

            <div className={styles.whyActions}>
              <Button
                variant="secondary"
                block
                onClick={() => {
                  const item = why.item;
                  setWhy(null);
                  dismiss(item, 'notInterested');
                }}
                data-testid="feed-why-not-interested"
              >
                Неинтересно
              </Button>
              <Button variant="ghost" block onClick={() => setWhy(null)}>
                Понятно
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
};
