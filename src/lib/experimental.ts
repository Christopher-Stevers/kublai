import { useSyncExternalStore } from "react";

export const EXPERIMENTAL_KEY = "foremanhq.experimental";
const CHANGE_EVENT = "foremanhq:experimental-change";

/** Experimental features show unless turned off on this device. */
export function isExperimentalEnabled() {
  try {
    return typeof window === "undefined" || localStorage.getItem(EXPERIMENTAL_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setExperimentalEnabled(enabled: boolean) {
  localStorage.setItem(EXPERIMENTAL_KEY, enabled ? "1" : "0");
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

export function useExperimentalEnabled() {
  return useSyncExternalStore(subscribe, isExperimentalEnabled, () => true);
}

/** Job screens that only show with experimental features on. */
export const EXPERIMENTAL_JOB_VIEWS: readonly string[] = ["models", "systems"];
