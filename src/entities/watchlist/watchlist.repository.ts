import { db, safeRead, safeWrite, type SyncTask } from '@shared/storage/db';
import type { FilmSummary } from '@entities/film/film.model';
import { entryFromSummary, type WatchlistEntry } from './watchlist.model';

/**
 * Local-first watchlist.
 *
 * The local write is the source of truth: a failed server sync is queued and
 * retried, and never rolls back what the user already sees (spec §23).
 */
export class WatchlistRepository {
  async all(): Promise<WatchlistEntry[]> {
    const rows = await safeRead(() => db.watchlist.orderBy('addedAt').reverse().toArray(), []);
    return rows;
  }

  async has(filmId: number): Promise<boolean> {
    const row = await safeRead(() => db.watchlist.get(filmId), undefined);
    return Boolean(row);
  }

  async add(film: FilmSummary): Promise<WatchlistEntry> {
    const entry = entryFromSummary(film);
    await safeWrite(() => db.watchlist.put(entry));
    await this.enqueue({ type: 'watchlistAdd', filmId: film.id });
    return entry;
  }

  async remove(filmId: number): Promise<void> {
    await safeWrite(() => db.watchlist.delete(filmId));
    await this.enqueue({ type: 'watchlistRemove', filmId });
  }

  /** @returns the state *after* toggling. */
  async toggle(film: FilmSummary): Promise<boolean> {
    const exists = await this.has(film.id);
    if (exists) {
      await this.remove(film.id);
      return false;
    }
    await this.add(film);
    return true;
  }

  async enqueue(task: SyncTask): Promise<void> {
    await safeWrite(() => db.syncQueue.add({ task, createdAt: Date.now(), attempts: 0 }));
  }

  async pendingTasks(): Promise<Array<{ id: number; task: SyncTask; attempts: number }>> {
    const rows = await safeRead(() => db.syncQueue.orderBy('createdAt').toArray(), []);
    return rows
      .filter((row): row is typeof row & { id: number } => typeof row.id === 'number')
      .map((row) => ({ id: row.id, task: row.task, attempts: row.attempts }));
  }

  async completeTask(id: number): Promise<void> {
    const row = await safeRead(() => db.syncQueue.get(id), undefined);
    await safeWrite(() => db.syncQueue.delete(id));
    if (row?.task.type === 'watchlistAdd') await this.markSynced(row.task.filmId);
  }

  async markSynced(filmId: number): Promise<void> {
    const entry = await safeRead(() => db.watchlist.get(filmId), undefined);
    if (!entry) return;
    await safeWrite(() => db.watchlist.put({ ...entry, pendingSync: false }));
  }

  async failTask(id: number): Promise<void> {
    const row = await safeRead(() => db.syncQueue.get(id), undefined);
    if (!row) return;
    await safeWrite(() => db.syncQueue.put({ ...row, attempts: row.attempts + 1 }));
  }
}

export const watchlistRepository = new WatchlistRepository();
