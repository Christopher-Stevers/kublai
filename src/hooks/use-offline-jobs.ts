"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getOfflineJobDetail,
  getOfflineJobsList,
  setOfflineJobDetail,
  setOfflineJobsList,
  type OfflineJobDetail,
  type OfflineJobMaterialListSummary,
  type OfflineJobSummary,
} from "~/lib/offline-jobs";

export function useOfflineJobsList(serverData?: OfflineJobSummary[]) {
  const [cached, setCached] = useState<OfflineJobSummary[] | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(getOfflineJobsList()?.data ?? null);

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
    if (!serverData) return;

    setOfflineJobsList(serverData);
    setCached(serverData);
  }, [serverData]);

  const data = useMemo(() => {
    if (!isOnline && cached) return cached;
    return serverData ?? cached ?? null;
  }, [cached, isOnline, serverData]);

  return {
    data,
    cached,
    isOnline,
    isOfflineFallback: !isOnline && !!cached,
  };
}

export function useOfflineJobDetail(
  jobId: string,
  serverJob?: OfflineJobDetail,
  serverMaterialLists?: OfflineJobMaterialListSummary[],
) {
  const [cached, setCached] = useState<{
    job: OfflineJobDetail;
    materialLists: OfflineJobMaterialListSummary[];
  } | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(getOfflineJobDetail(jobId)?.data ?? null);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [jobId]);

  useEffect(() => {
    if (!serverJob || !serverMaterialLists) return;

    const next = {
      job: serverJob,
      materialLists: serverMaterialLists,
    };

    setOfflineJobDetail(jobId, next);
    setCached(next);
  }, [jobId, serverJob, serverMaterialLists]);

  const data = useMemo(() => {
    if (!isOnline && cached) return cached;

    if (serverJob && serverMaterialLists) {
      return {
        job: serverJob,
        materialLists: serverMaterialLists,
      };
    }

    return cached ?? null;
  }, [cached, isOnline, serverJob, serverMaterialLists]);

  return {
    data,
    cached,
    isOnline,
    isOfflineFallback: !isOnline && !!cached,
  };
}
