"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserOnlineStatus } from "~/hooks/use-online-status";
import {
  getOfflineSuppliers,
  setOfflineSuppliers,
  type OfflineSupplier,
} from "~/lib/offline-suppliers";

export function useOfflineSuppliers(serverData?: OfflineSupplier[]) {
  const [cached, setCached] = useState<OfflineSupplier[] | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(getOfflineSuppliers() ?? null);
    setCacheLoaded(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!serverData || !isOnline) return;

    setOfflineSuppliers(serverData);
    setCached(serverData);
  }, [isOnline, serverData]);

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
