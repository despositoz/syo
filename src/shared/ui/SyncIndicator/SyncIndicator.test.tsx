import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncIndicator } from './SyncIndicator';
import { useConnectivityStore } from '@app/connectivity/ConnectivityController';

type ConnectivitySnapshot = ReturnType<typeof useConnectivityStore.getState>;

const setState = (patch: Partial<ConnectivitySnapshot>) => useConnectivityStore.setState(patch);

describe('SyncIndicator', () => {
  it('shows nothing while idle', () => {
    setState({ online: true, syncStatus: 'idle' });
    render(<SyncIndicator />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows nothing merely because the device is offline', () => {
    // No permanent "Offline" plate — everything still works from IndexedDB.
    setState({ online: false, syncStatus: 'idle' });
    render(<SyncIndicator />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears for a slow sync', () => {
    setState({ online: true, syncStatus: 'slow' });
    render(<SyncIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('Синхронизация');
  });

  it('appears for a real error and stays calm about it', () => {
    setState({ online: true, syncStatus: 'error' });
    render(<SyncIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('Изменения сохранены локально');
  });
});
