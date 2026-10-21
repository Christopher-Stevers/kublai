"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import {
  diagnosticFeatureFor,
  diagnosticErrorCode,
  diagnosticsEnabled,
  type DiagnosticEvent,
} from "~/lib/diagnostics";

export function AutomaticDiagnostics() {
  const account = useDrawingAccount();
  const client = useQueryClient();
  useEffect(() => {
    if (!account || account.accountKey.includes(":simulation:")) return;
    let sent = 0;
    const recent = new Map<string, number>();
    const pending = new Map<string, number>();
    let taps: { element: Element; at: number; count: number } | null = null;
    const send = (
      event: Pick<DiagnosticEvent, "kind" | "feature" | "code" | "duration">,
    ) => {
      if (
        !diagnosticsEnabled(account.accountKey) ||
        !navigator.onLine ||
        document.visibilityState !== "visible" ||
        sent >= 20
      )
        return;
      const key = `${event.kind}:${event.feature}:${event.code}`;
      if (Date.now() - (recent.get(key) ?? 0) < 300000) return;
      sent++;
      recent.set(key, Date.now());
      const release = process.env.NEXT_PUBLIC_APP_RELEASE ?? "unknown";
      void fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...event,
          device: navigator.maxTouchPoints > 0 ? "touch" : "desktop",
          release: /^[a-f0-9]{7,40}$/.test(release) ? release : "unknown",
        }),
      }).catch(() => {
        /* Reporting must never interrupt work. */
      });
    };
    const mutation = client.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const key = event.mutation.options.mutationKey?.[0];
      send({
        kind: "action_failed",
        feature: diagnosticFeatureFor(Array.isArray(key) ? key[0] : null),
        code: diagnosticErrorCode(event.mutation.state.error),
        duration: "unknown",
      });
    });
    const query = client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const queryKey: unknown = event.query.queryKey;
      const key: unknown = Array.isArray(queryKey) ? queryKey[0] : null;
      send({
        kind: "load_failed",
        feature: diagnosticFeatureFor(Array.isArray(key) ? key[0] : null),
        code: diagnosticErrorCode(event.query.state.error),
        duration: "unknown",
      });
    });
    const timer = window.setInterval(() => {
      if (
        !diagnosticsEnabled(account.accountKey) ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      ) {
        pending.clear();
        return;
      }
      const active = new Set<string>();
      for (const query of client.getQueryCache().getAll()) {
        if (
          !query.getObserversCount() ||
          query.state.status !== "pending" ||
          query.state.fetchStatus !== "fetching"
        )
          continue;
        const key = query.queryKey[0];
        const feature = diagnosticFeatureFor(
          Array.isArray(key) ? key[0] : null,
        );
        if (feature === "other") continue;
        active.add(query.queryHash);
        const start = pending.get(query.queryHash) ?? Date.now();
        pending.set(query.queryHash, start);
        if (Date.now() - start >= 60000)
          send({
            kind: "loading_stalled",
            feature,
            code: "none",
            duration: "over_60s",
          });
      }
      for (const hash of pending.keys())
        if (!active.has(hash)) pending.delete(hash);
    }, 5000);
    const click = (event: MouseEvent) => {
      if (!diagnosticsEnabled(account.accountKey)) {
        taps = null;
        return;
      }
      const element =
        event.target instanceof Element
          ? event.target.closest("[data-job-card]")
          : null;
      if (!element?.isConnected) return;
      const now = Date.now();
      taps =
        taps?.element === element && now - taps.at < 2000
          ? { element, at: taps.at, count: taps.count + 1 }
          : { element, at: now, count: 1 };
      if (taps.count === 3) {
        const id = element.getAttribute("data-job-card");
        const router =
          (
            {
              "material-lists": "materialList",
              tools: "assets",
              models: "drawings",
            } as Record<string, string>
          )[id ?? ""] ?? id;
        send({
          kind: "repeated_taps",
          feature: diagnosticFeatureFor(router),
          code: "none",
          duration: "under_10s",
        });
      }
    };
    document.addEventListener("click", click, true);
    return () => {
      mutation();
      query();
      clearInterval(timer);
      document.removeEventListener("click", click, true);
    };
  }, [account, client]);
  return null;
}
