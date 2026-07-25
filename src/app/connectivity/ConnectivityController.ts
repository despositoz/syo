import { create } from 'zustand';
import {
  watchlistRepository,
  type WatchlistRepository,
} from '@entities/watchlist/watchlist.repository';

/**
 * Connectivity is *not* a permanent banner (spec §24). The store exposes just
 * enough for a transient indicator: online flag, whether a sync is running,
 * and how long it has been running.
 */
export type SyncStatus = 'idle' | 'syncing' | 'slow' | 'error';

interface ConnectivityState {
  online: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  setOnline: (online: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setPendingCount: (count: number) => void;
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncStatus: 'idle',
  pendingCount: 0,
  setOnline: (online) => set({ online }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
}));

/** A sync taking longer than this earns a visible indicator. */
const SLOW_SYNC_MS = 2500;

/**
 * Drains the offline queue when connectivity returns.
 *
 * v1 has no SYO backend yet, so the transport is an explicit no-op that
 * confirms the task. Swapping in a real endpoint touches only `transport`.
 */
export type SyncTransport = (task: { type: string; filmId: number }) => Promise<void>;

const noopTransport: SyncTransport = async () => {};

export class ConnectivityController {
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;

  constructor(
    private readonly repository: WatchlistRepository = watchlistRepository,
    private readonly transport: SyncTransport = noopTransport,
    private readonly win: Window = window,
  ) {}

  start(): void {
    this.win.addEventListener('online', this.handleOnline);
    this.win.addEventListener('offline', this.handleOffline);
    useConnectivityStore.getState().setOnline(this.win.navigator.onLine);
    void this.drain();
  }

  destroy(): void {
    this.win.removeEventListener('online', this.handleOnline);
    this.win.removeEventListener('offline', this.handleOffline);
    if (this.slowTimer) clearTimeout(this.slowTimer);
  }

  private readonly handleOnline = (): void => {
    useConnectivityStore.getState().setOnline(true);
    void this.drain();
  };

  private readonly handleOffline = (): void => {
    useConnectivityStore.getState().setOnline(false);
  };

  /** Retries queued watchlist writes. Failures stay queued; nothing rolls back. */
  async drain(): Promise<void> {
    if (this.draining) return;
    const store = useConnectivityStore.getState();
    if (!store.online) return;

    const tasks = await this.repository.pendingTasks();
    store.setPendingCount(tasks.length);
    if (!tasks.length) {
      store.setSyncStatus('idle');
      return;
    }

    this.draining = true;
    store.setSyncStatus('syncing');
    this.slowTimer = setTimeout(() => {
      useConnectivityStore.getState().setSyncStatus('slow');
    }, SLOW_SYNC_MS);

    let failed = 0;
    for (const task of tasks) {
      try {
        await this.transport({ type: task.task.type, filmId: task.task.filmId });
        await this.repository.completeTask(task.id);
      } catch {
        failed += 1;
        await this.repository.failTask(task.id);
      }
    }

    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.draining = false;

    const remaining = await this.repository.pendingTasks();
    const next = useConnectivityStore.getState();
    next.setPendingCount(remaining.length);
    next.setSyncStatus(failed > 0 ? 'error' : 'idle');
  }
}

export const useIsOnline = (): boolean => useConnectivityStore((state) => state.online);
