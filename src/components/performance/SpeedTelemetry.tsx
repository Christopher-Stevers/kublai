"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { onINP, onLCP } from "web-vitals";
import {
  SPEED_METRICS,
  speedScreen,
  type SpeedMetric,
} from "~/lib/speed-telemetry";

/** Small, bounded, numeric-only field sample sent to existing application logs. */
export function SpeedTelemetry() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const pointerStart = useRef<number | null>(null);
  useEffect(() => {
    const start = () => {
      pointerStart.current = performance.now();
    };
    document.addEventListener("pointerdown", start, {
      capture: true,
      passive: true,
    });
    return () => document.removeEventListener("pointerdown", start, true);
  }, []);
  useEffect(() => {
    if (pathname === previousPath.current) return;
    previousPath.current = pathname;
    const start = pointerStart.current;
    pointerStart.current = null;
    if (start === null || performance.now() - start > 5000) return;
    let first = 0;
    let second = 0;
    let finished = false;
    const observer = new MutationObserver(check);
    function check() {
      if (
        finished ||
        [
          ...document.querySelectorAll(
            "[data-route-loading], [data-app-startup-loading]",
          ),
        ].some((element) => element.getClientRects().length > 0)
      )
        return;
      finished = true;
      observer.disconnect();
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          performance.measure("foremenhq:tap-to-paint", {
            start: start!,
            end: performance.now(),
          });
        });
      });
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "style", "class"],
    });
    check();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pathname]);
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let queue: (SpeedMetric & { screen: ReturnType<typeof speedScreen> })[] =
      [];
    let sent = 0;
    const observers: PerformanceObserver[] = [];
    let active = true;
    const vital =
      (name: SpeedMetric["name"]) =>
      ({ value }: { value: number }) => {
        if (active && queue.length < 30)
          queue.push({
            name,
            durationMs: Math.round(value),
            screen: speedScreen(window.location.pathname),
          });
      };
    onINP(vital("inp"));
    onLCP(vital("lcp"));
    const flush = () => {
      if (!queue.length || sent >= 120 || !navigator.onLine) return;
      const batch = queue
        .filter((metric) => metric.screen === queue[0]?.screen)
        .slice(0, Math.min(30, 120 - sent));
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
                  link: !navigator.onLine
                    ? "offline"
                    : (
                          navigator as Navigator & {
                            connection?: { effectiveType?: string };
                          }
                        ).connection?.effectiveType === "4g"
                      ? "fast"
                      : (
                            navigator as Navigator & {
                              connection?: { effectiveType?: string };
                            }
                          ).connection?.effectiveType
                        ? "slow"
                        : "unknown",
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
          queue = queue.filter((metric) => !batch.includes(metric));
          sent += batch.length;
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
          const durationMs = name === "lcp" ? entry.startTime : entry.duration;
          if (
            Number.isFinite(durationMs) &&
            durationMs >= 0 &&
            queue.length < 30
          ) {
            const custom = entry.name.replace(
              "foremenhq:",
              "",
            ) as SpeedMetric["name"];
            queue.push({
              name:
                name === "action" && SPEED_METRICS.includes(custom)
                  ? custom
                  : name,
              durationMs: Math.round(durationMs),
              screen: speedScreen(window.location.pathname),
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
    };
  }, []);
  return null;
}
