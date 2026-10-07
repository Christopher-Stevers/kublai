"use client";
import { useEffect, useState } from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";
/** Cached metadata is a fallback only while the browser is actually offline. */
export function useDrawingSnapshot<T>(key: string, live: T | undefined) {
  const account = useDrawingAccount();
  const [online, setOnline] = useState(true);
  const [cached, setCached] = useState<{
    key: string;
    account: string;
    value: T;
  } | null>(null);
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
    if (account?.store)
      void account.store
        .readSnapshot<T>(key)
        .then((value) => {
          if (!stopped && value !== null)
            setCached({ key, account: account.accountKey, value });
        })
        .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [account, key]);
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
  };
}
