"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
type AngleSetting = "on" | "off";
import { useDrawingAccount } from "./DrawingAccountProvider";

const values = new Map<string, AngleSetting>();
const listeners = new Map<string, Set<() => void>>();
const valid = (value: string | null): value is AngleSetting =>
  value === "on" || value === "off";
const keyFor = (account: string) => `foremanhq:drawing-angles:${account}`;
function read(account: string): AngleSetting {
  if (!values.has(account)) {
    let value: string | null = null;
    try {
      value = localStorage.getItem(keyFor(account));
    } catch {
      /* Device storage is optional. */
    }
    values.set(account, valid(value) ? value : "off");
  }
  return values.get(account)!;
}
function notify(account: string) {
  for (const callback of listeners.get(account) ?? []) callback();
}

/** Personal angle visibility. Existing accounts also start off. */
export function useDrawingAngles() {
  const account = useDrawingAccount()?.accountKey;
  const [local, setLocal] = useState<AngleSetting>("off");
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!account) return () => undefined;
      const callbacks = listeners.get(account) ?? new Set<() => void>();
      listeners.set(account, callbacks);
      callbacks.add(callback);
      const storage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== keyFor(account)) return;
        values.delete(account);
        if (event.key && valid(event.newValue))
          values.set(account, event.newValue);
        notify(account);
      };
      window.addEventListener("storage", storage);
      return () => {
        callbacks.delete(callback);
        if (!callbacks.size) listeners.delete(account);
        window.removeEventListener("storage", storage);
      };
    },
    [account],
  );
  const snapshot = useCallback(
    () => (account ? read(account) : null),
    [account],
  );
  const unit = useSyncExternalStore(subscribe, snapshot, () => null);
  const setUnit = useCallback(
    (next: AngleSetting | ((current: AngleSetting) => AngleSetting)) => {
      if (!account) {
        setLocal(next);
        return;
      }
      const value = typeof next === "function" ? next(read(account)) : next;
      if (!valid(value)) return;
      values.set(account, value);
      try {
        localStorage.setItem(keyFor(account), value);
      } catch {
        /* Keep the active preference in memory. */
      }
      notify(account);
    },
    [account],
  );
  return [unit ?? local, setUnit, Boolean(account)] as const;
}
