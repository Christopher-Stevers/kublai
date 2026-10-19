"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";

const EVENT = "foremanhq:drawing-quick-wheel-change";
const memory = new Map<string, boolean>();
const keyFor = (account: string) => `foremanhq:drawing-quick-wheel:${account}`;

/** Shared by the drawing workspace and its page navigation, scoped to the account. */
export function useDrawingQuickWheelMode() {
  const account = useDrawingAccount()?.accountKey ?? "guest";
  const key = keyFor(account);
  const subscribe = useCallback(
    (notify: () => void) => {
      const storage = (event: StorageEvent) => {
        if (!event.key || event.key === key) notify();
      };
      window.addEventListener(EVENT, notify);
      window.addEventListener("storage", storage);
      return () => {
        window.removeEventListener(EVENT, notify);
        window.removeEventListener("storage", storage);
      };
    },
    [key],
  );
  const read = useCallback(() => {
    try {
      return localStorage.getItem(key) === "on";
    } catch {
      return memory.get(key) ?? false;
    }
  }, [key]);
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const setEnabled = useCallback(
    (value: boolean) => {
      memory.set(key, value);
      try {
        localStorage.setItem(key, value ? "on" : "off");
      } catch {
        /* Keep the session preference. */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return { enabled, setEnabled };
}

export function DrawingQuickWheelSetting() {
  const { enabled, setEnabled } = useDrawingQuickWheelMode();
  return (
    <label className="flex items-center justify-between gap-3 px-2 py-3 text-sm">
      <span>
        Quickwheel mode
        <span className="text-muted-foreground block text-xs">
          Right-click or long press for drawing controls
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label="Quickwheel mode"
        checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)}
        className="accent-primary size-5"
      />
    </label>
  );
}
