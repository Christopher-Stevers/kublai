/** Local, bounded diagnostics. No drawing names, URLs, contents or account identifiers. */
export type DrawingPerformanceSample = {
  loadMs: number;
  renderMs: number;
  viewToSharpMs: number | null;
  outcome: "sharp" | "partial" | "failed";
  pixels: number;
};
const samples: DrawingPerformanceSample[] = [];
export function drawingPerformanceSamples() {
  return samples.map((sample) => ({ ...sample }));
}
export function recordDrawingPerformance(sample: DrawingPerformanceSample) {
  samples.push(sample);
  if (samples.length > 100) samples.shift();
  if (typeof performance.measure !== "function") return;
  const name = "foremanhq:drawing-detail";
  try {
    performance.measure(name, {
      start: Math.max(0, performance.now() - sample.loadMs - sample.renderMs),
      detail: sample,
    });
    if (performance.getEntriesByName(name).length > 100)
      performance.clearMeasures(name);
  } catch {
    /* Diagnostics must never interfere with rendering. */
  }
}
