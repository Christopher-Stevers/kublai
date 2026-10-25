"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ReadTransaction, Replicache } from "replicache";
import { tryGetMaterialListReplicache } from "~/lib/replicache-material-list";
import { createSharedReplicacheReader } from "~/hooks/use-shared-replicache";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import type {
  ReplicacheMaterialListItem,
  ReplicacheMaterialList,
} from "./use-replicache-material-list";

export interface ReplicacheJob {
  supplierDefaults?:
    | import("~/lib/job-supplier-defaults").JobSupplierDefaults
    | null;
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
  department?: string | null;
  id: string;
  name: string | null;
  email: string | null;
}

export interface ReplicacheMaterialListSummary {
  id: string;
  roomId?: string | null;
  roomName?: string | null;
  name: string;
  kind?: "materials" | "tools";
  jobId: string;
  quoteId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  materialTotal: number;
  orderNumbers?: string[];
  overallProgress?: number;
  orderStatuses?: import("~/lib/material-list-order-status").MaterialListOrderStatus[];
  sentSupplierCount?: number;
  totalSupplierCount?: number;
  verifiedSupplierCount?: number;
  createdBy?: ReplicacheContributor | null;
  contributors?: ReplicacheContributor[];
  departments?: string[];
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
  if (!contributor?.id) return;
  if (seenIds.has(contributor.id)) {
    const index = contributors.findIndex(
      (person) => person.id === contributor.id,
    );
    const existing = contributors[index];
    if (
      existing &&
      !existing.department?.trim() &&
      contributor.department?.trim()
    )
      contributors[index] = { ...existing, department: contributor.department };
    return;
  }
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
    const departments = new Map<string, string>();
    const contributors: ReplicacheContributor[] = [],
      seen = new Set<string>();
    addContributor(contributors, seen, list.createdBy);
    for (const item of items) {
      const price = Number(item.extendedPrice);
      if (Number.isFinite(price)) total += price;
      addContributor(contributors, seen, item.addedBy);
      const department = item.addedBy?.department?.trim();
      if (department && !departments.has(department.toLocaleLowerCase())) {
        departments.set(department.toLocaleLowerCase(), department);
      }
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
      pendingSync: Boolean(
        list.pendingSync || items.some((item) => item.pendingSync),
      ),
      itemCount: items.length,
      materialTotal: total,
      contributors,
      departments: [...departments.values()].sort((a, b) => a.localeCompare(b)),
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

// Jobs job summaries need no item scan. A quantity edit therefore does not
// rebuild every list just because the Jobs remains mounted underneath it.
const useJobs = createSharedReplicacheReader(async (tx) => {
  const [jobs, lists] = await Promise.all([
    tx.scan({ prefix: "job/" }).values().toArray(),
    tx.scan({ prefix: "materialList/" }).values().toArray(),
  ]);
  return indexWorkspaceRecords(jobs, lists, []).jobs;
}, EMPTY_INDEX.jobs);

export function useReplicacheJobsList() {
  const sandbox = useTutorialSandbox();
  return useJobs(sandbox?.material ?? tryGetMaterialListReplicache());
}
/** Header/menu readers subscribe to lists, but never to their potentially thousands of lines. */
export async function readJobDetail(
  tx: ReadTransaction,
  jobId: string,
  includeItems = true,
) {
  if (!jobId) return null;
  const [job, lists] = await Promise.all([
    tx.get(`job/${jobId}`) as unknown as Promise<ReplicacheJob | undefined>,
    tx
      .scan({ indexName: "listsByJob", prefix: jobId })
      .values()
      .toArray() as unknown as Promise<ReplicacheMaterialListSummary[]>,
  ]);
  if (!job) return null;
  if (!includeItems) return { job, materialLists: lists };
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
      return [...byList, ...byQuote.filter((item) => !item.materialListId)];
    }),
  );
  return (
    indexWorkspaceRecords([job], lists, groups.flat()).details[jobId] ?? null
  );
}

/** Per-list subscriptions let Replicache invalidate just the list whose items changed.
 * These derived summaries stay in memory: old tabs and offline mutators need no migration. */
