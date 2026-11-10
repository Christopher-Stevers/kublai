import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfflineStorageStatus } from './OfflineStorageStatus';
const request = vi.hoisted(() => vi.fn());
vi.mock('~/lib/persistent-device-storage', () => ({ requestPersistentDeviceStorage: request }));
afterEach(cleanup);
it('shows denial accurately and lets the user retry', async () => {
  request.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<OfflineStorageStatus />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request protection' }));
  await screen.findByText('Offline storage protected');
  expect(screen.queryByRole('button', { name: 'Request protection' })).toBeNull();
});
