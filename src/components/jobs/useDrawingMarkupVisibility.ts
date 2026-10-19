"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";

type MarkupVisibility = "private" | "published";
const values = new Map<string, MarkupVisibility>();
const listeners = new Map<string, Set<() => void>>();
const valid = (value: string | null): value is MarkupVisibility =>
  value === "private" || value === "published";
const keyFor = (account: string) =>
  `foremanhq:drawing-markup-visibility:${account}`;

function read(account: string): MarkupVisibility {
  if (!values.has(account)) {
    let value: string | null = null;
    try {
      value = localStorage.getItem(keyFor(account));
    } catch {
      /* Device storage is optional. */
    }
    values.set(account, valid(value) ? value : "published");
  }
  return values.get(account)!;
}
function notify(account: string) {
  for (const callback of listeners.get(account) ?? []) callback();
}

/** A personal default for new markups; existing records keep their visibility. */
export function useDrawingMarkupVisibility() {
  const account = useDrawingAccount()?.accountKey;
  const [local, setLocal] = useState<MarkupVisibility>("published");
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
  const visibility = useSyncExternalStore(subscribe, snapshot, () => null);
  const setVisibility = useCallback(
    (value: MarkupVisibility) => {
      if (!valid(value)) return;
      if (!account) {
        setLocal(value);
        return;
      }
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
  return [visibility ?? local, setVisibility] as const;
}
