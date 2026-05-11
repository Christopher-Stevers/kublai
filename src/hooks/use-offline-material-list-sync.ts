"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import { projectMaterialListWithMutations } from "~/lib/material-list-projector";
import { idbGetMeta, idbSetMeta } from "~/lib/offline-indexed-db";
import { addSyncDebugEvent } from "~/lib/offline-sync-debug-timeline";
import {
  getOfflineMaterialList,
  remapOfflineMaterialListCacheId,
  setOfflineMaterialList,
  type OfflineMaterialListRecord,
} from "~/lib/offline-material-list";
import {
  OFFLINE_MATERIAL_LIST_SYNC_EVENT,
  getLastMaterialListLocalEditAt,
  getOfflineMutationQueue,
  getQueuedItemIdsForMaterialList,
  getQueuedMaterialListIds,
  notifyOfflineMaterialListSyncStateChanged,
  RECENT_LOCAL_EDIT_TTL_MS,
  removeOfflineMutationsFromQueue,
  remapOfflineMaterialListItemId,
  remapOfflineMutationMaterialListId,
  setActiveItemSyncStatus,
  setOfflineMutationQueue,
  setSyncingMaterialListIds,
  type OfflineMaterialListMutation,
} from "~/lib/offline-material-list-mutations";
import {
  getOfflineEntityMutationQueue,
  mergeServerJobDetailIntoOfflineCache,
  mergeServerJobsIntoOfflineCache,
  remapOfflineJobId,
  remapOfflineMaterialListId,
  setOfflineEntityMutationQueue,
  type OfflineEntityMutation,
  type OfflineJobDetail,
  type OfflineJobMaterialListSummary,
} from "~/lib/offline-jobs";

const PULL_CURSOR_META_KEY = "material-list-sync-pull-cursor";
const BACKGROUND_PULL_INTERVAL_MS = 60_000;
const SYNC_LOCK_KEY = "foremenhq.material-list-sync.lock";
const SYNC_LOCK_TTL_MS = 20_000;
const SYNC_LOCK_STEAL_QUEUED_AGE_MS = 45_000;
const SYNC_REQUEST_TIMEOUT_MS = 30_000;

type SyncResult = {
  synced: boolean;
  pushed: number;
  pulled: number;
  remaining: number;
  busy?: boolean;
};

type SyncRunReason = "startup" | "pending" | "focus" | "background";

function canReachServer() {
  return typeof window !== "undefined" && window.navigator.onLine;
}

