import { beforeEach, describe, expect, it } from 'vitest';
import { WatchlistRepository } from './watchlist.repository';
import { useWatchlistStore } from './watchlist.store';
import { db } from '@shared/storage/db';
import { DEFAULT_ACCENT, type FilmSummary } from '@entities/film/film.model';

const film: FilmSummary = {
  id: 42,
  title: 'Тест',
  originalTitle: 'Test',
  year: '2024',
  releaseDate: '2024-01-01',
  genres: ['Драма'],
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  overview: '',
  rating: 7,
  voteCount: 100,
  accent: DEFAULT_ACCENT,
};

describe('watchlist repository', () => {
  const repository = new WatchlistRepository();

  beforeEach(async () => {
    await db.watchlist.clear();
    await db.syncQueue.clear();
    useWatchlistStore.setState({ entries: {}, hydrated: false });
  });

  it('adds, reports and removes an entry', async () => {
    expect(await repository.has(film.id)).toBe(false);

    await repository.add(film);
    expect(await repository.has(film.id)).toBe(true);
    expect((await repository.all())[0]?.title).toBe('Тест');

    await repository.remove(film.id);
    expect(await repository.has(film.id)).toBe(false);
  });

  it('toggles and returns the resulting state', async () => {
    expect(await repository.toggle(film)).toBe(true);
    expect(await repository.toggle(film)).toBe(false);
  });

  it('queues every write for a later server sync', async () => {
    await repository.add(film);
    await repository.remove(film.id);

    const tasks = await repository.pendingTasks();
    expect(tasks.map((item) => item.task.type)).toEqual(['watchlistAdd', 'watchlistRemove']);
  });

  it('keeps the local entry when a sync task fails', async () => {
    await repository.add(film);
    const [task] = await repository.pendingTasks();
    await repository.failTask(task!.id);

    expect(await repository.has(film.id)).toBe(true);
    const [retried] = await repository.pendingTasks();
    expect(retried?.attempts).toBe(1);
  });

  it('clears the pending flag once a sync task completes', async () => {
    await repository.add(film);
    const [task] = await repository.pendingTasks();
    await repository.completeTask(task!.id);

    expect(await repository.pendingTasks()).toHaveLength(0);
    expect((await repository.all())[0]?.pendingSync).toBe(false);
  });

  it('survives a restart — the entry is read back from storage', async () => {
    await repository.add(film);

    const freshRepository = new WatchlistRepository();
    expect(await freshRepository.has(film.id)).toBe(true);
  });
});

describe('watchlist store', () => {
  beforeEach(async () => {
    await db.watchlist.clear();
    await db.syncQueue.clear();
    useWatchlistStore.setState({ entries: {}, hydrated: false });
  });

  it('flips optimistically before storage resolves', async () => {
    const pending = useWatchlistStore.getState().toggle(film);
    // State already reflects the intent while the write is in flight.
    expect(useWatchlistStore.getState().entries[film.id]).toBeTruthy();

    const result = await pending;
    expect(result.inWatchlist).toBe(true);
    expect(result.message).toContain('Добавлено');
  });

  it('hydrates from storage', async () => {
    await new WatchlistRepository().add(film);
    await useWatchlistStore.getState().hydrate();

    expect(useWatchlistStore.getState().entries[film.id]?.title).toBe('Тест');
  });
});
