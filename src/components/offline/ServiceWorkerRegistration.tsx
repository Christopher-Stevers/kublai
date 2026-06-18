"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const registerWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // Check for a fresh worker after each app open. The worker is network-first
        // for pages, so updated HTML/JS wins online while cached pages remain
        // available offline.
        await registration.update();

        const readyRegistration = await navigator.serviceWorker.ready;
        const worker =
          readyRegistration.active ??
          readyRegistration.waiting ??
          readyRegistration.installing ??
          navigator.serviceWorker.controller;

        worker?.postMessage({
          type: "FOREMENHQ_CACHE_APP_SHELL",
          urls: [window.location.pathname],
        });
      } catch (error) {
        console.warn("Failed to register ForemenHQ service worker", error);
      }
    };

    void registerWorker();
  }, []);

  return null;
}
