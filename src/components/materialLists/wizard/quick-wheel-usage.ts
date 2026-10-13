export { wheelUsageId, type WheelUsage } from "~/lib/order-wheel-usage";

/** Stable ties; actual onscreen label positions determine the inward slots. */
export function inwardSlots(
  points: Array<{ x: number; y: number }>,
  centre: { x: number; y: number },
) {
  return points
    .map((point, index) => ({
      index,
      distance: Math.hypot(point.x - centre.x, point.y - centre.y),
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((value) => value.index);
}
