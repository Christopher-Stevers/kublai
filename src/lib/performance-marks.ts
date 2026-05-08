export function markUserAction(name: string, detail?: Record<string, unknown>) {
  if (typeof window === "undefined" || !("performance" in window)) return;

  const markName = `foremenhq:${name}`;
  window.performance.mark(markName, { detail });

  if (process.env.NODE_ENV !== "production") {
    console.debug(`[perf] ${markName}`, detail ?? {});
  }
}

export function measureUserAction(
  name: string,
  startMark: string,
  detail?: Record<string, unknown>,
) {
  if (typeof window === "undefined" || !("performance" in window)) return;

  const measureName = `foremenhq:${name}`;
  const start = `foremenhq:${startMark}`;

  try {
    window.performance.measure(measureName, { start, detail });
    const latest = window.performance.getEntriesByName(measureName).at(-1);
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[perf] ${measureName}`, {
        duration: latest?.duration,
        ...(detail ?? {}),
      });
    }
  } catch {
    // Marks are best-effort diagnostics; never let them affect user actions.
  }
}
