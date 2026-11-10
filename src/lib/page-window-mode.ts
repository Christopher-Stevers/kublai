"use client";
import { useSyncExternalStore } from "react";
export type PageWindowMode = "internal" | "external";
export type PageDevice = "mobile" | "desktop";
const EVENT = "foremanhq-window-mode";
export function getPageWindowMode(device: PageDevice): PageWindowMode {
  try {
    const value = localStorage.getItem(`foremanhq:window-mode:${device}`);
    if (value === "internal" || value === "external") return value;
  } catch { /* Defaults also work without storage. */ }
  return device === "mobile" ? "internal" : "external";
}
export function pageDevice(): PageDevice {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    window.matchMedia?.("(pointer: coarse)").matches ? "mobile" : "desktop";
}
export function setPageWindowMode(device: PageDevice, mode: PageWindowMode) {
  try { localStorage.setItem(`foremanhq:window-mode:${device}`, mode); } catch { /* Storage may be disabled. */ }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", callback); };
}
export function usePageWindowMode(device?: PageDevice) {
  return useSyncExternalStore(subscribe, () => getPageWindowMode(device ?? pageDevice()), () => device === "mobile" ? "internal" : "external");
}
