"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getBrowserOnlineStatus } from "~/hooks/use-online-status";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import {
  OFFLINE_JOBS_EVENT,
  getOfflineJobDetail,
  getOfflineJobsList,
  getPendingDeletedJobIds,
  getPendingDeletedMaterialListIds,
  purgeAutoCreatedOfflineJobGhosts,
  normalizeLegacyOfflineMaterialListName,
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
  const liveJobs = useLiveQuery(
    async () => {
      const db = getOfflineDexieDb();
      if (!db) return undefined;
      const rows = await db.jobSummaries.orderBy("createdAt").reverse().toArray();
      return rows.map((row) => row.value as OfflineJobSummary);
    },
    [],
    undefined,
  );

  useEffect(() => {
    if (liveJobs === undefined) return;
    setCached(liveJobs.length > 0 ? liveJobs : getOfflineJobsList()?.data ?? null);
    setCacheLoaded(true);
  }, [liveJobs]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(liveJobs ?? getOfflineJobsList()?.data ?? null);
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
  }, [liveJobs]);

  useEffect(() => {
    // Local-only cleanup: these placeholder rows were created by old dashboard
    // auto-create behavior and can linger in browser storage without existing
    // on the server.
    purgeAutoCreatedOfflineJobGhosts([]);
  }, []);

  useEffect(() => {
    if (!isOnline || !serverData || serverData.length === 0) return;
    if (!cacheLoaded) return;

    const hasLocalJobs = (liveJobs?.length ?? 0) > 0 || (getOfflineJobsList()?.data.length ?? 0) > 0;
    if (hasLocalJobs || cached?.length) return;

    // Fresh browser/profile bootstrap: seed Dexie/localStorage once from the
    // server snapshot, then keep rendering from local state.
    setOfflineJobsList(serverData);
    setCached(serverData);
  }, [cacheLoaded, cached?.length, isOnline, liveJobs?.length, serverData]);

  const data = useMemo(() => {
    const pendingDeletedJobIds = getPendingDeletedJobIds();
    const filterDeletedJobs = (jobs: OfflineJobSummary[] | null | undefined) =>
      jobs?.filter((job) => !pendingDeletedJobIds.has(job.id)) ?? jobs ?? null;

    if (cacheLoaded && cached) return filterDeletedJobs(cached);
    if (!isOnline) return cacheLoaded ? filterDeletedJobs(cached) : null;
    return filterDeletedJobs(cached ?? null);
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
  const liveDetail = useLiveQuery(
    async () => {
      const db = getOfflineDexieDb();
      if (!db) return undefined;
      const row = await db.jobDetails.get(jobId);
      const detail = row?.value as
        | {
            job: OfflineJobDetail;
            materialLists: OfflineJobMaterialListSummary[];
          }
        | undefined;
      if (!detail) return undefined;

      const headers = await db.materialListHeaders.where("jobId").equals(jobId).toArray();
      const headersById = new Map(headers.map((header) => [header.id, header]));
      const itemCounts = new Map<string, number>();
      await Promise.all(
        detail.materialLists.map(async (list) => {
          itemCounts.set(
            list.id,
            await db.materialListItems.where("materialListId").equals(list.id).count(),
          );
        }),
      );

      return {
        ...detail,
        materialLists: detail.materialLists.map((list) => ({
          ...list,
          itemCount: itemCounts.get(list.id) ?? list.itemCount,
          materialTotal: headersById.get(list.id)?.materialTotal ?? list.materialTotal,
        })),
      };
    },
    [jobId],
    undefined,
  );

  useEffect(() => {
    if (liveDetail === undefined) return;
    setCached(liveDetail ?? getOfflineJobDetail(jobId)?.data ?? null);
    setCacheLoaded(true);
  }, [jobId, liveDetail]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setCached(null);
    setCacheLoaded(false);
    setIsOnline(window.navigator.onLine);
    setCached(liveDetail ?? getOfflineJobDetail(jobId)?.data ?? null);
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
  }, [jobId, liveDetail]);

  useEffect(() => {
    if (!isOnline || !serverJob || !serverMaterialLists) return;
    if (!cacheLoaded || cached) return;
    if (getOfflineJobDetail(jobId)?.data) return;

    // Fresh browser/profile bootstrap for direct job URLs. This imports the
    // server detail into local storage first; UI still reads the local copy.
    const detail = { job: serverJob, materialLists: serverMaterialLists };
    setOfflineJobDetail(jobId, detail);
    setCached(detail);
  }, [cacheLoaded, cached, isOnline, jobId, serverJob, serverMaterialLists]);

  const data = useMemo(() => {
    if (getPendingDeletedJobIds().has(jobId)) return null;

    const pendingDeletedMaterialListIds = getPendingDeletedMaterialListIds(jobId);
    const filterDeletedMaterialLists = (materialLists: OfflineJobMaterialListSummary[]) =>
      materialLists
        .filter((list) => !pendingDeletedMaterialListIds.has(list.id))
        .map((list) => ({
          ...list,
          name: normalizeLegacyOfflineMaterialListName(list.name, list.createdAt),
        }));

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
