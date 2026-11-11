"use client";

import { isOfflineTestEnabled } from "~/lib/offline-test";
import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || isOfflineTestEnabled()) return;
    if (!("serviceWorker" in navigator)) return;

    const registerWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // Check for a fresh worker after each app open. Documents still pass
        // the server authentication gate; only an authenticated live tab can
        // reuse saved route payloads.
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
