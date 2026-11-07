/** Vector-only endpoint fade. Avoids allocating an offscreen SVG mask per run. */
export function measurementStrokeBands(
  points: readonly { x: number; y: number }[],
  edges: readonly { from: number; to: number }[],
  radius: number,
) {
  const bands = ["", "", "", ""];
  const segment = (
    a: { x: number; y: number },
    dx: number,
    dy: number,
    from: number,
    to: number,
  ) =>
    to > from
      ? `M ${a.x + dx * from} ${a.y + dy * from} L ${a.x + dx * to} ${a.y + dy * to} `
      : "";
  for (const { from, to } of edges) {
    const a = points[from],
      b = points[to];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const dx = (b.x - a.x) / length,
      dy = (b.y - a.y) / length;
    const start = Math.min(length / 2, radius * 0.2);
    const end = Math.min(length / 2, radius * 0.75);
    for (let band = 0; band < 3; band++) {
      const low = start + ((end - start) * band) / 3;
      const high = start + ((end - start) * (band + 1)) / 3;
      bands[band] +=
        segment(a, dx, dy, low, high) +
        segment(a, dx, dy, length - high, length - low);
    }
    bands[3] += segment(a, dx, dy, end, length - end);
  }
  return bands;
}
