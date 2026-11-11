"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const requested = () =>
  new URLSearchParams(window.location.search).get("speed") === "1";

/** Animation-frame gaps estimate missed refresh opportunities, not presented
 * frames. Keep this development aid separate from the lab and field gates. */
export function frameWindow(gaps: readonly number[]) {
  const sorted = gaps
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b);
  if (sorted.length < 30) return null;
  const interval = sorted[Math.floor(sorted.length * 0.1)]!;
  return {
    interval,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    missed: sorted.reduce(
      (sum, gap) => sum + Math.max(0, Math.round(gap / interval) - 1),
      0,
    ),
  };
}

export default function SpeedDevelopmentOverlay() {
  const enabled = useSyncExternalStore(subscribe, requested, () => false);
  const [dismissed, setDismissed] = useState(false);
  const [frames, setFrames] = useState<ReturnType<typeof frameWindow>>(null);
  const [tap, setTap] = useState<number | null>(null);
  const [write, setWrite] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || dismissed) return;
    const gaps: number[] = [];
    let previous: number | null = null;
    let updated = 0;
    let frame = 0;
    const tick = (now: number) => {
      if (document.visibilityState === "hidden") {
        previous = null;
        return;
      }
      if (previous !== null) {
        gaps.push(now - previous);
        if (gaps.length > 180) gaps.shift();
      }
      previous = now;
      if (now - updated >= 500) {
        updated = now;
        setFrames(frameWindow(gaps));
      }
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = null;
      if (document.visibilityState !== "hidden")
        frame = requestAnimationFrame(tick);
    };
    let observer: PerformanceObserver | undefined;
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("measure")
    ) {
      observer = new PerformanceObserver((list) => {
        if (document.visibilityState === "hidden") return;
        for (const entry of list.getEntries()) {
          if (!Number.isFinite(entry.duration) || entry.duration < 0) continue;
          if (entry.name === "foremenhq:tap-to-paint") setTap(entry.duration);
          if (entry.name === "foremenhq:write-to-paint")
            setWrite(entry.duration);
        }
      });
      observer.observe({ type: "measure", buffered: true });
    }
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, dismissed]);
  if (!enabled || dismissed) return null;
  const ms = (value: number | null) =>
    value === null ? "—" : `${value.toFixed(1)} ms`;
  return (
    <aside
      aria-label="Development speed measurements"
      className="bg-card text-card-foreground fixed top-2 right-2 z-[10001] max-w-[calc(100vw-1rem)] rounded border p-3 text-xs shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-6">
        <strong>Speed · development</strong>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Close speed overlay"
          className="rounded border px-2 py-1"
        >
          Close
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
        <dt>Last tap to paint opportunity</dt>
        <dd>{ms(tap)}</dd>
        <dt>Last write to paint opportunity</dt>
        <dd>{ms(write)}</dd>
        <dt>Frame gap p95</dt>
        <dd>{ms(frames?.p95 ?? null)}</dd>
        <dt>Refresh interval estimate</dt>
        <dd>{ms(frames?.interval ?? null)}</dd>
        <dt>Missed frame slots (est.)</dt>
        <dd>{frames?.missed ?? "—"}</dd>
      </dl>
      <p className="text-muted-foreground mt-2">
        Last 180 visible frames. Diagnostics affect timing.
      </p>
    </aside>
  );
}
