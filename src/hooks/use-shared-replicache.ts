"use client";
import { useSyncExternalStore } from "react";
import type { MutatorDefs, ReadTransaction, Replicache } from "replicache";

/** One database subscription per reader/Replicache, shared by all consumers. */
export function createSharedReplicacheReader<R>(
  read: (tx: ReadTransaction) => Promise<R>,
  empty: R,
  onData?: (value: R) => void,
) {
  const stores = new WeakMap<
    object,
    {
      get: () => R;
      subscribe: (notify: () => void) => () => void;
    }
  >();
  const idle = { get: () => empty, subscribe: () => () => {} };
  return function useShared<M extends MutatorDefs>(rep: Replicache<M> | null) {
    let store = rep ? stores.get(rep) : idle;
    if (!store && rep) {
      const instance = rep;
      let value = empty;
      const listeners = new Set<() => void>();
      let stop: (() => void) | undefined;
      store = {
        get: () => value,
        subscribe: (notify) => {
          listeners.add(notify);
          stop ??= instance.subscribe(read, {
            onData: (next) => {
              value = next;
              onData?.(next);
              listeners.forEach((fn) => fn());
            },
            onError: (error) =>
              console.error("Offline data subscription failed", error),
          });
          return () => {
            listeners.delete(notify);
            if (!listeners.size) {
              stop?.();
              stop = undefined;
            }
          };
        },
      };
      stores.set(instance, store);
    }
    const active = store ?? idle;
    return useSyncExternalStore(active.subscribe, active.get, idle.get);
  };
}
