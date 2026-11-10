"use client";
import { useSyncExternalStore } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";
const EVENT = "foremanhq:document-page-mode-change";
const memory = new Map<string, boolean>();
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", callback); };
}
/** v3 resets scrolling off once for every account/scope; subsequent choices persist. */
export function useDrawingPageMode(scope: string) {
  const account = useDrawingAccount();
  const key = account ? `foremanhq:page-mode:v3:${JSON.stringify([account.accountKey, scope])}` : null;
  const scroll = useSyncExternalStore(subscribe, () => {
    if (!key) return false;
    try { const stored = localStorage.getItem(key); return stored === null ? (memory.get(key) ?? false) : stored === "scroll"; }
    catch { return memory.get(key) ?? false; }
  }, () => false);
  return { scroll, setScroll: (value: boolean) => {
    if (!key) return;
    try { localStorage.setItem(key, value ? "scroll" : "buttons"); memory.delete(key); }
    catch { memory.set(key, value); }
    window.dispatchEvent(new Event(EVENT));
  } };
}
export function DrawingPageModeSetting({scope}: {scope: string}) {
  const { scroll, setScroll } = useDrawingPageMode(scope);
  return <label className="flex items-center justify-between gap-3 px-2 py-3 text-sm">
    <span>Scroll between pages<span className="text-muted-foreground block text-xs">Remembered for this folder</span></span>
    <input type="checkbox" role="switch" aria-label="Scroll between pages" checked={scroll} onChange={event => setScroll(event.target.checked)} className="size-5 accent-primary" />
  </label>;
}
