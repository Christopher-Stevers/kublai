"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getBrowserOnlineStatus } from "~/hooks/use-online-status";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import {
  OFFLINE_SUPPLIERS_EVENT,
  getOfflineSuppliers,
  type OfflineSupplier,
} from "~/lib/offline-suppliers";

export function useOfflineSuppliers(_serverData?: OfflineSupplier[]) {
  const [cached, setCached] = useState<OfflineSupplier[] | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);
  const liveSuppliers = useLiveQuery(
    async () => {
      const db = getOfflineDexieDb();
      if (!db) return undefined;
      const rows = await db.suppliers.orderBy("name").toArray();
      return rows.map((row) => row.value as OfflineSupplier);
    },
    [],
    undefined,
  );

  useEffect(() => {
    if (liveSuppliers === undefined) return;
    setCached(liveSuppliers.length > 0 ? liveSuppliers : getOfflineSuppliers() ?? null);
    setCacheLoaded(true);
  }, [liveSuppliers]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(liveSuppliers ?? getOfflineSuppliers() ?? null);
    setCacheLoaded(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onOfflineSuppliersChanged = () => setCached(getOfflineSuppliers() ?? null);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_SUPPLIERS_EVENT, onOfflineSuppliersChanged);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_SUPPLIERS_EVENT, onOfflineSuppliersChanged);
    };
  }, [liveSuppliers]);

  const data = useMemo(() => {
    if (cacheLoaded && cached) return cached;
    return cacheLoaded ? cached : null;
  }, [cacheLoaded, cached]);

  return {
    data,
    cached,
    cacheLoaded,
    isOnline,
    isOfflineFallback: !isOnline && !!cached,
  };
}
