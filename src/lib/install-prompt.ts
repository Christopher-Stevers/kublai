"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Chrome/Edge/Android: the deferred "install app" prompt. Safari never fires it. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallState = {
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
};

let state: InstallState = { prompt: null, installed: false };
const listeners = new Set<() => void>();
const SERVER_STATE: InstallState = { prompt: null, installed: false };

function set(next: Partial<InstallState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ("standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true)
  );
}

/** iPhone/iPad Safari, where installing is only possible from the Share menu. */
export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// The browser fires this once per page load, possibly before any screen that
// offers installation mounts, so capture it as soon as this module loads.
if (typeof window !== "undefined") {
  state = { prompt: null, installed: isStandaloneApp() };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    set({ prompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () =>
    set({ installed: true, prompt: null }),
  );
}

/**
 * Points the page at a different manifest (e.g. one job's chat) until the
 * returned function restores the original. Any prompt captured for the old
 * manifest is dropped, so installing never adds the wrong shortcut; the browser
 * offers a new prompt once it has read the new manifest.
 */
export function useManifestOverride(href: string | null, appleTitle: string) {
  useEffect(() => {
    if (!href) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const title = document.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]',
    );
    if (!link) return;
    const original = { href: link.getAttribute("href"), title: title?.content };
    link.setAttribute("href", href);
    if (title) title.content = appleTitle;
    set({ prompt: null });
    return () => {
      if (original.href) link.setAttribute("href", original.href);
      if (title && original.title !== undefined) title.content = original.title;
      set({ prompt: null });
    };
  }, [href, appleTitle]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallPrompt() {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
  return {
    ...current,
    /** Shows the browser's install dialog. Returns false when none is available. */
    install: async () => {
      const prompt = state.prompt;
      if (!prompt) return false;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      set({ prompt: null, installed: choice.outcome === "accepted" });
      return true;
    },
  };
}
