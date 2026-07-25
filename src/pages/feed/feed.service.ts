import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '@app/appServices';
import { feedRepository } from '@entities/feed/feed.repository';
import { emptySnapshot, type FeedSnapshot } from '@entities/feed/feed.model';
import { isTmdbConfigured } from '@shared/api/tmdb/tmdb.client';
import type { FeedViewModel } from './feed.types';

export const FEED_QUERY_KEY = ['feed', 'trending'] as const;

/**
 * Startup order (spec §24): local data paints first, the network refresh then
 * replaces it in place. The screen is never cleared and cards never jump.
 */
export const useFeed = (): FeedViewModel => {
  const [cache, setCache] = useState<FeedSnapshot>(emptySnapshot());
  const [cacheRead, setCacheRead] = useState(false);

  useEffect(() => {
    let active = true;
    void feedRepository.readCache().then((snapshot) => {
      if (active) {
        setCache(snapshot);
        setCacheRead(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const query = useQuery({
    queryKey: FEED_QUERY_KEY,
    queryFn: ({ signal }) => feedRepository.fetchTrending(signal),
    enabled: cacheRead && isTmdbConfigured(),
  });

  const snapshot = query.data ?? cache;
  const hasItems = snapshot.items.length > 0;

  /*
   * A refresh that actually brings something new is worth one soft confirmation.
   * The very first paint is not a refresh, so the baseline is recorded silently.
   */
  const { haptics } = useServices();
  const seenTopId = useRef<number | null>(null);
  useEffect(() => {
    const top = snapshot.items[0]?.id ?? null;
    if (top === null || top === seenTopId.current) return;
    const isFirstPaint = seenTopId.current === null;
    seenTopId.current = top;
    if (!isFirstPaint) haptics.trigger('refreshNewContent', String(top));
  }, [snapshot.items, haptics]);

  return {
    items: snapshot.items,
    isEmpty: !hasItems && (query.isPending || !cacheRead),
    isRefreshing: query.isFetching && hasItems,
    hasFatalError: Boolean(query.isError && !hasItems),
    isStaleAfterError: Boolean(query.isError && hasItems),
    updatedAt: snapshot.updatedAt,
    retry: () => void query.refetch(),
  };
};
