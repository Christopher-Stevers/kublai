"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getOfflineMaterialList,
  setOfflineMaterialList,
  type OfflineMaterialListEnvelope,
  type OfflineMaterialListRecord,
} from "~/lib/offline-material-list";

export function useOfflineMaterialList(
  materialListId: string,
  serverData?: OfflineMaterialListRecord,
) {
  const [cached, setCached] = useState<OfflineMaterialListEnvelope | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(getOfflineMaterialList(materialListId));

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [materialListId]);

  useEffect(() => {
    if (!serverData) return;

    setOfflineMaterialList(materialListId, serverData, { pendingSync: false });
    setCached(getOfflineMaterialList(materialListId));
  }, [materialListId, serverData]);

  const data = useMemo(() => {
    if (!isOnline && cached?.data) {
      return cached.data;
    }

    return serverData ?? cached?.data ?? null;
  }, [cached?.data, isOnline, serverData]);

  return {
    data,
    cached,
    isOnline,
    isOfflineFallback: !isOnline && !!cached?.data,
  };
}
