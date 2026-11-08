/** Pixels per second, increasing smoothly toward either visible edge. */
export function dragScrollVelocity(y: number, top: number, bottom: number) {
  const height = bottom - top;
  if (height <= 0) return 0;
  const zone = Math.min(240, height * 0.4);
  const upper = (top + zone - y) / zone;
  const lower = (y - (bottom - zone)) / zone;
  const depth = Math.max(upper, lower);
  if (depth <= 0) return 0;
  return (upper > lower ? -1 : 1) * 3000 * Math.pow(Math.min(1, depth), 1.5);
}
