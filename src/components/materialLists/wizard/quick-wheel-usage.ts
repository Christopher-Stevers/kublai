export type WheelUsage = Record<string, number>;
export const WHEEL_USAGE_KEY = "foremanhq:quick-wheel-usage:v1";
export const wheelUsageId = (title: string, label: string) =>
  JSON.stringify([title, label]);
export function readWheelUsage(): WheelUsage {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem(WHEEL_USAGE_KEY) ?? "{}",
    );
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data).filter(
        ([, value]) =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    );
  } catch {
    return {};
  }
}
export function recordWheelChoice(title: string, label: string) {
  try {
    const usage = readWheelUsage();
    const key = wheelUsageId(title, label);
    usage[key] = Math.min((usage[key] ?? 0) + 1, Number.MAX_SAFE_INTEGER);
    localStorage.setItem(
      WHEEL_USAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(usage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2000),
        ),
      ),
    );
  } catch {
    /* Storage being unavailable must never block a selection. */
  }
}

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
