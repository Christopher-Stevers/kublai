"use client";

import { useEffect } from "react";

const OFFLINE_CACHE_NAME = "foremenhq-offline-shell-v8";

const APP_SHELL_ROUTES: Array<{ url: string; fallback?: string }> = [
  { url: "/dashboard" },
  { url: "/dashboard/catalogue" },
  { url: "/dashboard/suppliers" },
  { url: "/dashboard/quotes" },
  { url: "/dashboard/orders" },
  { url: "/dashboard/account" },
  {
    url: "/dashboard/jobs/__offline-shell__",
    fallback: "/__offline_fallback/dashboard/jobs",
  },
  {
    url: "/dashboard/material-lists/__offline-shell__",
    fallback: "/__offline_fallback/dashboard/material-lists",
  },
];

const PWA_ASSETS: string[] = [
  "/manifest.webmanifest",
  "/foremanhq/site.webmanifest",
  "/foremanhq/favicon.ico",
  "/foremanhq/favicon-16x16.png",
  "/foremanhq/favicon-32x32.png",
  "/foremanhq/apple-touch-icon.png",
  "/foremanhq/android-chrome-192x192.png",
  "/foremanhq/android-chrome-512x512.png",
];

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        if (window.location.pathname.startsWith("/dashboard")) {
          const cache = await window.caches?.open(OFFLINE_CACHE_NAME);
          const cacheEntries: Array<{ url: string; fallback?: string }> = [
            ...APP_SHELL_ROUTES,
            ...PWA_ASSETS.map((url) => ({ url })),
          ];
          await Promise.allSettled(
            cacheEntries.map(async ({ url, fallback }) => {
              const response = await fetch(url, {
                cache: "reload",
                credentials: "same-origin",
              });
              if (response.ok && cache) {
                await cache.put(url, response.clone());
                if (fallback) {
                  await cache.put(fallback, response.clone());
                }
              }
            }),
          );
        }
      } catch (error) {
        console.warn("Failed to register ForemenHQ service worker", error);
      }
    };

    void register();
  }, []);

  return null;
}
