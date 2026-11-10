import { expect, it, vi } from 'vitest';
import type { DrawingOfflineStore } from './drawing-offline';
import { verifyDrawingDownload } from './drawing-download-check';
const marker = { version: 'v1', urls: ['/one', '/two'], sheets: ['s1'] };
function store(missingAsset = false, missingWorkspace = false) {
  return { readAsset: vi.fn(async () => missingAsset ? null : new Blob(['test'])), readSnapshot: vi.fn(async () => missingWorkspace ? null : { sheetId: 's1' }) } as unknown as DrawingOfflineStore;
}
it('verifies every file and workspace and records the saved bytes', async () => {
  expect(await verifyDrawingDownload(store(), marker)).toEqual({ ...marker, bytes: 8 });
});
it('does not mark partial files or missing viewer metadata ready', async () => {
  expect(await verifyDrawingDownload(store(true), marker)).toBeNull();
  expect(await verifyDrawingDownload(store(false, true), marker)).toBeNull();
});
it('propagates storage failure rather than claiming success', async () => {
  const broken = store();
  vi.mocked(broken.readAsset).mockRejectedValueOnce(new Error('unavailable'));
  await expect(verifyDrawingDownload(broken, marker)).rejects.toThrow('unavailable');
});
