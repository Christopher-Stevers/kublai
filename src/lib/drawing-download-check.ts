import type { DrawingOfflineStore } from './drawing-offline';
export type DownloadMarker = { version: string; urls: string[]; sheets: string[]; bytes?: number };
/** Verify bytes and viewer metadata before advertising offline readiness. */
export async function verifyDrawingDownload(store: DrawingOfflineStore, marker: DownloadMarker) {
  let bytes = 0;
  for (const url of marker.urls) {
    const blob = await store.readAsset(url);
    if (!blob || !blob.size) return null;
    bytes += blob.size;
  }
  for (const sheet of marker.sheets) {
    if (!await store.readSnapshot(`workspace:${sheet}`)) return null;
  }
  return { ...marker, bytes };
}
