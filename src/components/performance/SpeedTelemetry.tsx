"use client";

import { lazy, Suspense, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { onINP, onLCP } from "web-vitals";
import { installNavigationInput, navigationPaint, navigationScreen, subscribeNavigationScreen, setLocalNavigationScreen } from "~/lib/navigation-paint";
import { SpeedMetricBuffer } from "~/lib/speed-metric-buffer";
import {
  SpeedContextTimeline,
  type SpeedContext,
} from "~/lib/speed-context-timeline";
import {
  SPEED_METRICS,
  type SpeedMetric,
} from "~/lib/speed-telemetry";

const DevelopmentOverlay =
  process.env.NODE_ENV === "development"
    ? lazy(() => import("./SpeedDevelopmentOverlay"))
    : null;

/** Small, bounded, numeric-only field sample sent to existing application logs. */
export function SpeedTelemetry() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const recordContext = useRef<(() => void) | null>(null);
  useEffect(() => installNavigationInput(), []);
  useEffect(() => {
    if (!pathname || pathname === previousPath.current) return;
    previousPath.current = pathname;
    setLocalNavigationScreen(null);
    recordContext.current?.();
    navigationPaint.commitPath(pathname);
  }, [pathname]);
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const linkClass = (): SpeedContext["link"] =>
      !navigator.onLine
        ? "offline"
        : (navigator as Navigator & { connection?: { effectiveType?: string } })
              .connection?.effectiveType === "4g"
          ? "fast"
          : (
                navigator as Navigator & {
                  connection?: { effectiveType?: string };
                }
              ).connection?.effectiveType
            ? "slow"
            : "unknown";
    const context = (): SpeedContext => ({
      screen: navigationScreen(),
      link: linkClass(),
    });
    const contexts = new SpeedContextTimeline(context());
    const changedContext = () => contexts.record(performance.now(), context());
    recordContext.current = changedContext;
    const stopLocalContext = subscribeNavigationScreen(changedContext);
    const connection = (
      navigator as Navigator & {
        connection?: {
          addEventListener?: (type: string, listener: () => void) => void;
          removeEventListener?: (type: string, listener: () => void) => void;
        };
      }
    ).connection;
    window.addEventListener("online", changedContext);
    window.addEventListener("offline", changedContext);
    connection?.addEventListener?.("change", changedContext);
    const buffer = new SpeedMetricBuffer();
    const observers: PerformanceObserver[] = [];
    let active = true;
    const vital =
      (name: SpeedMetric["name"]) =>
      ({
        value,
        entries,
      }: {
        value: number;
        entries?: readonly { startTime: number }[];
      }) => {
        if (active)
          buffer.push({
            name,
            durationMs: Math.round(value),
            ...contexts.forVital(entries),
          });
      };
    onINP(vital("inp"));
    onLCP(vital("lcp"));
    const flush = () => {
      if (!navigator.onLine) return;
      const batch = buffer.peekBatch();
      if (!batch.length) return;
      try {
        if (
          navigator.sendBeacon(
            "/api/perf",
            new Blob(
              [
                JSON.stringify({
                  version: 1,
                  build: process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown",
                  screen: batch[0]?.screen,
                  device:
                    window.innerWidth < 600
                      ? "phone"
                      : window.innerWidth < 1000
                        ? "tablet"
                        : "desktop",
                  link: batch[0]?.link,
                  metrics: batch.map(({ name, durationMs }) => ({
                    name,
                    durationMs,
                  })),
                }),
              ],
              { type: "application/json" },
            ),
          )
        ) {
          buffer.acknowledge(batch);
        }
      } catch {
        /* Diagnostics must never affect an action. */
      }
    };
    for (const [type, name] of [
      ["event", "interaction"],
      ["longtask", "longtask"],
      ["measure", "action"],
      ["navigation", "navigation"],
    ] as const) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (name === "action" && !entry.name.startsWith("foremenhq:"))
            continue;
          const durationMs = entry.duration;
          if (Number.isFinite(durationMs) && durationMs >= 0) {
            const custom = entry.name.replace(
              "foremenhq:",
              "",
            ) as SpeedMetric["name"];
            buffer.push({
              name:
                name === "action" && SPEED_METRICS.includes(custom)
                  ? custom
                  : name,
              durationMs: Math.round(durationMs),
              screen: navigationScreen(),
              link: linkClass(),
            });
          }
        }
      });
      try {
        observer.observe({
          type,
          buffered: true,
          ...(type === "event" ? { durationThreshold: 16 } : {}),
        });
        observers.push(observer);
      } catch {
        observer.disconnect();
      }
    }
    const timer = window.setInterval(flush, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      active = false;
      flush();
      clearInterval(timer);
      observers.forEach((observer) => observer.disconnect());
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", changedContext);
      window.removeEventListener("offline", changedContext);
      connection?.removeEventListener?.("change", changedContext);
      stopLocalContext();
      if (recordContext.current === changedContext)
        recordContext.current = null;
    };
  }, []);
  return DevelopmentOverlay ? (
    <Suspense fallback={null}>
      <DevelopmentOverlay />
    </Suspense>
  ) : null;
}