export function createJobSummaryStore(
  rep: Pick<Replicache, "subscribe">,
  jobId: string,
) {
  type Detail = WorkspaceIndex["details"][string];
  let value: Detail | null = null;
  let metadata: Detail | null = null;
  let generation = 0;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const summaries = new Map<string, ReplicacheMaterialListSummary | null>();
  const subscriptions = new Map<string, () => void>();
  const emit = () => {
    if (
      metadata?.materialLists.some((list) => !summaries.has(list.id))
    )
      return;
    value = metadata
      ? {
          job: metadata.job,
          materialLists: metadata.materialLists
            .map((list) => summaries.get(list.id))
            .filter((list): list is ReplicacheMaterialListSummary => !!list)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        }
      : null;
    listeners.forEach((notify) => notify());
  };
  const onError = (error: unknown) =>
    console.error("Offline list summary failed", error);
  return {
    get: () => value,
    subscribe(this: void, notify: () => void) {
      listeners.add(notify);
      if (!stop && jobId) {
        const active = ++generation;
        stop = rep.subscribe((tx) => readJobDetail(tx, jobId, false), {
          onError,
          onData: (next) => {
            if (active !== generation) return;
            metadata = next;
            const ids = new Set(next?.materialLists.map((list) => list.id));
            for (const [id, unsubscribe] of subscriptions)
              if (!ids.has(id)) {
                unsubscribe();
                subscriptions.delete(id);
                summaries.delete(id);
              }
            for (const list of next?.materialLists ?? [])
              if (!subscriptions.has(list.id)) {
                subscriptions.set(
                  list.id,
                  rep.subscribe(
                    async (tx) => {
                      const current = (await tx.get(
                        `materialList/${list.id}`,
                      )) as unknown as
                        | ReplicacheMaterialListSummary
                        | undefined;
                      if (current?.jobId !== jobId) return null;
                      const byList = (await tx
                        .scan({ indexName: "itemsByList", prefix: current.id })
                        .values()
                        .toArray()) as unknown as ReplicacheMaterialListItem[];
                      const byQuote = current.quoteId
                        ? ((await tx
                            .scan({
                              indexName: "itemsByQuote",
                              prefix: current.quoteId,
                            })
                            .values()
                            .toArray()) as unknown as ReplicacheMaterialListItem[])
                        : [];
                      return indexWorkspaceRecords(
                        [{ id: jobId, name: "", createdAt: "" }],
                        [current],
                        [
                          ...byList,
                          ...byQuote.filter((item) => !item.materialListId),
                        ],
                      ).details[jobId]!.materialLists[0]!;
                    },
                    {
                      onError,
                      onData: (summary) => {
                        if (
                          active !== generation ||
                          !subscriptions.has(list.id)
                        )
                          return;
                        summaries.set(list.id, summary);
                        emit();
                      },
                    },
                  ),
                );
              }
            emit();
          },
        });
      }
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          generation++;
          stop?.();
          stop = undefined;
          subscriptions.forEach((unsubscribe) => unsubscribe());
          subscriptions.clear();
          summaries.clear();
          metadata = null;
        }
      };
    },
  };
}
const summaryStores = new WeakMap<
  object,
  Map<string, ReturnType<typeof createJobSummaryStore>>
>();
const idleSummary = {
  get: () => null,
  subscribe: (_notify: () => void) => () => undefined,
};
export function useReplicacheJobDetail(jobId: string, includeItems = true) {
  const sandbox = useTutorialSandbox();
  const rep = sandbox?.material ?? tryGetMaterialListReplicache();
  const store = useMemo(() => {
    if (!rep || !jobId || !includeItems) return idleSummary;
    let stores = summaryStores.get(rep);
    if (!stores) {
      stores = new Map();
      summaryStores.set(rep, stores);
    }
    let store = stores.get(jobId);
    if (!store) {
      store = createJobSummaryStore(rep, jobId);
      stores.set(jobId, store);
    }
    return store;
  }, [rep, jobId, includeItems]);
  const detailed = useSyncExternalStore(
    store.subscribe,
    store.get,
    idleSummary.get,
  );
  const useReader = useMemo(
    () =>
      createSharedReplicacheReader(
        (tx) => readJobDetail(tx, jobId, false),
        null as WorkspaceIndex["details"][string] | null,
      ),
    [jobId],
  );
  const metadata = useReader(includeItems ? null : rep);
  return includeItems ? detailed : metadata;
}

/** Header fields do not depend on every material line in the job. */
export function useReplicacheJob(jobId: string) {
  const sandbox = useTutorialSandbox();
  const useReader = useMemo(
    () =>
      createSharedReplicacheReader(
        async (tx) =>
          ((await tx.get(`job/${jobId}`)) ??
            null) as unknown as ReplicacheJob | null,
        null as ReplicacheJob | null,
      ),
    [jobId],
  );
  return useReader(sandbox?.material ?? tryGetMaterialListReplicache());
}
