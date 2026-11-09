/**
 * A running judgement of the connection drawings are loading over. On a weak
 * signal every download shares one thin pipe, so the viewer loads a sheet in
 * steps (small copy, sheet image, then sharp detail) instead of all at once.
 *
 * Real drawing downloads decide; the browser's own estimate only gives an
 * early warning.
 */
const SLOW_BYTES_PER_SECOND = 100 * 1024;
const MIN_SAMPLE_BYTES = 16 * 1024;

type Connection = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};

let measured: number | null = null;
const listeners = new Set<() => void>();

/** A finished (or dropped) drawing download: its bytes and how long it took,
 * waiting included. Small transfers say more about delay than speed. */
export function noteDrawingTransfer(bytes: number, ms: number) {
  if (bytes < MIN_SAMPLE_BYTES || !(ms > 0)) return;
  const rate = (bytes * 1000) / ms;
  measured = measured === null ? rate : measured * 0.5 + rate * 0.5;
  for (const listener of [...listeners]) listener();
}

/** The browser's own estimate, where it has one (not on iPhone). It lags and
 * reads "4g" on a fresh page, so it is only believed when it says slow. */
function reportedSlow() {
  const connection =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    (!!connection.effectiveType && connection.effectiveType !== "4g") ||
    (typeof connection.downlink === "number" &&
      connection.downlink > 0 &&
      connection.downlink < 1)
  );
}

/** True on a weak signal, false on a good one, null before a drawing download
 * has shown which. */
export function drawingLinkSlow(): boolean | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return true;
  if (measured !== null) return measured < SLOW_BYTES_PER_SECOND;
  return reportedSlow() ? true : null;
}

export function onDrawingLinkChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Feeds a loaded drawing image (small copy, sheet image) into the estimate. */
export function noteDrawingImage(image: HTMLImageElement) {
  if (typeof performance === "undefined" || !performance.getEntriesByName)
    return;
  const entries = performance.getEntriesByName(
    image.currentSrc || image.src,
    "resource",
  ) as PerformanceResourceTiming[];
  const entry = entries[entries.length - 1];
  // A copy from the browser's cache says nothing about the signal.
  if (!entry?.transferSize) return;
  noteDrawingTransfer(
    entry.encodedBodySize,
    entry.responseEnd - (entry.requestStart || entry.startTime),
  );
}

export function resetDrawingNetworkForTest() {
  measured = null;
  listeners.clear();
}
