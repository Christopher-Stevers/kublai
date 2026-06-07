"use client";

import { useCallback } from "react";
import { tryGetMaterialListReplicache } from "~/lib/replicache-material-list";
import { useReplicacheSubscribe } from "~/hooks/use-replicache-subscribe";

export interface ReplicacheJob {
  id: string;
  name: string;
  locationId: string | null;
  status: string;
  foremanName: string | null;
  poNumber: string | null;
  createdAt: string;
  location: {
    name: string;
    address1: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  pendingSync?: boolean;
}

export interface ReplicacheMaterialListSummary {
  id: string;
  name: string;
  jobId: string;
  quoteId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  materialTotal: number;
  sentSupplierCount?: number;
  totalSupplierCount?: number;
  pendingSync?: boolean;
}

function isJobRecord(value: unknown): value is ReplicacheJob {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "id" in value &&
    "name" in value
  );
}

function isMaterialListRecord(
  value: unknown,
): value is ReplicacheMaterialListSummary & { jobId: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "id" in value &&
    "jobId" in value
  );
}

function isMaterialListItemRecord(
  value: unknown,
): value is { materialListId: string; extendedPrice: string | null } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "materialListId" in value
  );
}

export function useReplicacheJobsList() {
  const rep = tryGetMaterialListReplicache();

  const jobs = useReplicacheSubscribe(
    rep,
    useCallback(async (tx) => {
      const jobEntries = await tx.scan({ prefix: "job/" }).entries().toArray();
      const mlEntries = await tx.scan({ prefix: "materialList/" }).entries().toArray();

      // Build materialListCount per job
      const countByJob = new Map<string, number>();
      for (const [, value] of mlEntries) {
        if (isMaterialListRecord(value)) {
          countByJob.set(value.jobId, (countByJob.get(value.jobId) ?? 0) + 1);
        }
      }

      const result: Array<ReplicacheJob & { materialListCount: number }> = [];
      for (const [, value] of jobEntries) {
        if (isJobRecord(value)) {
          const job = value as ReplicacheJob;
          result.push({
            ...job,
            materialListCount: countByJob.get(job.id) ?? 0,
          });
        }
      }

      return result.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }, []),
    { default: [] as Array<ReplicacheJob & { materialListCount: number }> },
  );

  return jobs;
}

export function useReplicacheJobDetail(jobId: string) {
  const rep = tryGetMaterialListReplicache();

  const result = useReplicacheSubscribe(
    rep,
    useCallback(async (tx) => {
      const jobValue = await tx.get(`job/${jobId}`);
      const job = isJobRecord(jobValue) ? jobValue : null;

      if (!job) return null;

      const mlEntries = await tx.scan({ prefix: "materialList/" }).entries().toArray();
      const itemEntries = await tx.scan({ prefix: "materialListItem/" }).entries().toArray();

      // Build per-materialList item counts and totals
      const itemCountByList = new Map<string, number>();
      const totalByList = new Map<string, number>();
      for (const [, value] of itemEntries) {
        if (isMaterialListItemRecord(value)) {
          const mlId = value.materialListId;
          itemCountByList.set(mlId, (itemCountByList.get(mlId) ?? 0) + 1);
          const price = value.extendedPrice ? parseFloat(String(value.extendedPrice)) : 0;
          totalByList.set(mlId, (totalByList.get(mlId) ?? 0) + (Number.isFinite(price) ? price : 0));
        }
      }

      const materialLists: ReplicacheMaterialListSummary[] = [];
      for (const [, value] of mlEntries) {
        if (isMaterialListRecord(value) && value.jobId === jobId) {
          materialLists.push({
            ...(value as ReplicacheMaterialListSummary),
            itemCount: itemCountByList.get(value.id) ?? 0,
            materialTotal: totalByList.get(value.id) ?? 0,
          });
        }
      }

      materialLists.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return { job, materialLists };
    }, [jobId]),
    { default: null as { job: ReplicacheJob; materialLists: ReplicacheMaterialListSummary[] } | null },
  );

  return result;
}
