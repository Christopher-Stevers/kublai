"use client";

import { isOfflineTestEnabled } from "~/lib/offline-test";
import { goodUpdateLink, isChunkFailure, quietForRelease, reloadReleaseOnce, type UpdateConnection } from "~/lib/release-update";
import { releaseWorkPending, subscribeReleaseWork } from "~/lib/release-safety";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  const queries = useQueryClient();
  useEffect(() => {
    if (typeof window === "undefined" || isOfflineTestEnabled()) return;
    const recoveryWindow = window as Window & {__foremenhqReleaseRecoveryReady?: boolean};
    recoveryWindow.__foremenhqReleaseRecoveryReady = true;
    const serviceWorker = navigator.serviceWorker;
    let disposed = false;
    let registration: Awaited<ReturnType<ServiceWorkerContainer["register"]>> | undefined;
    let pending: string | undefined;
    let reloadNeeded = true;
    let recoveryPending = false;
    let lastInteraction = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checking = false;
    let signalsReady: Promise<unknown> | undefined;
    const currentBuild = process.env.NEXT_PUBLIC_BUILD_ID;
    const connection = (navigator as Navigator & {connection?: UpdateConnection}).connection;
    const editing = () => {
      if (document.querySelector('[data-unsaved-changes="true"]')) return true;
      if ([...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-busy="true"], [data-app-startup-loading], [data-route-loading]')].some(element => element.getClientRects().length)) return true;
      if ([...document.querySelectorAll<HTMLElement>('[contenteditable]:not([contenteditable="false"])')].some(element => element.getClientRects().length && (document.activeElement === element || !!element.textContent?.trim()))) return true;
      if ([...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].some(element => element.files?.length)) return true;
      return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])')].some(element =>
        element.getClientRects().length && (element.tagName === "TEXTAREA" || document.activeElement === element || element.value !== element.defaultValue));
    };
    const observer = new MutationObserver(() => schedule());
    const swapIfSafe = async () => {
      if (!pending || disposed || isOfflineTestEnabled() || !navigator.onLine || !quietForRelease(Date.now(), lastInteraction, queries.isMutating(), editing())) return;
      const target = pending;
      try {
        // Load read-only checks lazily so update coordination adds no shared
        // Replicache/drawing bundle cost to ordinary startup.
        signalsReady ??= Promise.all([import("~/lib/replicache-material-list"), import("~/lib/drawing-offline-queue"), import("~/lib/private-background-work")]);
        await signalsReady;
        if (await releaseWorkPending()) return;
      } catch { return; } // Unknown queue/storage state never permits a reload.
      const leave = new Event("beforeunload", {cancelable: true});
      if (!window.dispatchEvent(leave) || leave.defaultPrevented) return;
      if (disposed || pending !== target || !navigator.onLine || !quietForRelease(Date.now(), lastInteraction, queries.isMutating(), editing())) return;
      if (registration?.waiting) {
        registration.waiting.postMessage({type: "FOREMENHQ_ACTIVATE_RELEASE"});
        if (!reloadNeeded) { pending = undefined; observer.disconnect(); }
        return;
      }
      if (!reloadNeeded) { pending = undefined; observer.disconnect(); return; }
      try { reloadReleaseOnce(target, window.sessionStorage, () => window.location.reload()); } catch { /* Storage-disabled browsers keep the current screen. */ }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!pending || disposed) return;
      observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true});
      timer = setTimeout(() => { void swapIfSafe(); }, Math.max(50, 5000 - (Date.now() - lastInteraction)));
    };
    const interact = () => { lastInteraction = Date.now(); schedule(); };
    const controlChanged = () => schedule();
    const warm = (worker: ServiceWorker, build: string) => new Promise<boolean>(resolve => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); resolve(false); }, 60_000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout); channel.port1.close();
        const data = event.data as {ready?: unknown; build?: unknown} | null;
        resolve(data?.ready === true && data.build === build);
      };
      worker.postMessage({type: "FOREMENHQ_WARM_RELEASE", build, goodLink: true}, [channel.port2]);
    });
    const check = async () => {
      if (checking || disposed || isOfflineTestEnabled() || !registration || registration.installing || !goodUpdateLink(navigator.onLine, connection)) return;
      checking = true;
      try {
        const response = await fetch("/foremanhq-release-assets.json", {cache: "no-store", credentials: "same-origin"});
        if (!response.ok || response.redirected) return;
        const manifest = await response.json() as {build?: string};
        if (!manifest.build || !/^[a-f0-9]{64}$/.test(manifest.build) || (manifest.build === currentBuild && !registration.waiting)) return;
        const worker = registration.waiting ?? registration.active ?? serviceWorker?.controller;
        if (worker && await warm(worker, manifest.build) && !disposed) {
          pending = manifest.build; reloadNeeded = manifest.build !== currentBuild || recoveryPending; schedule();
        }
      } catch { /* Keep the current release if update fetch or storage fails. */ }
      finally { checking = false; }
    };
    const failed = (event: Event) => {
      const error = event as ErrorEvent;
      const rejection = event as PromiseRejectionEvent;
      const target = event.target as HTMLScriptElement | HTMLLinkElement | null;
      const resource = target && ("src" in target ? target.src : "href" in target ? target.href : "");
      const localAsset = resource?.startsWith(window.location.origin + "/_next/static/");
      const reason = rejection.reason as unknown;
      const reasonMessage = reason && typeof reason === "object" && "message" in reason ? reason.message : reason;
      if (localAsset || isChunkFailure(error.message) || isChunkFailure(reasonMessage)) { recoveryPending = true; reloadNeeded = true; pending = currentBuild; schedule(); }
    };
    const updateFound = () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => { if (worker.state === "installed") setTimeout(() => void check(), 0); });
    };
    const online = () => { schedule(); void check(); };
    const resume = () => { schedule(); if (document.visibilityState === "visible") void check(); };
    for (const type of ["pointerdown", "keydown", "input"]) window.addEventListener(type, interact, true);
    window.addEventListener("focusout", schedule);
    window.addEventListener("error", failed, true);
    window.addEventListener("unhandledrejection", failed);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", resume);
    serviceWorker?.addEventListener("controllerchange", controlChanged);
    const unsubscribe = queries.getMutationCache().subscribe(schedule);
    const stopReleaseWork = subscribeReleaseWork(schedule);
    void (async () => {
      try {
        if (!serviceWorker) return;
        registration = await serviceWorker.register("/sw.js", {scope: "/", updateViaCache: "none"});
        if (disposed) return;
        registration.addEventListener("updatefound", updateFound);
        await registration.update();
        await serviceWorker.ready;
        if (!disposed) void check();
      } catch { /* Existing authenticated online use remains available. */ }
    })();
    return () => {
      disposed = true; recoveryWindow.__foremenhqReleaseRecoveryReady = false; clearTimeout(timer); unsubscribe(); stopReleaseWork(); observer.disconnect();
      registration?.removeEventListener("updatefound", updateFound);
      for (const type of ["pointerdown", "keydown", "input"]) window.removeEventListener(type, interact, true);
      window.removeEventListener("focusout", schedule);
      window.removeEventListener("error", failed, true);
      window.removeEventListener("unhandledrejection", failed);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", resume);
      serviceWorker?.removeEventListener("controllerchange", controlChanged);
    };
  }, [queries]);
  return null;
}
