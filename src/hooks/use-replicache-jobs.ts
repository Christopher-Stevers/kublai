"use client";

import { useMemo } from "react";
import { tryGetMaterialListReplicache } from "~/lib/replicache-material-list";
import { createSharedReplicacheReader } from "~/hooks/use-shared-replicache";
import type {
  ReplicacheMaterialListItem,
  ReplicacheMaterialList,
} from "./use-replicache-material-list";

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

export interface ReplicacheContributor {
  id: string;
  name: string | null;
  email: string | null;
}

export interface ReplicacheMaterialListSummary {
  id: string;
  name: string;
  kind?: "materials" | "tools";
  jobId: string;
  quoteId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  materialTotal: number;
  sentSupplierCount?: number;
  totalSupplierCount?: number;
  verifiedSupplierCount?: number;
  createdBy?: ReplicacheContributor | null;
  contributors?: ReplicacheContributor[];
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

function addContributor(
  contributors: ReplicacheContributor[],
  seenIds: Set<string>,
  contributor: ReplicacheContributor | null | undefined,
) {
  if (!contributor?.id || seenIds.has(contributor.id)) return;
  contributors.push(contributor);
  seenIds.add(contributor.id);
}

type ListDetail = {
  materialList: ReplicacheMaterialList;
  items: ReplicacheMaterialListItem[];
  materialTotal: number;
  isLoading: boolean;
};
type WorkspaceIndex = {
  jobs: Array<
    ReplicacheJob & { materialListCount: number; lastActivityAt: string }
  >;
  details: Record<
    string,
    { job: ReplicacheJob; materialLists: ReplicacheMaterialListSummary[] }
  >;
  lists: Record<string, ListDetail>;
};
const EMPTY_INDEX: WorkspaceIndex = { jobs: [], details: {}, lists: {} };

export function indexWorkspaceRecords(
  jobValues: readonly unknown[],
  listValues: readonly unknown[],
  itemValues: readonly unknown[],
): WorkspaceIndex {
  const lists = listValues.filter(isMaterialListRecord);
  const listByQuote = new Map(
    lists.filter((l) => l.quoteId).map((l) => [l.quoteId, l.id]),
  );
  const itemsByList = new Map<string, ReplicacheMaterialListItem[]>();
  for (const value of itemValues) {
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      !("quantity" in value)
    )
      continue;
    const item = value as ReplicacheMaterialListItem;
    const listId = item.materialListId || listByQuote.get(item.quoteId);
    if (!listId) continue;
    const bucket = itemsByList.get(listId) ?? [];
    bucket.push(item);
    itemsByList.set(listId, bucket);
  }
  const result: WorkspaceIndex = { jobs: [], details: {}, lists: {} };
  const listsByJob = new Map<string, ReplicacheMaterialListSummary[]>();
  for (const list of lists) {
    const items = itemsByList.get(list.id) ?? [];
    items.sort((a, b) =>
      a.createdAt && b.createdAt
        ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
        : 0,
    );
    let total = 0;
    const contributors: ReplicacheContributor[] = [],
      seen = new Set<string>();
    addContributor(contributors, seen, list.createdBy);
    for (const item of items) {
      const price = Number(item.extendedPrice);
      if (Number.isFinite(price)) total += price;
      addContributor(contributors, seen, item.addedBy);
    }
    result.lists[list.id] = {
      materialList: list,
      items,
      materialTotal: total,
      isLoading: false,
    };
    const bucket = listsByJob.get(list.jobId) ?? [];
    bucket.push({
      ...list,
      itemCount: items.length,
      materialTotal: total,
      contributors,
    });
    listsByJob.set(list.jobId, bucket);
  }
  for (const job of jobValues.filter(isJobRecord)) {
    const materialLists = listsByJob.get(job.id) ?? [];
    materialLists.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    // Most recent change to the job or any of its material lists.
    const lastActivityAt = materialLists.reduce(
      (latest, list) =>
        Date.parse(list.updatedAt) > Date.parse(latest)
          ? list.updatedAt
          : latest,
      job.createdAt,
    );
    result.jobs.push({
      ...job,
      materialListCount: materialLists.length,
      lastActivityAt,
    });
    result.details[job.id] = { job, materialLists };
  }
  result.jobs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return result;
}

// Dashboard job summaries need no item scan. A quantity edit therefore does not
// rebuild every list just because the dashboard remains mounted underneath it.
const useJobs = createSharedReplicacheReader(async (tx) => {
  const [jobs, lists] = await Promise.all([
    tx.scan({ prefix: "job/" }).values().toArray(),
    tx.scan({ prefix: "materialList/" }).values().toArray(),
  ]);
  return indexWorkspaceRecords(jobs, lists, []).jobs;
}, EMPTY_INDEX.jobs);

export function useReplicacheJobsList() {
  return useJobs(tryGetMaterialListReplicache());
}
export function useReplicacheJobDetail(jobId: string) {
  const useReader = useMemo(
    () =>
      createSharedReplicacheReader(
        async (tx) => {
          const [job, lists] = await Promise.all([
            tx.get(`job/${jobId}`) as unknown as Promise<
              ReplicacheJob | undefined
            >,
            tx
              .scan({ indexName: "listsByJob", prefix: jobId })
              .values()
              .toArray() as unknown as Promise<ReplicacheMaterialListSummary[]>,
          ]);
          if (!job) return null;
          const groups = await Promise.all(
            lists.map(async (list) => {
              const byList = (await tx
                .scan({ indexName: "itemsByList", prefix: list.id })
                .values()
                .toArray()) as unknown as ReplicacheMaterialListItem[];
              const byQuote = list.quoteId
                ? ((await tx
                    .scan({ indexName: "itemsByQuote", prefix: list.quoteId })
                    .values()
                    .toArray()) as unknown as ReplicacheMaterialListItem[])
                : [];
              return [
                ...byList,
                ...byQuote.filter((item) => !item.materialListId),
              ];
            }),
          );
          return (
            indexWorkspaceRecords([job], lists, groups.flat()).details[jobId] ??
            null
          );
        },
        null as WorkspaceIndex["details"][string] | null,
      ),
    [jobId],
  );
  return useReader(tryGetMaterialListReplicache());
}

/** Header fields do not depend on every material line in the job. */
export function useReplicacheJob(jobId: string) {
  const useReader = useMemo(() => createSharedReplicacheReader(async tx =>
    (await tx.get(`job/${jobId}`) ?? null) as unknown as ReplicacheJob | null,
    null as ReplicacheJob | null), [jobId]);
  return useReader(tryGetMaterialListReplicache());
}
