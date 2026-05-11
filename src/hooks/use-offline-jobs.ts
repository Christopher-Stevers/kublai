"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getBrowserOnlineStatus } from "~/hooks/use-online-status";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import {
  OFFLINE_JOBS_EVENT,
  getOfflineEntityMutationQueue,
  getOfflineJobDetail,
  getOfflineJobsList,
  getPendingDeletedJobIds,
  getPendingDeletedMaterialListIds,
  purgeAutoCreatedOfflineJobGhosts,
  normalizeLegacyOfflineMaterialListName,
  mergeServerJobsIntoOfflineCache,
  setOfflineJobDetail,
  type OfflineJobDetail,
  type OfflineJobMaterialListSummary,
  type OfflineJobSummary,
} from "~/lib/offline-jobs";

function hasPendingJobDetailMutation(jobId: string) {
  return getOfflineEntityMutationQueue().some((mutation) => {
    if (mutation.type === "createJob") return mutation.localJobId === jobId;
    if (mutation.type === "updateJob" || mutation.type === "deleteJob")
      return mutation.jobId === jobId;
    if (mutation.type === "createMaterialList")
      return mutation.localJobId === jobId;
    if (mutation.type === "deleteMaterialList") return mutation.jobId === jobId;
    return false;
  });
}

export function useOfflineJobsList(serverData?: OfflineJobSummary[]) {
  const lastServerSeedSignatureRef = useRef<string | null>(null);
  const [cached, setCached] = useState<OfflineJobSummary[] | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);
  const liveJobs = useLiveQuery(
    async () => {
      const db = getOfflineDexieDb();
      if (!db) return undefined;
      const rows = await db.jobSummaries
        .orderBy("createdAt")
        .reverse()
        .toArray();
      return rows.map((row) => row.value as OfflineJobSummary);
    },
    [],
    undefined,
  );

  useEffect(() => {
    if (liveJobs === undefined) return;
    setCached(
      liveJobs.length > 0 ? liveJobs : (getOfflineJobsList()?.data ?? null),
    );
    setCacheLoaded(true);
  }, [liveJobs]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);
    setCached(liveJobs ?? getOfflineJobsList()?.data ?? null);
    setCacheLoaded(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onOfflineJobsChanged = () =>
      setCached(getOfflineJobsList()?.data ?? null);

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
    if (!isOnline || !serverData) return;
    if (!cacheLoaded) return;

    const signature = serverData
      .map(
        (job) =>
          `${job.id}:${String(job.createdAt)}:${job.name}:${job.materialListCount ?? ""}`,
      )
      .join("|");
    if (lastServerSeedSignatureRef.current === signature) return;
    lastServerSeedSignatureRef.current = signature;

    // Initial online load checks the server for updates and writes the merged
    // snapshot into Dexie/localStorage. Local pending work still wins, then UI
    // renders from Dexie instead of directly from the server response.
    const mergedJobs = mergeServerJobsIntoOfflineCache(serverData);
    setCached(mergedJobs);
  }, [cacheLoaded, isOnline, serverData]);

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
  const lastServerDetailSeedSignatureRef = useRef<string | null>(null);
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

      const headers = await db.materialListHeaders
        .where("jobId")
        .equals(jobId)
        .toArray();
      const headersById = new Map(headers.map((header) => [header.id, header]));
      const itemCounts = new Map<string, number>();
      await Promise.all(
        detail.materialLists.map(async (list) => {
          itemCounts.set(
            list.id,
            await db.materialListItems
              .where("materialListId")
              .equals(list.id)
              .count(),
          );
        }),
      );

      return {
        ...detail,
        materialLists: detail.materialLists.map((list) => ({
          ...list,
          itemCount: itemCounts.get(list.id) ?? list.itemCount,
          materialTotal:
            headersById.get(list.id)?.materialTotal ?? list.materialTotal,
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
    const onOfflineJobsChanged = () =>
      setCached(getOfflineJobDetail(jobId)?.data ?? null);

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
    if (!cacheLoaded) return;
    if (hasPendingJobDetailMutation(jobId)) return;

    const signature = [
      serverJob.id,
      serverJob.name,
      String(serverJob.createdAt),
      serverMaterialLists
        .map((list) => `${list.id}:${list.name}:${String(list.createdAt)}`)
        .join("|"),
    ].join("::");
    if (lastServerDetailSeedSignatureRef.current === signature) return;
    lastServerDetailSeedSignatureRef.current = signature;

    // Initial online load checks server detail and refreshes the local Dexie
    // copy when no local job/material-list mutation is waiting for this job.
    const pendingDeletedMaterialListIds =
      getPendingDeletedMaterialListIds(jobId);
    const detail = {
      job: serverJob,
      materialLists: serverMaterialLists.filter(
        (list) => !pendingDeletedMaterialListIds.has(list.id),
      ),
    };
    setOfflineJobDetail(jobId, detail);
    setCached(detail);
  }, [cacheLoaded, isOnline, jobId, serverJob, serverMaterialLists]);

  const data = useMemo(() => {
    if (getPendingDeletedJobIds().has(jobId)) return null;

    const pendingDeletedMaterialListIds =
      getPendingDeletedMaterialListIds(jobId);
    const filterDeletedMaterialLists = (
      materialLists: OfflineJobMaterialListSummary[],
    ) =>
      materialLists
        .filter((list) => !pendingDeletedMaterialListIds.has(list.id))
        .map((list) => ({
          ...list,
          name: normalizeLegacyOfflineMaterialListName(
            list.name,
            list.createdAt,
          ),
        }));

    if (cacheLoaded && cached) {
      return {
        job: cached.job,
        materialLists: filterDeletedMaterialLists(cached.materialLists),
      };
    }
    if (cacheLoaded && !cached) {
      const summary = getOfflineJobsList()?.data.find(
        (job) => job.id === jobId,
      );
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
