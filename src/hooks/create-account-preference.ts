"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/** One store per preference, scoped to the signed-in account. */
export function createAccountPreference<T extends string>({
  keyFor,
  valid,
  initial,
}: {
  keyFor: (account: string) => string;
  valid: (value: string | null) => value is T;
  initial: T;
}) {
  const values = new Map<string, T>();
  const listeners = new Map<string, Set<() => void>>();
  function read(account: string): T {
    if (!values.has(account)) {
      let value: string | null = null;
      try {
        value = localStorage.getItem(keyFor(account));
      } catch {
        /* Device storage is optional. */
      }
      values.set(account, valid(value) ? value : initial);
    }
    return values.get(account)!;
  }
  function notify(account: string) {
    for (const callback of listeners.get(account) ?? []) callback();
  }

  return function useAccountPreference(account: string | undefined) {
    const [local, setLocal] = useState<T>(initial);
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
    const value = useSyncExternalStore(subscribe, snapshot, () => null);
    const setValue = useCallback(
      (next: T | ((current: T) => T)) => {
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
    return [value ?? local, setValue, Boolean(account)] as const;
  };
}
