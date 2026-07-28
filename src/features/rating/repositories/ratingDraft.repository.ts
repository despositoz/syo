import { db, safeRead, strictWrite } from '@shared/storage/db';
import { parseRatingDraft } from '@domain/rating/rating.validation';
import type { RatingDraft } from '@domain/rating/rating.types';

/**
 * The active rating draft, stored twice on purpose (spec §12.5).
 *
 *   Primary  — IndexedDB. Survives everything, but writes are asynchronous and
 *              a WebView killed mid-write loses the last one.
 *   Mirror   — a small synchronous localStorage snapshot written after every
 *              domain commit. No images, no TMDB payloads.
 *
 * On startup both are read and the higher `revision` wins.
 */

const MIRROR_KEY = 'syo:rating-draft:active';

export interface RatingDraftRepository {
  getActive(): Promise<RatingDraft | null>;
  saveActive(draft: RatingDraft): Promise<void>;
  deleteActive(): Promise<void>;
  /** Best-effort write of whatever is pending, for pagehide/visibilitychange. */
  flush(): Promise<void>;
}

const readMirror = (storage: Storage | undefined): RatingDraft | null => {
  try {
    const raw = storage?.getItem(MIRROR_KEY);
    return raw ? parseRatingDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeMirror = (storage: Storage | undefined, draft: RatingDraft | null): void => {
  try {
    if (!draft) storage?.removeItem(MIRROR_KEY);
    else storage?.setItem(MIRROR_KEY, JSON.stringify(draft));
  } catch {
    // A full or disabled localStorage must not break rating; IndexedDB remains.
  }
};

export class IndexedDbRatingDraftRepository implements RatingDraftRepository {
  /** Latest draft handed to saveActive, kept for flush(). */
  private pending: RatingDraft | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly storage: Storage | undefined = globalThis.localStorage) {}

  async getActive(): Promise<RatingDraft | null> {
    // The draft keeps its own id, so "the active one" is simply the only row.
    const rows = await safeRead(() => db.ratingDrafts.toArray(), []);
    const stored = rows.find((row) => row.status === 'active') ?? rows[0];
    const primary = stored ? parseRatingDraft(stored) : null;
    const mirror = readMirror(this.storage);

    if (!primary) {
      if (!mirror) return null;
      // The mirror outlived a lost IndexedDB write — promote it back.
      await this.saveActive(mirror);
      return mirror;
    }
    if (!mirror) return primary;

    // Equal revisions are broken by updatedAt: two writes can share a revision
    // after a recovery, and the later text is the one the user actually typed.
    const mirrorWins =
      mirror.revision > primary.revision ||
      (mirror.revision === primary.revision && mirror.updatedAt > primary.updatedAt);
    const newest = mirrorWins ? mirror : primary;
    if (newest === mirror) await this.saveActive(mirror);
    return newest;
  }

  async saveActive(draft: RatingDraft): Promise<void> {
    this.pending = draft;
    // Synchronous first: this is the copy that survives a force close.
    writeMirror(this.storage, draft);
    // Exactly one row ever lives here, so writing replaces whatever was there.
    this.inFlight = strictWrite(() =>
      db.transaction('rw', db.ratingDrafts, async () => {
        await db.ratingDrafts.clear();
        await db.ratingDrafts.put(draft);
      }),
    ).then(() => {
      if (this.pending === draft) this.pending = null;
    });
    await this.inFlight;
  }

  async deleteActive(): Promise<void> {
    this.pending = null;
    writeMirror(this.storage, null);
    await strictWrite(() => db.ratingDrafts.clear());
  }

  async flush(): Promise<void> {
    const draft = this.pending;
    if (draft) writeMirror(this.storage, draft);
    await this.inFlight.catch(() => undefined);
  }
}

export const ratingDraftRepository: RatingDraftRepository = new IndexedDbRatingDraftRepository();
