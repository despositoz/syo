import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityController, useConnectivityStore } from './ConnectivityController';
import type { WatchlistRepository } from '@entities/watchlist/watchlist.repository';
import type { SyncTask } from '@shared/storage/db';

interface QueuedTask {
  id: number;
  task: SyncTask;
}

const createRepositoryFake = (tasks: QueuedTask[]) => {
  const remaining = [...tasks];
  return {
    pendingTasks: vi.fn(async () => [...remaining]),
    completeTask: vi.fn(async (id: number) => {
      const index = remaining.findIndex((item) => item.id === id);
      if (index >= 0) remaining.splice(index, 1);
    }),
    failTask: vi.fn(async () => {}),
    get remaining() {
      return remaining;
    },
  };
};

const asRepository = (fake: ReturnType<typeof createRepositoryFake>) =>
  fake as unknown as WatchlistRepository;

const task = (id: number): QueuedTask => ({
  id,
  task: { type: 'watchlistAdd', filmId: id * 10 },
});

describe('ConnectivityController', () => {
  beforeEach(() => {
    useConnectivityStore.setState({ online: true, syncStatus: 'idle', pendingCount: 0 });
  });

  it('drains the queue and returns to idle', async () => {
    const repository = createRepositoryFake([task(1), task(2)]);
    const controller = new ConnectivityController(asRepository(repository), async () => {});

    await controller.drain();

    expect(repository.completeTask).toHaveBeenCalledTimes(2);
    expect(useConnectivityStore.getState().syncStatus).toBe('idle');
    expect(useConnectivityStore.getState().pendingCount).toBe(0);
  });

  it('keeps failed tasks queued and never rolls back local state', async () => {
    const repository = createRepositoryFake([task(1)]);
    const controller = new ConnectivityController(asRepository(repository), async () => {
      throw new Error('server down');
    });

    await controller.drain();

    expect(repository.failTask).toHaveBeenCalledTimes(1);
    expect(repository.completeTask).not.toHaveBeenCalled();
    expect(repository.remaining).toHaveLength(1);
    expect(useConnectivityStore.getState().syncStatus).toBe('error');
  });

  it('does nothing while offline — the queue waits instead of failing', async () => {
    useConnectivityStore.setState({ online: false });
    const repository = createRepositoryFake([task(1)]);
    const controller = new ConnectivityController(asRepository(repository), async () => {});

    await controller.drain();

    expect(repository.pendingTasks).not.toHaveBeenCalled();
    expect(useConnectivityStore.getState().syncStatus).toBe('idle');
  });

  it('stays idle with an empty queue, so no indicator ever appears', async () => {
    const repository = createRepositoryFake([]);
    const controller = new ConnectivityController(asRepository(repository), async () => {});

    await controller.drain();

    expect(useConnectivityStore.getState().syncStatus).toBe('idle');
  });
});
