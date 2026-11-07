"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserOnlineStatus } from "~/hooks/use-online-status";
import {
  getOfflineOrders,
  getOfflineQuotes,
  setOfflineOrders,
  setOfflineQuotes,
  type OfflineOrders,
  type OfflineQuotes,
} from "~/lib/offline-documents";

function useLocalFirstList<T>(
  serverData: T | undefined,
  getCached: () => { data: T } | null,
  setCachedValue: (data: T) => void,
) {
  const [cached, setCached] = useState<T | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(getCached()?.data ?? null);
    setCacheLoaded(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [getCached]);

  useEffect(() => {
    if (!serverData || !isOnline) return;
    setCachedValue(serverData);
    setCached(serverData);
  }, [isOnline, serverData, setCachedValue]);

  const data = useMemo(() => {
    if (cacheLoaded && cached) return cached;
    if (!isOnline) return cacheLoaded ? cached : null;
    return cached ?? serverData ?? null;
  }, [cacheLoaded, cached, isOnline, serverData]);

  return {
    data,
    cached,
    cacheLoaded,
    isOnline,
    isOfflineFallback: !isOnline && !!cached,
  };
}

export function useOfflineQuotes(serverData?: OfflineQuotes) {
  return useLocalFirstList(serverData, getOfflineQuotes, setOfflineQuotes);
}

export function useOfflineOrders(serverData?: OfflineOrders) {
  return useLocalFirstList(serverData, getOfflineOrders, setOfflineOrders);
}
