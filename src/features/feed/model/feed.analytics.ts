/**
 * Typed analytics boundary (P0.4 §35).
 *
 * No SDK, no network, no third party. The point is that every call site is
 * typed and that one place decides what may be recorded — so when a backend
 * appears, the privacy rules are already enforced here rather than scattered
 * across components.
 */

export type FeedEvent =
  | 'feed_opened'
  | 'feed_refreshed'
  | 'feed_refresh_no_change'
  | 'feed_item_seen'
  | 'feed_item_opened'
  | 'recommendation_reason_opened'
  | 'observation_expanded'
  | 'feed_bookmark_added'
  | 'feed_item_dismissed'
  | 'feed_action_undone'
  | 'feed_position_restored';

/** Only ids, counts and codes. Never text, never raw Telegram identity. */
export interface FeedEventProperties {
  itemId?: string;
  filmId?: number;
  observationCode?: string;
  action?: string;
  items?: number;
  index?: number;
}

export interface AnalyticsAdapter {
  send(event: FeedEvent, properties: FeedEventProperties): void;
}

/**
 * Anything that is not an id, a count or a code is dropped before it can
 * travel. A property added carelessly at a call site cannot leak a review.
 */
const ALLOWED: readonly (keyof FeedEventProperties)[] = [
  'itemId',
  'filmId',
  'observationCode',
  'action',
  'items',
  'index',
];

const sanitize = (properties: FeedEventProperties): FeedEventProperties => {
  const clean: FeedEventProperties = {};
  for (const key of ALLOWED) {
    const value = properties[key];
    if (value === undefined) continue;
    // A string that is not an id-shaped token has no business being here.
    if (typeof value === 'string' && value.length > 120) continue;
    Object.assign(clean, { [key]: value });
  }
  return clean;
};

/** Keeps the last events in memory so a debug view can show them. */
class DebugAdapter implements AnalyticsAdapter {
  readonly events: { event: FeedEvent; properties: FeedEventProperties; at: number }[] = [];

  send(event: FeedEvent, properties: FeedEventProperties): void {
    this.events.push({ event, properties, at: Date.now() });
    if (this.events.length > 200) this.events.shift();
  }
}

export const debugAnalytics = new DebugAdapter();

let adapter: AnalyticsAdapter = debugAnalytics;

/** Test seam, and where a real adapter is installed once one exists. */
export const setAnalyticsAdapter = (next: AnalyticsAdapter): void => {
  adapter = next;
};

export const feedAnalytics = {
  track(event: FeedEvent, properties: FeedEventProperties = {}): void {
    adapter.send(event, sanitize(properties));
  },
};
