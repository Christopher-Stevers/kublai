"use client";
import { useSyncExternalStore } from "react";
const KEY = "foremanhq:document-page-mode";
const EVENT = "foremanhq:document-page-mode-change";
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", callback); };
}
function read() { try { return localStorage.getItem(KEY) === "scroll"; } catch { return false; } }
export function useDrawingPageMode() {
  const scroll = useSyncExternalStore(subscribe, read, () => false);
  return { scroll, setScroll: (value: boolean) => {
    try { localStorage.setItem(KEY, value ? "scroll" : "buttons"); } catch { return; }
    window.dispatchEvent(new Event(EVENT));
  } };
}
export function DrawingPageModeSetting() {
  const { scroll, setScroll } = useDrawingPageMode();
  return <label className="flex items-center justify-between gap-3 px-2 py-3 text-sm">
    <span>Scroll between pages<span className="text-muted-foreground block text-xs">Documents and drawings</span></span>
    <input type="checkbox" role="switch" aria-label="Scroll between pages" checked={scroll} onChange={event => setScroll(event.target.checked)} className="size-5 accent-primary" />
  </label>;
}