function isUuid(value: string | null | undefined) {
  return (
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function toOfflineJobDetail(job: {
  id: string;
  name: string;
  locationId?: string | null;
  poNumber?: string | null;
  foremanUserId?: string | null;
  foremanName?: string | null;
  status?: string | null;
  createdAt?: string | Date;
  location?: OfflineJobDetail["location"];
  foreman?: OfflineJobDetail["foreman"];
}): OfflineJobDetail {
  return {
    id: job.id,
    name: job.name,
    locationId: job.locationId ?? null,
    poNumber: job.poNumber ?? null,
    foremanUserId: job.foremanUserId ?? null,
    foremanName: job.foremanName ?? null,
    status: job.status ?? "draft",
    createdAt: job.createdAt ?? new Date().toISOString(),
    location: job.location ?? null,
    foreman: job.foreman ?? null,
  };
}

function toOfflineJobMaterialListSummaries(
  job: OfflineJobDetail | undefined,
  lists:
    | Array<{
        id: string;
        name: string;
        createdAt: string | Date;
        itemCount?: number | null;
        materialTotal?: number | string | null;
      }>
    | undefined,
): OfflineJobMaterialListSummary[] {
  return (lists ?? []).map((list) => ({
    id: list.id,
    name: list.name,
    createdAt: list.createdAt,
    itemCount: Number(list.itemCount ?? 0),
    materialTotal: Number(list.materialTotal ?? 0),
    foreman: job?.foreman ?? null,
    contributors: [],
  }));
}

async function getCachedMaterialListRecord(
  materialListId: string,
): Promise<OfflineMaterialListRecord | null> {
  const envelope = await getOfflineMaterialList(materialListId);
  if (envelope?.data) return envelope.data;

  const db = getOfflineDexieDb();
  if (!db) return null;

  const header = await db.materialListHeaders.get(materialListId);
  if (!header) return null;

  const itemRows = await db.materialListItems
    .where("materialListId")
    .equals(materialListId)
    .toArray();
  const jobDetail = (await db.jobDetails.get(header.jobId))?.value as
    | { job?: OfflineJobDetail }
    | undefined;

  return {
    materialList: {
      id: header.id,
      name: header.name,
      updatedAt: header.serverUpdatedAt ?? header.updatedAt,
      syncVersion: header.syncVersion,
    },
    job: jobDetail?.job ?? {
      id: header.jobId,
      name: header.jobName,
      locationId: null,
      status: "draft",
      createdAt: header.updatedAt,
      location: null,
      foreman: null,
    },
    quote: header.quoteId ? { id: header.quoteId } : null,
    items: itemRows.map(
      (row) => row.value as OfflineMaterialListRecord["items"][number],
    ),
    materialTotal: header.materialTotal,
  };
}

function debugOfflineSync(label: string, payload: unknown) {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined")
    return;

  void fetch("/api/debug/offline-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, payload, at: new Date().toISOString() }),
  }).catch(() => undefined);
}

function deterministicClientMutationId(mutation: OfflineMaterialListMutation) {
  const itemPart =
    mutation.type === "addItem"
      ? mutation.localItemId
      : mutation.type === "renameMaterialList"
        ? mutation.name
        : mutation.itemId;
  return `${mutation.materialListId}:${mutation.type}:${mutation.queuedAt}:${itemPart}`;
}

function withClientMutationId(mutation: OfflineMaterialListMutation) {
  return {
    ...mutation,
    clientMutationId:
      mutation.clientMutationId ?? deterministicClientMutationId(mutation),
  } as OfflineMaterialListMutation & { clientMutationId: string };
}

function acquireSyncLock(owner: string, options?: { oldestQueuedAt?: number }) {
  if (typeof window === "undefined") return true;

  const now = Date.now();
  const raw = window.localStorage.getItem(SYNC_LOCK_KEY);
  if (raw) {
    try {
      const lock = JSON.parse(raw) as { owner?: string; expiresAt?: number };
      const queuedAge = options?.oldestQueuedAt
        ? now - options.oldestQueuedAt
        : 0;
      const canStealForOldQueue = queuedAge > SYNC_LOCK_STEAL_QUEUED_AGE_MS;
      if (
        lock.owner &&
        lock.expiresAt &&
        lock.expiresAt > now &&
        !canStealForOldQueue
      ) {
        return false;
      }
    } catch {
      // Replace malformed locks.
    }
  }

  window.localStorage.setItem(
    SYNC_LOCK_KEY,
    JSON.stringify({
      owner,
      expiresAt: now + SYNC_LOCK_TTL_MS,
      acquiredAt: now,
    }),
  );

  try {
    const lock = JSON.parse(window.localStorage.getItem(SYNC_LOCK_KEY) ?? "{}");
    return lock.owner === owner;
  } catch {
    return false;
  }
}

function releaseSyncLock(owner: string) {
  if (typeof window === "undefined") return;
  try {
    const lock = JSON.parse(window.localStorage.getItem(SYNC_LOCK_KEY) ?? "{}");
    if (lock.owner === owner) window.localStorage.removeItem(SYNC_LOCK_KEY);
  } catch {
    window.localStorage.removeItem(SYNC_LOCK_KEY);
  }
}

function extendSyncLock(owner: string) {
  if (typeof window === "undefined") return;
  try {
    const lock = JSON.parse(window.localStorage.getItem(SYNC_LOCK_KEY) ?? "{}");
    if (lock.owner !== owner) return;
    window.localStorage.setItem(
      SYNC_LOCK_KEY,
      JSON.stringify({
        owner,
        expiresAt: Date.now() + SYNC_LOCK_TTL_MS,
        acquiredAt: lock.acquiredAt ?? Date.now(),
      }),
    );
  } catch {
    // Ignore malformed fallback locks; acquire/release handles replacement.
  }
}

function withSyncTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(
        new Error(`${label} timed out after ${SYNC_REQUEST_TIMEOUT_MS}ms`),
      );
    }, SYNC_REQUEST_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function toServerMutation(mutation: OfflineMaterialListMutation) {
  const normalized = withClientMutationId(mutation);

  switch (normalized.type) {
    case "addItem":
      return {
        type: normalized.type,
        clientMutationId: normalized.clientMutationId,
        queuedAt: normalized.queuedAt,
        localItemId: normalized.localItemId,
        partDefinitionId: normalized.partDefinitionId,
        quantity: normalized.quantity,
        supplierPartId: normalized.supplierPartId ?? null,
        supplierId:
          normalized.supplierId ??
          normalized.supplierPartSnapshot?.supplierId ??
          null,
        unitCost: normalized.unitCost,
        oneOffDisplayName: normalized.oneOffDisplayName,
        oneOffDescription: normalized.oneOffDescription,
        oneOffMaterial: normalized.oneOffMaterial,
        oneOffSizeNominal: normalized.oneOffSizeNominal,
        oneOffSizeUnitId: normalized.oneOffSizeUnitId,
        partDefinitionSnapshot: normalized.partDefinitionSnapshot,
      };
    case "updateItemQuantity":
      return {
        type: normalized.type,
        clientMutationId: normalized.clientMutationId,
        queuedAt: normalized.queuedAt,
        itemId: normalized.itemId,
        quantity: normalized.quantity,
      };
    case "updateItemSupplierPart":
      return {
        type: normalized.type,
        clientMutationId: normalized.clientMutationId,
        queuedAt: normalized.queuedAt,
        itemId: normalized.itemId,
        supplierPartId: normalized.supplierPartId,
        supplierId:
          normalized.supplierId ??
          normalized.supplierPartSnapshot?.supplierId ??
          null,
      };
    case "removeItem":
      return {
        type: normalized.type,
        clientMutationId: normalized.clientMutationId,
        queuedAt: normalized.queuedAt,
        itemId: normalized.itemId,
      };
    case "renameMaterialList":
      return {
        type: normalized.type,
        clientMutationId: normalized.clientMutationId,
        queuedAt: normalized.queuedAt,
        name: normalized.name,
      };
  }
}

function mutationItemIds(mutation: OfflineMaterialListMutation) {
  if (mutation.type === "addItem") return [mutation.localItemId];
  if (
    mutation.type === "updateItemQuantity" ||
    mutation.type === "updateItemSupplierPart" ||
    mutation.type === "removeItem"
  ) {
    return [mutation.itemId];
  }
  return [];
}

function latestQueuedAt(queue: OfflineMaterialListMutation[]) {
  return queue
    .map((mutation) => mutation.queuedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
}

function isMaterialListNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as {
    message?: unknown;
    data?: { code?: unknown };
    shape?: { data?: { code?: unknown } };
  };

  return (
    maybeError.data?.code === "NOT_FOUND" ||
    maybeError.shape?.data?.code === "NOT_FOUND" ||
    (typeof maybeError.message === "string" &&
      maybeError.message.includes("Material list not found"))
  );
}

function isPermanentSyncFailure(message: string) {
  return (
    message.includes("No server item mapping for local item id") ||
    message.includes("Quote item not found") ||
    message.includes("Part definition not found") ||
    message.includes("Add item requires")
  );
}

