/** Numeric-only payload: never transmit paths, action detail, IDs, or user content. */
export const SPEED_METRICS = [
  "lcp",
  "inp",
  "interaction",
  "longtask",
  "action",
  "tap-to-paint",
  "write-to-paint",
  "app-start-to-last-screen",
  "sheet-open-to-sharp",
  "navigation",
] as const;
export type SpeedMetric = {
  name: (typeof SPEED_METRICS)[number];
  durationMs: number;
};
export function parseSpeedMetrics(value: unknown): SpeedMetric[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30)
    return null;
  const result: SpeedMetric[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== "name" && key !== "durationMs"))
      return null;
    if (
      !SPEED_METRICS.includes(row.name as SpeedMetric["name"]) ||
      typeof row.durationMs !== "number" ||
      !Number.isFinite(row.durationMs) ||
      row.durationMs < 0 ||
      row.durationMs > 600_000
    )
      return null;
    result.push({
      name: row.name as SpeedMetric["name"],
      durationMs: Math.round(row.durationMs),
    });
  }
  return result;
}

/** Call at the event boundary; call returned function after the state has committed.
 * Two animation frames ensure at least one paint opportunity has elapsed. */
export function startSpeedPaint(
  name:
    | "tap-to-paint"
    | "write-to-paint"
    | "app-start-to-last-screen"
    | "sheet-open-to-sharp",
) {
  if (typeof performance === "undefined") return () => {};
  const start = performance.now();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        performance.measure(`foremenhq:${name}`, {
          start,
          end: performance.now(),
        });
      }),
    );
  };
}

export const SPEED_SCREENS = [
  "jobs",
  "job",
  "materials",
  "receiving",
  "drawing",
  "chat",
  "other",
] as const;
export function speedScreen(pathname: string): (typeof SPEED_SCREENS)[number] {
  if (/material-lists/.test(pathname)) return "materials";
  if (/receiv/.test(pathname)) return "receiving";
  if (/drawing|sheet/.test(pathname)) return "drawing";
  if (/chat/.test(pathname)) return "chat";
  if (/^\/jobs\/?$/.test(pathname)) return "jobs";
  if (/^\/jobs\//.test(pathname)) return "job";
  return "other";
}
export function parseSpeedPayload(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) =>
        !["version", "build", "screen", "device", "link", "metrics"].includes(
          key,
        ),
    )
  )
    return null;
  const metrics = parseSpeedMetrics(row.metrics);
  if (
    !metrics ||
    row.version !== 1 ||
    typeof row.build !== "string" ||
    !/^[a-zA-Z0-9._-]{1,64}$/.test(row.build) ||
    !SPEED_SCREENS.includes(row.screen as (typeof SPEED_SCREENS)[number]) ||
    !["phone", "tablet", "desktop"].includes(String(row.device)) ||
    !["offline", "slow", "cellular", "fast", "unknown"].includes(
      String(row.link),
    )
  )
    return null;
  return {
    version: 1,
    build: row.build,
    screen: row.screen,
    device: row.device,
    link: row.link,
    metrics,
  };
}
