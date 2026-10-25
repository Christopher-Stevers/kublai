"use client";
import { useEffect, useState } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";
import type { DrawingOfflineStore } from "~/lib/drawing-offline";
/** Cached metadata is a fallback only while the browser is actually offline. */
export function useDrawingSnapshot<T>(
  key: string,
  live: T | undefined,
  readCached?: (store: DrawingOfflineStore, key: string) => Promise<T | null>,
) {
  const account = useDrawingAccount();
  const [online, setOnline] = useState(true);
  const [cached, setCached] = useState<{
    key: string;
    account: string;
    value: T;
  } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; account: string } | null>(
    null,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    // Custom readers may recover a legacy snapshot. Defer those potentially
    // large reads until offline; the live query supplies current online data.
    if (account?.store && (!readCached || !online))
      void (
        readCached
          ? readCached(account.store, key)
          : account.store.readSnapshot<T>(key)
      )
        .then((value) => {
          if (!stopped)
            setCached(
              value === null
                ? null
                : { key, account: account.accountKey, value },
            );
        })
        .catch(() => undefined)
        .finally(() => {
          if (!stopped) setLoaded({ key, account: account.accountKey });
        });
    return () => {
      stopped = true;
    };
  }, [account, key, readCached, online]);
  useEffect(() => {
    if (account?.store && live !== undefined && online)
      void account.store.saveSnapshot(key, live).catch(() => undefined);
  }, [account, key, live, online]);
  return {
    data:
      live ??
      (!online && cached?.key === key && cached.account === account?.accountKey
        ? cached.value
        : undefined),
    online,
    loading:
      !online &&
      live === undefined &&
      Boolean(account?.store) &&
      (loaded?.key !== key || loaded.account !== account?.accountKey),
  };
}