export function useOfflineMaterialListSyncRunner() {
  const utils = api.useUtils();
  const syncEntityMutations = api.job.syncEntityMutations.useMutation();
  const createJob = api.job.createJob.useMutation();
  const createMaterialList = api.materialList.createMaterialList.useMutation();
  const syncMutations =
    api.materialList.syncMaterialListMutations.useMutation();
  const runningRef = useRef(false);

  return useCallback(
    async (
      reason: SyncRunReason = "pending",
      forcedMaterialListIds: string[] = [],
    ): Promise<SyncResult> => {
      const runStartedAt = Date.now();
      const initialQueue = await getOfflineMutationQueue();
      const entityQueueCount = getOfflineEntityMutationQueue().length;
      const quietIdlePull =
        reason === "background" &&
        initialQueue.length === 0 &&
        entityQueueCount === 0;

      if (!canReachServer()) {
        if (initialQueue.length > 0 || entityQueueCount > 0) {
          debugOfflineSync("sync-skip-offline", {
            queueLength: initialQueue.length,
            entityQueueCount,
          });
          addSyncDebugEvent({
            phase: "blocked",
            status: "warning",
            message: "Sync guy is asleep: phone says it is offline",
            queueLength: initialQueue.length,
            details: { entityQueueCount },
          });
        }
        return {
          synced: false,
          pushed: 0,
          pulled: 0,
          remaining: initialQueue.length + entityQueueCount,
        };
      }

      if (runningRef.current) {
        return {
          synced: false,
          pushed: 0,
          pulled: 0,
          remaining: initialQueue.length + entityQueueCount,
        };
      }

      const initialRemaining = initialQueue.length + entityQueueCount;
      const initialOldestQueuedAtRaw = latestQueuedAt(initialQueue);
      const initialOldestQueuedAt = initialOldestQueuedAtRaw
        ? new Date(initialOldestQueuedAtRaw).getTime()
        : undefined;
      const busyResult = {
        synced: false,
        pushed: 0,
        pulled: 0,
        remaining: initialRemaining,
        busy: true,
      } satisfies SyncResult;

      const runWithLocalFallbackLock = async (
        forcedMaterialListIds: string[] = [],
      ): Promise<SyncResult> => {
        const lockOwner = crypto.randomUUID();
        if (
          !acquireSyncLock(lockOwner, { oldestQueuedAt: initialOldestQueuedAt })
        ) {
          addSyncDebugEvent({
            phase: "blocked",
            status: "info",
            message: "Sync guy found another tab already working",
            queueLength: initialQueue.length,
            details: {
              entityQueueCount,
              remaining: initialRemaining,
              oldestQueuedAt: initialOldestQueuedAt,
            },
          });
          return busyResult;
        }

        if (!quietIdlePull) {
          addSyncDebugEvent({
            phase: "lock",
            status: "success",
            message: "Only one sync guy allowed: lock acquired",
            queueLength: initialQueue.length,
            details: { entityQueueCount, reason },
          });
        }

        const lockHeartbeat = window.setInterval(
          () => extendSyncLock(lockOwner),
          Math.floor(SYNC_LOCK_TTL_MS / 2),
        );

        runningRef.current = true;
        let pushed = 0;
        let pulled = 0;
        const normalizedInitialQueue = initialQueue.map(withClientMutationId);

        const pullParentEntitiesIntoDexie = async () => {
          if ((await getOfflineMutationQueue()).length > 0) return 0;
          if (getOfflineEntityMutationQueue().length > 0) return 0;

          const serverJobs = await withSyncTimeout(
            utils.job.listJobs.fetch(),
            "listJobs",
          );
          mergeServerJobsIntoOfflineCache(serverJobs);

          const detailIds = serverJobs.map((job) => job.id).filter(isUuid);
          let detailPulls = 0;
          for (const jobId of detailIds) {
            try {
              const serverJobResult = await withSyncTimeout(
                utils.job.getJob.fetch({ jobId }),
                "getJob",
              );
              if (!serverJobResult) continue;
              const { materialLists, ...job } = serverJobResult;
              const offlineJob = toOfflineJobDetail(job);
              mergeServerJobDetailIntoOfflineCache(jobId, {
                job: offlineJob,
                materialLists: toOfflineJobMaterialListSummaries(
                  offlineJob,
                  materialLists,
                ),
              });

              for (const list of materialLists ?? []) {
                if (!isUuid(list.id)) continue;
                const latestQueue = await getOfflineMutationQueue();
                const queuedForList = latestQueue.some(
                  (mutation) => mutation.materialListId === list.id,
                );
                const existing = await getOfflineMaterialList(list.id);
                if (queuedForList || existing?.pendingSync || existing?.data)
                  continue;

                try {
                  const serverList = (await withSyncTimeout(
                    utils.materialList.getMaterialList.fetch({
                      materialListId: list.id,
                    }),
                    `getMaterialList(${list.id})`,
                  )) as OfflineMaterialListRecord;
                  await setOfflineMaterialList(list.id, serverList, {
                    pendingSync: false,
                  });
                } catch (error) {
                  if (isMaterialListNotFoundError(error)) {
                    debugOfflineSync("skip-missing-parent-material-list", {
                      materialListId: list.id,
                      jobId,
                    });
                    continue;
                  }
                  throw error;
                }
              }
              detailPulls += 1;
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              if (
                !message.includes("NOT_FOUND") &&
                !message.includes("Job not found")
              ) {
                throw error;
              }
            }
          }

          addSyncDebugEvent({
            phase: "pull",
            status: "success",
            message: `Server refreshed ${serverJobs.length} job(s) into Dexie`,
            queueLength: 0,
            details: { jobCount: serverJobs.length, detailPulls },
          });
          return serverJobs.length + detailPulls;
        };

        if (initialQueue.some((mutation) => !mutation.clientMutationId)) {
          await setOfflineMutationQueue(normalizedInitialQueue);
        }
        const touchedMaterialListIds = new Set<string>([
          ...getQueuedMaterialListIds(normalizedInitialQueue),
          ...forcedMaterialListIds.filter(isUuid),
        ]);
        const appliedDeletedItemIdsByList = new Map<string, Set<string>>();

        try {
          if (normalizedInitialQueue.length > 0 || entityQueueCount > 0) {
            const materialListIds = getQueuedMaterialListIds(
              normalizedInitialQueue,
            );
            debugOfflineSync("sync-start", {
              queueLength: normalizedInitialQueue.length,
              entityQueueCount,
              materialListIds,
            });
            addSyncDebugEvent({
              phase: "wake",
              status: "info",
              message: `Sync guy woke up and found ${normalizedInitialQueue.length} sticky note(s)`,
              materialListId: materialListIds[0],
              mutationIds: normalizedInitialQueue
                .map((mutation) => mutation.clientMutationId)
                .filter((id): id is string => !!id),
              queueLength: normalizedInitialQueue.length,
              details: { entityQueueCount, materialListIds },
            });
          }
          for (let pass = 0; pass < 5; pass += 1) {
            const entityQueue = getOfflineEntityMutationQueue();
            if (entityQueue.length === 0) break;

            addSyncDebugEvent({
              phase: "parent-sync",
              status: "info",
              message: `Checking parent sticky notes: ${entityQueue.length}`,
              queueLength: normalizedInitialQueue.length,
              details: { pass, entityQueue },
            });

            const queueByMutationId = new Map(
              entityQueue
                .filter((mutation) => mutation.clientMutationId)
                .map((mutation) => [mutation.clientMutationId!, mutation]),
            );
            const syncableEntityQueue = entityQueue.filter((mutation) => {
              if (mutation.type === "createMaterialList")
                return isUuid(mutation.localJobId);
              if (mutation.type === "updateJob") return isUuid(mutation.jobId);
              return true;
            });

            const locallyDrainedIds = new Set(
              entityQueue
                .filter(
                  (mutation) =>
                    (mutation.type === "deleteJob" &&
                      !isUuid(mutation.jobId)) ||
                    (mutation.type === "deleteMaterialList" &&
                      !isUuid(mutation.materialListId)),
                )
                .map((mutation) => mutation.clientMutationId)
                .filter((id): id is string => !!id),
            );

            const syncResult = syncableEntityQueue.length
              ? await syncEntityMutations.mutateAsync({
                  mutations: syncableEntityQueue as any,
                })
              : { applied: [], failed: [] };

            addSyncDebugEvent({
              phase: "parent-sync",
              status: syncResult.failed.length > 0 ? "warning" : "success",
              message:
                syncResult.failed.length > 0
                  ? `Parent sync delivered ${syncResult.applied.length}, dead-lettered ${syncResult.failed.length}`
                  : `Parent sync delivered ${syncResult.applied.length}`,
              queueLength: entityQueue.length,
              details: syncResult,
            });

            const appliedEntityIds = new Set<string>(locallyDrainedIds);
            for (const appliedMutation of syncResult.applied) {
              appliedEntityIds.add(appliedMutation.clientMutationId);
              const original = queueByMutationId.get(
                appliedMutation.clientMutationId,
              );
              if (!original || !appliedMutation.serverEntityId) continue;

              if (original.type === "createJob") {
                remapOfflineJobId(
                  original.localJobId,
                  toOfflineJobDetail({
                    id: appliedMutation.serverEntityId,
                    name: original.name,
                    locationId: isUuid(original.locationId)
                      ? original.locationId
                      : null,
                    foremanUserId: null,
                    status: "draft",
                    createdAt: original.queuedAt,
                  }),
                );
              }

              if (original.type === "createMaterialList") {
                remapOfflineMaterialListId(
                  original.localJobId,
                  original.localMaterialListId,
                  appliedMutation.serverEntityId,
                );
                await remapOfflineMaterialListCacheId(
                  original.localMaterialListId,
                  appliedMutation.serverEntityId,
                );
                await remapOfflineMutationMaterialListId(
                  original.localMaterialListId,
                  appliedMutation.serverEntityId,
                );
                touchedMaterialListIds.add(appliedMutation.serverEntityId);
              }

              if (original.type === "deleteMaterialList") {
                touchedMaterialListIds.delete(original.materialListId);
              }
            }

            for (const failedMutation of syncResult.failed) {
              // Parent mutations must not jam the shared sync loop forever. The
              // server endpoint returns per-row failures after trying the row;
              // once a parent row has reached that point, dead-letter it and
              // let later independent work continue like material-list item
              // sync does for poison rows.
              appliedEntityIds.add(failedMutation.clientMutationId);
            }

            const remainingEntityQueue = entityQueue.filter(
              (mutation) =>
                !mutation.clientMutationId ||
                !appliedEntityIds.has(mutation.clientMutationId),
            );

            setOfflineEntityMutationQueue(remainingEntityQueue);
            const progressed = remainingEntityQueue.length < entityQueue.length;
            if (!progressed) break;
          }

          let queue = (await getOfflineMutationQueue()).map(
            withClientMutationId,
          );

          let localOnlyMaterialListIds = getQueuedMaterialListIds(queue).filter(
            (materialListId) => !isUuid(materialListId),
          );
          if (localOnlyMaterialListIds.length > 0) {
            debugOfflineSync("local-only-material-lists-before-backfill", {
              localOnlyMaterialListIds,
              queue: queue.map((mutation) => ({
                materialListId: mutation.materialListId,
                type: mutation.type,
                clientMutationId: mutation.clientMutationId,
                queuedAt: mutation.queuedAt,
              })),
              entityQueue: getOfflineEntityMutationQueue(),
            });
          }
          for (const localMaterialListId of localOnlyMaterialListIds) {
            const cachedData =
              await getCachedMaterialListRecord(localMaterialListId);
            if (!cachedData) {
              const db = getOfflineDexieDb();
              const diagnostics = db
                ? {
                    materialListHeader:
                      await db.materialListHeaders.get(localMaterialListId),
                    materialListRow:
                      await db.materialLists.get(localMaterialListId),
                    materialListItemCount: await db.materialListItems
                      .where("materialListId")
                      .equals(localMaterialListId)
                      .count(),
                    jobDetailIds: (await db.jobDetails.toArray()).map(
                      (row) => row.id,
                    ),
                  }
                : { dexie: "unavailable" };
              debugOfflineSync("parent-backfill-missing-cache", {
                localMaterialListId,
                diagnostics,
              });
              console.warn(
                "ForemenHQ material-list parent backfill missing cache",
                {
                  localMaterialListId,
                  diagnostics,
                },
              );
              continue;
            }

            try {
              let serverJobId = cachedData.job.id;
              if (!isUuid(serverJobId)) {
                const serverJob = await createJob.mutateAsync({
                  name: cachedData.job.name || "New Job",
                  locationId: isUuid(cachedData.job.locationId)
                    ? String(cachedData.job.locationId)
                    : undefined,
                });
                remapOfflineJobId(serverJobId, toOfflineJobDetail(serverJob));
                serverJobId = serverJob.id;
              }

              const created = await createMaterialList.mutateAsync({
                jobId: serverJobId,
                name: cachedData.materialList.name,
              });
              remapOfflineMaterialListId(
                serverJobId,
                localMaterialListId,
                created.materialListId,
              );
              await remapOfflineMaterialListCacheId(
                localMaterialListId,
                created.materialListId,
              );
              await remapOfflineMutationMaterialListId(
                localMaterialListId,
                created.materialListId,
              );
              touchedMaterialListIds.delete(localMaterialListId);
              touchedMaterialListIds.add(created.materialListId);
              debugOfflineSync("parent-backfill-created-material-list", {
                localMaterialListId,
                serverMaterialListId: created.materialListId,
                serverJobId,
              });
            } catch (error) {
              console.warn("ForemenHQ material-list parent backfill failed", {
                localMaterialListId,
                jobId: cachedData.job.id,
                error,
              });
            }
          }

          queue = (await getOfflineMutationQueue()).map(withClientMutationId);
          localOnlyMaterialListIds = getQueuedMaterialListIds(queue).filter(
            (materialListId) => !isUuid(materialListId),
          );
          if (localOnlyMaterialListIds.length > 0) {
            debugOfflineSync("local-only-material-lists-after-backfill", {
              localOnlyMaterialListIds,
              queue: queue.map((mutation) => ({
                materialListId: mutation.materialListId,
                type: mutation.type,
                clientMutationId: mutation.clientMutationId,
                queuedAt: mutation.queuedAt,
              })),
              entityQueue: getOfflineEntityMutationQueue(),
            });
          }

          if (queue.length > 0) {
            const queuedIds = getQueuedMaterialListIds(queue);
            await setSyncingMaterialListIds(queuedIds);

            for (const materialListId of queuedIds) {
              const mutationsForList = queue.filter(
                (mutation) => mutation.materialListId === materialListId,
              );
              if (mutationsForList.length === 0) continue;
              if (!isUuid(materialListId)) {
                debugOfflineSync("skip-local-only-item-sync", {
                  materialListId,
                  mutationCount: mutationsForList.length,
                });
                continue;
              }

              addSyncDebugEvent({
                phase: "push",
                status: "info",
                message: `Preparing ${mutationsForList.length} sticky note(s) for delivery`,
                materialListId,
                mutationIds: mutationsForList
                  .map((mutation) => mutation.clientMutationId)
                  .filter((id): id is string => !!id),
                queueLength: queue.length,
                details: {
                  types: mutationsForList.map((mutation) => mutation.type),
                },
              });

              for (const mutation of mutationsForList) {
                for (const itemId of mutationItemIds(mutation)) {
                  await setActiveItemSyncStatus(
                    materialListId,
                    itemId,
                    "syncing",
                  );
                }
              }

              let result: Awaited<ReturnType<typeof syncMutations.mutateAsync>>;
              try {
                addSyncDebugEvent({
                  phase: "push",
                  status: "info",
                  message: `Mailman delivering ${mutationsForList.length} sticky note(s) to server`,
                  materialListId,
                  mutationIds: mutationsForList
                    .map((mutation) => mutation.clientMutationId)
                    .filter((id): id is string => !!id),
                  queueLength: queue.length,
                  details: {
                    types: mutationsForList.map((mutation) => mutation.type),
                  },
                });
                result = await withSyncTimeout(
                  syncMutations.mutateAsync({
                    materialListId,
                    mutations: mutationsForList.map(toServerMutation),
                  }),
                  "material list mutation push",
                );
              } catch (error) {
                if (!isMaterialListNotFoundError(error)) {
                  throw error;
                }

                // Old local queues can contain mutations for server material lists that
                // were deleted while offline. Do not let that stale list abort syncing
                // newer lists behind it in the queue.
                debugOfflineSync(
                  "drop-missing-server-material-list-mutations",
                  {
                    materialListId,
                    mutationCount: mutationsForList.length,
                    mutationTypes: mutationsForList.map(
                      (mutation) => mutation.type,
                    ),
                    queuedAt: mutationsForList.map(
                      (mutation) => mutation.queuedAt,
                    ),
                  },
                );
                addSyncDebugEvent({
                  phase: "server-result",
                  status: "warning",
                  message:
                    "Server says this material list is gone; dropping stale sticky notes",
                  materialListId,
                  mutationIds: mutationsForList
                    .map((mutation) => mutation.clientMutationId)
                    .filter((id): id is string => !!id),
                  queueLength: queue.length,
                });
                console.warn(
                  "ForemenHQ dropping stale material-list mutations",
                  {
                    materialListId,
                    mutationCount: mutationsForList.length,
                    error,
                  },
                );

                for (const mutation of mutationsForList) {
                  for (const itemId of mutationItemIds(mutation)) {
                    await setActiveItemSyncStatus(
                      materialListId,
                      itemId,
                      "synced",
                    );
                  }
                }

                queue = queue.filter(
                  (mutation) => mutation.materialListId !== materialListId,
                );
                touchedMaterialListIds.delete(materialListId);
                await setOfflineMutationQueue(queue);
                continue;
              }

              const appliedIds = new Set(
                result.applied.map((item) => item.clientMutationId),
              );
              const failedIds = new Set(
                result.failed.map((item) => item.clientMutationId),
              );
              const permanentFailedIds = new Set(
                result.failed
                  .filter((item) => isPermanentSyncFailure(item.message))
                  .map((item) => item.clientMutationId),
              );
              const temporaryFailureCount =
                result.failed.length - permanentFailedIds.size;
              addSyncDebugEvent({
                phase: "server-result",
                status: temporaryFailureCount > 0 ? "warning" : "success",
                message:
                  permanentFailedIds.size > 0
                    ? `Server stamped ${result.applied.length} done, ${permanentFailedIds.size} stale sticky note(s) skipped`
                    : `Server stamped ${result.applied.length} done, ${temporaryFailureCount} failed`,
                materialListId,
                mutationIds: mutationsForList
                  .map((mutation) => mutation.clientMutationId)
                  .filter((id): id is string => !!id),
                queueLength: queue.length,
                details: result,
              });

              if (permanentFailedIds.size > 0) {
                debugOfflineSync("dead-letter-permanent-sync-mutations", {
                  materialListId,
                  mutations: result.failed.filter((item) =>
                    permanentFailedIds.has(item.clientMutationId),
                  ),
                });
              }

              const beforeDrainCount = queue.length;
              const removableIds = new Set<string>();
              for (const mutation of queue) {
                if (mutation.materialListId !== materialListId) continue;
                if (permanentFailedIds.has(mutation.clientMutationId)) {
                  removableIds.add(mutation.clientMutationId);
                  continue;
                }
                if (failedIds.has(mutation.clientMutationId)) continue;
                if (appliedIds.has(mutation.clientMutationId)) {
                  removableIds.add(mutation.clientMutationId);
                }
              }

              addSyncDebugEvent({
                phase: "queue-drain",
                status: removableIds.size > 0 ? "info" : "warning",
                message: `Phone is about to throw away ${removableIds.size} finished sticky note(s)`,
                materialListId,
                queueLength: beforeDrainCount,
                details: {
                  removableIds: Array.from(removableIds),
                  applied: result.applied,
                  failed: result.failed,
                },
              });

              await removeOfflineMutationsFromQueue(removableIds);
              queue = (await getOfflineMutationQueue()).map(
                withClientMutationId,
              );
              const stillPresentRemovableCount = queue.filter((mutation) =>
                removableIds.has(mutation.clientMutationId),
              ).length;
              const actuallyRemovedCount =
                removableIds.size - stillPresentRemovableCount;
              const concurrentlyAddedCount = Math.max(
                0,
                queue.length - (beforeDrainCount - actuallyRemovedCount),
              );
              addSyncDebugEvent({
                phase: "queue-drain",
                status: actuallyRemovedCount > 0 ? "success" : "warning",
                message:
                  concurrentlyAddedCount > 0
                    ? `Phone threw away ${actuallyRemovedCount} finished sticky note(s); ${queue.length} left (${concurrentlyAddedCount} new during sync)`
                    : `Phone threw away ${actuallyRemovedCount} finished sticky note(s); ${queue.length} left`,
                materialListId,
                queueLength: queue.length,
                details: {
                  beforeDrainCount,
                  actuallyRemovedCount,
                  concurrentlyAddedCount,
                  removableIds: Array.from(removableIds),
                  applied: result.applied,
                  failed: result.failed,
                },
              });

              if (appliedIds.size > 0) {
                pushed += appliedIds.size;
                for (const applied of result.applied) {
                  if (applied.type === "removeItem" && applied.serverItemId) {
                    const deletedIds =
                      appliedDeletedItemIdsByList.get(materialListId) ??
                      new Set<string>();
                    deletedIds.add(applied.serverItemId);
                    appliedDeletedItemIdsByList.set(materialListId, deletedIds);
                  }
                  if (applied.localItemId && applied.serverItemId) {
                    await remapOfflineMaterialListItemId(
                      materialListId,
                      applied.localItemId,
                      applied.serverItemId,
                    );
                  }
                }
                for (const mutation of mutationsForList) {
                  if (!appliedIds.has(mutation.clientMutationId)) continue;
                  for (const itemId of mutationItemIds(mutation)) {
                    await setActiveItemSyncStatus(
                      materialListId,
                      itemId,
                      "synced",
                    );
                  }
                }
              }
            }
          }

          queue = (await getOfflineMutationQueue()).map(withClientMutationId);
          const entityQueueAfterPush = getOfflineEntityMutationQueue().length;
          const remainingAfterPush = queue.length + entityQueueAfterPush;
          if (remainingAfterPush > 0) {
            addSyncDebugEvent({
              phase: "done",
              status: "warning",
              message: `${remainingAfterPush} sticky note(s) still left; skipping fresh-copy pull until they deliver`,
              queueLength: queue.length,
              details: {
                pushed,
                pulled,
                entityQueueCount: entityQueueAfterPush,
                reason,
              },
            });
            await setSyncingMaterialListIds([]);
            notifyOfflineMaterialListSyncStateChanged();
            return {
              synced: false,
              pushed,
              pulled,
              remaining: remainingAfterPush,
            };
          }

          if (pushed > 0) {
            for (const materialListId of touchedMaterialListIds) {
              const existing = await getOfflineMaterialList(materialListId);
              if (!existing?.data) continue;
              await setOfflineMaterialList(materialListId, existing.data, {
                pendingSync: false,
                pendingDeletedItemIds: [],
              });
            }
            pulled += await pullParentEntitiesIntoDexie();
            await setSyncingMaterialListIds([]);
            notifyOfflineMaterialListSyncStateChanged();
            addSyncDebugEvent({
              phase: "done",
              status: "success",
              message:
                "All sticky notes delivered. Local notebook kept as truth.",
              queueLength: queue.length,
              details: {
                pushed,
                pulled,
                entityQueueCount: entityQueueAfterPush,
                reason,
              },
            });
            return {
              synced: true,
              pushed,
              pulled,
              remaining: 0,
            };
          }

          if (touchedMaterialListIds.size === 0) {
            pulled += await pullParentEntitiesIntoDexie();
            await setSyncingMaterialListIds([]);
            notifyOfflineMaterialListSyncStateChanged();
            return {
              synced: true,
              pushed,
              pulled,
              remaining: 0,
            };
          }

          const cursor = await idbGetMeta<string | null>(
            PULL_CURSOR_META_KEY,
            null,
          );
          if (!quietIdlePull) {
            addSyncDebugEvent({
              phase: "pull",
              status: "info",
              message: "Phone asks server for a fresh copy",
              queueLength: queue.length,
              details: {
                cursor,
                touchedMaterialListIds: Array.from(touchedMaterialListIds),
                reason,
              },
            });
          }
          const pull = await withSyncTimeout(
            utils.materialList.pullMaterialListSyncChanges.fetch({
              since: cursor ?? undefined,
              materialListIds: touchedMaterialListIds.size
                ? Array.from(touchedMaterialListIds)
                : undefined,
            }),
            "pullMaterialListSyncChanges",
          );
          if (
            !quietIdlePull ||
            pull.changedMaterialListIds.length > 0 ||
            pull.tombstones.length > 0
          ) {
            addSyncDebugEvent({
              phase: "pull",
              status: "success",
              message: `Server sent ${pull.changedMaterialListIds.length} changed list(s) and ${pull.tombstones.length} delete note(s)`,
              queueLength: queue.length,
              details: { ...pull, reason },
            });
          }

          for (const tombstone of pull.tombstones) {
            touchedMaterialListIds.add(tombstone.materialListId);
          }
          for (const materialListId of pull.changedMaterialListIds) {
            touchedMaterialListIds.add(materialListId);
          }

          for (const materialListId of touchedMaterialListIds) {
            let serverData: OfflineMaterialListRecord;
            try {
              serverData = (await withSyncTimeout(
                utils.materialList.getMaterialList.fetch({
                  materialListId,
                }),
                `getMaterialList(${materialListId})`,
              )) as OfflineMaterialListRecord;
            } catch (error) {
              if (isMaterialListNotFoundError(error)) {
                debugOfflineSync("skip-missing-material-list-pull", {
                  materialListId,
                });
                continue;
              }
              throw error;
            }
            const tombstonedItemIds = new Set([
              ...Array.from(
                appliedDeletedItemIdsByList.get(materialListId) ?? [],
              ),
              ...pull.tombstones
                .filter(
                  (tombstone) =>
                    tombstone.materialListId === materialListId &&
                    tombstone.entityType === "quoteItem",
                )
                .map((tombstone) => tombstone.entityId),
            ]);
            if (tombstonedItemIds.size > 0) {
              serverData = {
                ...serverData,
                items: serverData.items.filter(
                  (item) => !tombstonedItemIds.has(String(item.id)),
                ),
                materialTotal: serverData.items
                  .filter((item) => !tombstonedItemIds.has(String(item.id)))
                  .reduce((sum, item) => {
                    const price = item.extendedPrice
                      ? parseFloat(item.extendedPrice)
                      : 0;
                    return sum + (Number.isFinite(price) ? price : 0);
                  }, 0),
              };
            }
            const latestQueue = await getOfflineMutationQueue();
            const queuedForList = latestQueue.filter(
              (mutation) => mutation.materialListId === materialListId,
            );
            const existing = await getOfflineMaterialList(materialListId);
            const existingUpdatedAt = existing?.updatedAt
              ? new Date(existing.updatedAt).getTime()
              : 0;
            const localChangedDuringThisRun = existingUpdatedAt > runStartedAt;
            const queuedItemIds = getQueuedItemIdsForMaterialList(
              materialListId,
              latestQueue,
            );
            const hasNewQueuedWorkForList = queuedForList.some(
              (mutation) =>
                new Date(mutation.queuedAt).getTime() >= runStartedAt,
            );

            // If this run successfully pushed all known work, the fresh server
            // snapshot is authoritative and must clear pendingSync. Only preserve
            // local data over the server snapshot when genuinely new local work was
            // queued while this run was already in flight.
            const localEditedRecently =
              Date.now() - getLastMaterialListLocalEditAt(materialListId) <
              RECENT_LOCAL_EDIT_TTL_MS;
            const shouldPreserveLocalInFlightChange =
              queuedForList.length > 0 ||
              localEditedRecently ||
              (hasNewQueuedWorkForList && localChangedDuringThisRun);

            const hydratedData =
              queuedForList.length > 0
                ? projectMaterialListWithMutations(serverData, queuedForList)
                : shouldPreserveLocalInFlightChange && existing?.data
                  ? existing.data
                  : serverData;

            await setOfflineMaterialList(materialListId, hydratedData, {
              pendingSync: queuedForList.length > 0,
              pendingDeletedItemIds: existing?.pendingDeletedItemIds?.filter(
                (itemId) => queuedItemIds.has(itemId),
              ),
            });
            pulled += 1;
            addSyncDebugEvent({
              phase: "hydrate",
              status: "success",
              message: `Phone notebook updated from server (${queuedForList.length} sticky note(s) still pending for this list)`,
              materialListId,
              queueLength: latestQueue.length,
              details: {
                itemCount: serverData.items.length,
                pendingForList: queuedForList.length,
                localChangedDuringThisRun,
                hasNewQueuedWorkForList,
                localEditedRecently,
                tombstonedItemIds: Array.from(tombstonedItemIds),
              },
            });
          }

          pulled += await pullParentEntitiesIntoDexie();
          await idbSetMeta(PULL_CURSOR_META_KEY, pull.cursor);
          await setSyncingMaterialListIds([]);
          notifyOfflineMaterialListSyncStateChanged();

          const finalQueue = await getOfflineMutationQueue();
          const remaining =
            finalQueue.length + getOfflineEntityMutationQueue().length;
          if (!quietIdlePull || remaining > 0 || pushed > 0 || pulled > 0) {
            addSyncDebugEvent({
              phase: "done",
              status: remaining === 0 ? "success" : "warning",
              message:
                remaining === 0
                  ? "All sticky notes delivered. Synced."
                  : `${remaining} sticky note(s) still left after sync`,
              queueLength: finalQueue.length,
              details: {
                pushed,
                pulled,
                entityQueueCount: getOfflineEntityMutationQueue().length,
                reason,
              },
            });
          }
          return {
            synced: finalQueue.length === 0,
            pushed,
            pulled,
            remaining,
          };
        } catch (error) {
          await setSyncingMaterialListIds([]);
          const queue = await getOfflineMutationQueue();
          const remaining =
            queue.length + getOfflineEntityMutationQueue().length;
          const queuedAt = latestQueuedAt(queue);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn("ForemenHQ material-list sync failed", {
            queuedAt,
            error,
          });

          if (remaining > 0 || pushed > 0) {
            addSyncDebugEvent({
              phase: "blocked",
              status: "error",
              message: "Sync crashed before finishing",
              queueLength: queue.length,
              details: {
                queuedAt,
                error: errorMessage,
                pushed,
                pulled,
                reason,
              },
            });
          } else if (!quietIdlePull) {
            addSyncDebugEvent({
              phase: "blocked",
              status: "warning",
              message:
                "Fresh-copy check failed, but no sticky notes are waiting",
              queueLength: queue.length,
              details: {
                queuedAt,
                error: errorMessage,
                pushed,
                pulled,
                reason,
              },
            });
          }

          return {
            synced: false,
            pushed,
            pulled,
            remaining,
          };
        } finally {
          runningRef.current = false;
          window.clearInterval(lockHeartbeat);
          releaseSyncLock(lockOwner);
        }
      };

      // Web Locks can be held forever by an old/hung tab and have no TTL we can
      // clear from a fresh bundle. Use our heartbeat-backed local lock instead;
      // it preserves one-sync-at-a-time behavior but self-heals after expiry.
      return runWithLocalFallbackLock(forcedMaterialListIds);
    },
    [createJob, createMaterialList, syncEntityMutations, syncMutations, utils],
  );
}

