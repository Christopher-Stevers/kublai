import { useSyncExternalStore } from "react";

export const DEV_PREFERENCE_KEY = "foremanhq.dev";
const LEGACY_KEY = "foremanhq.experimental";
const CHANGE_EVENT = "foremanhq:dev-change";

/** Preserve an existing experimental preference until the user changes Dev. */
export function isDevPreferenceEnabled() {
  try {
    if (typeof window === "undefined") return true;
    return (localStorage.getItem(DEV_PREFERENCE_KEY) ?? localStorage.getItem(LEGACY_KEY)) !== "0";
  } catch {
    return true;
  }
}
export function setDevPreferenceEnabled(enabled: boolean) {
  localStorage.setItem(DEV_PREFERENCE_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}
export function useDevPreference() {
  return useSyncExternalStore(subscribe, isDevPreferenceEnabled, () => true);
}
export const DEV_JOB_VIEWS: readonly string[] = ["models", "systems"];
