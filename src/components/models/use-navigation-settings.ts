"use client";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_NAVIGATION,
  navigationSettingsSchema,
  type NavigationSettings,
} from "~/lib/bim/navigation-settings";
const prefix = "foremanhq:model-navigation:v1:";
const changed = "foremanhq:model-navigation-changed";
type Snapshot = {
  raw: string | null;
  value: NavigationSettings;
  persistent: boolean;
};
const cache = new Map<string, Snapshot>();
const initial: Snapshot = {
  raw: null,
  value: DEFAULT_NAVIGATION,
  persistent: true,
};
function read(userId: string) {
  const old = cache.get(userId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(prefix + userId);
  } catch {
    if (old?.persistent === false) return old;
    const session = { ...(old ?? initial), persistent: false };
    cache.set(userId, session);
    return session;
  }
  if (old?.raw === raw) return old;
  let value = DEFAULT_NAVIGATION;
  try {
    value = navigationSettingsSchema.parse(JSON.parse(raw ?? "null"));
  } catch {
    /* Use safe defaults for missing or outdated preferences. */
  }
  const snapshot = { raw, value, persistent: true };
  cache.set(userId, snapshot);
  return snapshot;
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changed, listener);
  };
}
const serverSnapshot = () => initial;
export function useNavigationSettings(userId: string) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => read(userId),
    serverSnapshot,
  );
  const update = (next: NavigationSettings) => {
    const value = navigationSettingsSchema.parse(next);
    let raw = cache.get(userId)?.raw ?? null;
    let saved = true;
    try {
      raw = JSON.stringify(value);
      localStorage.setItem(prefix + userId, raw);
    } catch {
      saved = false;
      raw = cache.get(userId)?.raw ?? null;
    }
    cache.set(userId, { raw, value, persistent: saved });
    window.dispatchEvent(new Event(changed));
    return saved;
  };
  return { settings: snapshot.value, persistent: snapshot.persistent, update };
}