export function useOfflineMaterialListSync() {
  const runSync = useOfflineMaterialListSyncRunner();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = (
      delay = 0,
      reason: SyncRunReason = "pending",
      forcedMaterialListIds: string[] = [],
    ) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (cancelled || !canReachServer()) return;
        void (async () => {
          const result = await runSync(reason, forcedMaterialListIds);
          if (cancelled || !canReachServer()) return;
          if (result.remaining > 0) {
            addSyncDebugEvent({
              phase: "wake",
              status: "info",
              message: result.busy
                ? `Sync is busy; retrying ${result.remaining} sticky note(s)`
                : `Still ${result.remaining} sticky note(s) left; scheduling another sync pass`,
              queueLength: result.remaining,
              details: result,
            });
            schedule(
              result.busy
                ? 2_000
                : result.pushed === 0 && result.pulled === 0
                  ? 5_000
                  : 750,
              "pending",
            );
          }
        })();
      }, delay);
    };

    const scheduleIfPendingWork = (delay = 0) => {
      void (async () => {
        const [queue, entityQueue] = await Promise.all([
          getOfflineMutationQueue(),
          Promise.resolve(getOfflineEntityMutationQueue()),
        ]);
        if (cancelled || !canReachServer()) return;
        if (queue.length === 0 && entityQueue.length === 0) return;
        schedule(delay, "pending");
      })();
    };

    const onOnline = () => scheduleIfPendingWork(0);
    const onFocus = () => schedule(250, "focus");
    const onSyncStateChanged = (event: Event) => {
      const serverChanged =
        event instanceof CustomEvent &&
        (event.detail as { serverChanged?: boolean } | undefined)
          ?.serverChanged;
      if (serverChanged) {
        const materialListId =
          event instanceof CustomEvent
            ? (event.detail as { materialListId?: string } | undefined)
                ?.materialListId
            : undefined;
        schedule(0, "background", materialListId ? [materialListId] : []);
        return;
      }
      scheduleIfPendingWork(500);
    };

    schedule(750, "startup");
    const interval = setInterval(
      () => schedule(0, "background"),
      BACKGROUND_PULL_INTERVAL_MS,
    );
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      OFFLINE_MATERIAL_LIST_SYNC_EVENT,
      onSyncStateChanged,
    );

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        OFFLINE_MATERIAL_LIST_SYNC_EVENT,
        onSyncStateChanged,
      );
    };
  }, [runSync]);
}
