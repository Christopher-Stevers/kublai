"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserOnlineStatus } from "~/hooks/use-online-status";
import {
  OFFLINE_JOBS_EVENT,
  getOfflineJobDetail,
  getOfflineJobsList,
  getPendingDeletedJobIds,
  getPendingDeletedMaterialListIds,
  setOfflineJobDetail,
  setOfflineJobsList,
  type OfflineJobDetail,
  type OfflineJobMaterialListSummary,
  type OfflineJobSummary,
} from "~/lib/offline-jobs";

export function useOfflineJobsList(serverData?: OfflineJobSummary[]) {
  const [cached, setCached] = useState<OfflineJobSummary[] | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(getOfflineJobsList()?.data ?? null);
    setCacheLoaded(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onOfflineJobsChanged = () => setCached(getOfflineJobsList()?.data ?? null);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_JOBS_EVENT, onOfflineJobsChanged);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_JOBS_EVENT, onOfflineJobsChanged);
    };
  }, []);

  useEffect(() => {
    if (!serverData || !isOnline) return;

    setOfflineJobsList(serverData);
    setCached(serverData);
  }, [isOnline, serverData]);

  const data = useMemo(() => {
    const pendingDeletedJobIds = getPendingDeletedJobIds();
    const filterDeletedJobs = (jobs: OfflineJobSummary[] | null | undefined) =>
      jobs?.filter((job) => !pendingDeletedJobIds.has(job.id)) ?? jobs ?? null;

    if (isOnline && serverData) return filterDeletedJobs(serverData);
    if (cacheLoaded && cached) return filterDeletedJobs(cached);
    if (!isOnline) return cacheLoaded ? filterDeletedJobs(cached) : null;
    return filterDeletedJobs(cached ?? serverData ?? null);
  }, [cacheLoaded, cached, isOnline, serverData]);

  return {
    data,
    cached,
    cacheLoaded,
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
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setCached(null);
    setCacheLoaded(false);
    setIsOnline(window.navigator.onLine);
    setCached(getOfflineJobDetail(jobId)?.data ?? null);
    setCacheLoaded(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onOfflineJobsChanged = () => setCached(getOfflineJobDetail(jobId)?.data ?? null);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_JOBS_EVENT, onOfflineJobsChanged);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_JOBS_EVENT, onOfflineJobsChanged);
    };
  }, [jobId]);

  useEffect(() => {
    if (!serverJob || !serverMaterialLists || !isOnline) return;

    const next = {
      job: serverJob,
      materialLists: serverMaterialLists,
    };

    setOfflineJobDetail(jobId, next);
    setCached(next);
  }, [isOnline, jobId, serverJob, serverMaterialLists]);

  const data = useMemo(() => {
    if (getPendingDeletedJobIds().has(jobId)) return null;

    const pendingDeletedMaterialListIds = getPendingDeletedMaterialListIds(jobId);
    const filterDeletedMaterialLists = (materialLists: OfflineJobMaterialListSummary[]) =>
      materialLists.filter((list) => !pendingDeletedMaterialListIds.has(list.id));

    if (isOnline && serverJob && serverMaterialLists) {
      return {
        job: serverJob,
        materialLists: filterDeletedMaterialLists(serverMaterialLists),
      };
    }

    if (cacheLoaded && cached) {
      return {
        job: cached.job,
        materialLists: filterDeletedMaterialLists(cached.materialLists),
      };
    }
    if (cacheLoaded && !cached) {
      const summary = getOfflineJobsList()?.data.find((job) => job.id === jobId);
      if (summary) {
        return {
          job: {
            id: summary.id,
            name: summary.name,
            locationId: summary.locationId,
            foremanName: summary.foremanName,
            status: summary.status,
            createdAt: summary.createdAt,
            location: summary.location,
            foreman: summary.foreman,
          },
          materialLists: [],
        };
      }
    }
    if (!isOnline) return cacheLoaded ? cached : null;

    return cached ?? null;
  }, [cacheLoaded, cached, isOnline, jobId, serverJob, serverMaterialLists]);

  return {
    data,
    cached,
    cacheLoaded,
    isOnline,
    isOfflineFallback: !isOnline && !!cached,
  };
}
