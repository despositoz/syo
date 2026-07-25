import type { FeedItem } from '@entities/feed/feed.model';

/** What the page needs to render — no repository or query types leak into JSX. */
export interface FeedViewModel {
  items: FeedItem[];
  /** True only when there is nothing at all to show yet. */
  isEmpty: boolean;
  /** A refresh is running over data that is already on screen. */
  isRefreshing: boolean;
  /** Network failed *and* no cached data exists. */
  hasFatalError: boolean;
  /** Network failed but cached data is shown. */
  isStaleAfterError: boolean;
  updatedAt: number;
  retry: () => void;
}
