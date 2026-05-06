"use client";

import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "~/trpc/react";
import { setOfflineIdMappings } from "~/lib/offline-id-map";
import {
  getOfflineMutationQueue,
  notifyOfflineMaterialListSyncStateChanged,
  setOfflineMutationQueue,
  setSyncingMaterialListIds,
  type OfflineMaterialListMutation,
} from "~/lib/offline-material-list-mutations";
import {
  clearOfflineMaterialList,
  getOfflineMaterialList,
  getOfflineMaterialListIds,
  setOfflineMaterialList,
} from "~/lib/offline-material-list";
import {
  getOfflineEntityMutationQueue,
  getOfflineJobDetail,
  getOfflineJobsList,
  removeOfflineJobDetail,
  setOfflineEntityMutationQueue,
  setOfflineJobDetail,
  setOfflineJobsList,
  type OfflineEntityMutation,
} from "~/lib/offline-jobs";

let materialListSyncInFlight = false;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const SYNC_LOCK_KEY = "foremanhq.offline.material-list-sync-lock";

function readPersistentSyncLock() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SYNC_LOCK_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as { token: string; expiresAt: number };
  } catch {
    window.localStorage.removeItem(SYNC_LOCK_KEY);
    return null;
  }
}

async function waitForPersistentSyncLock() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    const lock = readPersistentSyncLock();
    if (!lock || lock.expiresAt < Date.now()) {
      if (lock?.expiresAt && lock.expiresAt < Date.now()) {
        window.localStorage.removeItem(SYNC_LOCK_KEY);
      }
      return;
    }
    await wait(250);
  }
}

function acquirePersistentSyncLock() {
  if (typeof window === "undefined") return null;
  const existing = readPersistentSyncLock();
  if (existing && existing.expiresAt > Date.now()) return null;

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(
    SYNC_LOCK_KEY,
    JSON.stringify({ token, expiresAt: Date.now() + 60_000 }),
  );
  return readPersistentSyncLock()?.token === token ? token : null;
}

function releasePersistentSyncLock(token: string | null) {
  if (!token || typeof window === "undefined") return;
  const lock = readPersistentSyncLock();
  if (lock?.token === token) {
    window.localStorage.removeItem(SYNC_LOCK_KEY);
  }
}

async function clearQueue() {
  await setOfflineMutationQueue([]);
  notifyOfflineMaterialListSyncStateChanged();
}

async function setQueue(queue: OfflineMaterialListMutation[]) {
  await setOfflineMutationQueue(queue);
  notifyOfflineMaterialListSyncStateChanged();
}

function isLocalOnlyItemId(itemId: string) {
  return itemId.startsWith("temp-") || itemId.startsWith("offline-");
}

function isNotFoundError(error: unknown) {
  if (!(error instanceof Error)) return false;

  const candidate = error as Error & {
    data?: { code?: string };
    shape?: { data?: { code?: string } };
  };

  return (
    candidate.data?.code === "NOT_FOUND" ||
    candidate.shape?.data?.code === "NOT_FOUND" ||
    /not found/i.test(candidate.message)
  );
}

async function serverMaterialListStillHasItem(
  getMaterialList: ReturnType<typeof api.useUtils>["client"]["materialList"]["getMaterialList"],
  materialListId: string,
  itemId: string,
) {
  const refreshed = await getMaterialList.query({ materialListId });
  if (!refreshed) return true;
  return refreshed.items.some((item) => String(item.id) === itemId);
}

export function useOfflineMaterialListSyncRunner() {
  const queryClient = useQueryClient();
  const utils = api.useUtils();

  return useCallback(async () => {
    if (materialListSyncInFlight) {
      const startedAt = Date.now();
      while (materialListSyncInFlight && Date.now() - startedAt < 45_000) {
        await wait(250);
      }

      const remaining =
        (await getOfflineMutationQueue()).length + getOfflineEntityMutationQueue().length;
      return { synced: remaining === 0, remaining };
    }

    if (typeof window === "undefined" || !window.navigator.onLine) {
      return { synced: false, remaining: (await getOfflineMutationQueue()).length };
    }

    await waitForPersistentSyncLock();
    const syncLockToken = acquirePersistentSyncLock();
    if (!syncLockToken) {
      await waitForPersistentSyncLock();
      const remaining =
        (await getOfflineMutationQueue()).length + getOfflineEntityMutationQueue().length;
      return { synced: remaining === 0, remaining };
    }

    let entityQueue = getOfflineEntityMutationQueue();
    let queue = await getOfflineMutationQueue();
    const materialListIdsWithCache = await getOfflineMaterialListIds();
    const queuedDeletes = new Set(
      queue
        .filter((mutation) => mutation.type === "removeItem")
        .map((mutation) => `${mutation.materialListId}:${mutation.itemId}`),
    );

    const recoveredDeleteMutations: OfflineMaterialListMutation[] = [];
    for (const materialListId of materialListIdsWithCache) {
      const cached = await getOfflineMaterialList(materialListId);
      for (const itemId of cached?.pendingDeletedItemIds ?? []) {
        const key = `${materialListId}:${itemId}`;
        if (queuedDeletes.has(key)) continue;
        recoveredDeleteMutations.push({
          type: "removeItem",
          materialListId,
          itemId,
          queuedAt: cached?.updatedAt ?? new Date().toISOString(),
        });
      }
    }

    if (recoveredDeleteMutations.length > 0) {
      queue = [...queue, ...recoveredDeleteMutations];
      await setQueue(queue);
    }

    if (queue.length === 0 && entityQueue.length === 0) {
      await setSyncingMaterialListIds([]);
      return { synced: true, remaining: 0 };
    }

    const queuedMaterialListIds = Array.from(
      new Set(queue.map((item) => item.materialListId)),
    );

    materialListSyncInFlight = true;
    await setSyncingMaterialListIds(queuedMaterialListIds);

    const remaining: OfflineMaterialListMutation[] = [];
    const touchedMaterialLists = new Set<string>();
    const localItemIdMap = new Map<string, string>();

    try {
      const localJobIdMap = new Map<string, string>();
      const localMaterialListIdMap = new Map<string, string>();
      const remainingEntityMutations: OfflineEntityMutation[] = [];
      const deletedMaterialListIds = new Set<string>();

      for (const mutation of entityQueue) {
        try {
          switch (mutation.type) {
            case "createJob": {
              const created = await utils.client.job.createJob.mutate({
                name: mutation.name,
                locationId: mutation.locationId ?? undefined,
              });
              localJobIdMap.set(mutation.localJobId, created.id);

              const detail = getOfflineJobDetail(mutation.localJobId)?.data;
              const jobs = getOfflineJobsList()?.data ?? [];
              setOfflineJobsList(
                jobs.map((job) =>
                  job.id === mutation.localJobId ? { ...job, id: created.id } : job,
                ),
              );
              if (detail) {
                setOfflineJobDetail(created.id, {
                  job: { ...detail.job, id: created.id },
                  materialLists: detail.materialLists,
                });
                removeOfflineJobDetail(mutation.localJobId);
              }
              break;
            }
            case "createMaterialList": {
              const resolvedJobId = localJobIdMap.get(mutation.localJobId) ?? mutation.localJobId;
              if (resolvedJobId.startsWith("offline-job-")) {
                remainingEntityMutations.push(mutation);
                break;
              }

              const created = await utils.client.materialList.createMaterialList.mutate({
                jobId: resolvedJobId,
                name: mutation.name,
              });
              localMaterialListIdMap.set(mutation.localMaterialListId, created.materialListId);
              touchedMaterialLists.add(created.materialListId);

              const cachedList = await getOfflineMaterialList(mutation.localMaterialListId);
              if (cachedList?.data) {
                await setOfflineMaterialList(
                  created.materialListId,
                  {
                    ...cachedList.data,
                    materialList: {
                      ...cachedList.data.materialList,
                      id: created.materialListId,
                    },
                    job: {
                      ...cachedList.data.job,
                      id: resolvedJobId,
                    },
                    quote: { id: created.quoteId },
                  },
                  { pendingSync: true },
                );
              }

              const detail = getOfflineJobDetail(resolvedJobId)?.data;
              if (detail) {
                setOfflineJobDetail(resolvedJobId, {
                  job: detail.job,
                  materialLists: detail.materialLists.map((list) =>
                    list.id === mutation.localMaterialListId
                      ? { ...list, id: created.materialListId }
                      : list,
                  ),
                });
              }
              break;
            }
            case "deleteMaterialList": {
              const resolvedMaterialListId =
                localMaterialListIdMap.get(mutation.materialListId) ?? mutation.materialListId;
              const resolvedJobId = localJobIdMap.get(mutation.jobId) ?? mutation.jobId;

              if (resolvedMaterialListId.startsWith("offline-list-")) {
                deletedMaterialListIds.add(resolvedMaterialListId);
                break;
              }

              try {
                await utils.client.materialList.deleteMaterialList.mutate({
                  materialListId: resolvedMaterialListId,
                });
              } catch (error) {
                if (!isNotFoundError(error)) throw error;
              }

              deletedMaterialListIds.add(resolvedMaterialListId);
              const detail = getOfflineJobDetail(resolvedJobId)?.data;
              if (detail) {
                setOfflineJobDetail(resolvedJobId, {
                  job: detail.job,
                  materialLists: detail.materialLists.filter(
                    (list) => list.id !== resolvedMaterialListId,
                  ),
                });
              }
              setOfflineJobsList(
                (getOfflineJobsList()?.data ?? []).map((job) =>
                  job.id === resolvedJobId
                    ? { ...job, materialListCount: Math.max(0, (job.materialListCount ?? 0) - 1) }
                    : job,
                ),
              );
              await clearOfflineMaterialList(resolvedMaterialListId);
              break;
            }
            case "deleteJob": {
              const resolvedJobId = localJobIdMap.get(mutation.jobId) ?? mutation.jobId;

              if (resolvedJobId.startsWith("offline-job-")) {
                break;
              }

              try {
                await utils.client.job.deleteJob.mutate({ jobId: resolvedJobId });
              } catch (error) {
                if (!isNotFoundError(error)) throw error;
              }

              setOfflineJobsList(
                (getOfflineJobsList()?.data ?? []).filter((job) => job.id !== resolvedJobId),
              );
              removeOfflineJobDetail(resolvedJobId);
              break;
            }
          }
        } catch (error) {
          console.error("Failed to replay offline entity mutation", mutation, error);
          remainingEntityMutations.push(mutation);
        }
      }

      entityQueue = remainingEntityMutations;
      setOfflineEntityMutationQueue(entityQueue);

      const stillPendingDeletedMaterialListIds = new Set(
        entityQueue
          .filter(
            (mutation): mutation is Extract<OfflineEntityMutation, { type: "deleteMaterialList" }> =>
              mutation.type === "deleteMaterialList",
          )
          .map((mutation) => mutation.materialListId),
      );
      const originalQueueLength = queue.length;
      queue = queue.filter(
        (mutation) =>
          !deletedMaterialListIds.has(mutation.materialListId) &&
          !stillPendingDeletedMaterialListIds.has(mutation.materialListId),
      );
      if (queue.length !== originalQueueLength) {
        await setQueue(queue);
      }

      if (localMaterialListIdMap.size > 0 || localJobIdMap.size > 0) {
        queue = queue.map((mutation) => ({
          ...mutation,
          materialListId:
            localMaterialListIdMap.get(mutation.materialListId) ?? mutation.materialListId,
        }));
        await setQueue(queue);
      }

      if (localMaterialListIdMap.size > 0 || localJobIdMap.size > 0) {
        setOfflineIdMappings({
          ...Object.fromEntries(localMaterialListIdMap),
          ...Object.fromEntries(localJobIdMap),
        });
      }

      for (const mutation of queue) {
        try {
          switch (mutation.type) {
            case "addItem": {
              const created = await utils.client.materialList.addItemToMaterialList.mutate({
                materialListId: mutation.materialListId,
                partDefinitionId: mutation.partDefinitionId,
                quantity: mutation.quantity,
                supplierPartId: mutation.supplierPartId,
                unitCost: mutation.unitCost,
                oneOffDisplayName: mutation.oneOffDisplayName,
                oneOffDescription: mutation.oneOffDescription,
                oneOffMaterial: mutation.oneOffMaterial,
                oneOffSizeNominal: mutation.oneOffSizeNominal,
                oneOffSizeUnitId: mutation.oneOffSizeUnitId,
              });
              if (!created) {
                throw new Error("Offline add-item sync did not return a created item");
              }
              touchedMaterialLists.add(mutation.materialListId);
              localItemIdMap.set(mutation.localItemId, created.id);
              break;
            }
            case "updateItemQuantity": {
              const resolvedItemId = localItemIdMap.get(mutation.itemId) ?? mutation.itemId;
              if (isLocalOnlyItemId(resolvedItemId) && !localItemIdMap.has(mutation.itemId)) {
                remaining.push(mutation);
                break;
              }

              await utils.client.materialList.updateMaterialListItem.mutate({
                itemId: resolvedItemId,
                quantity: mutation.quantity,
              });
              touchedMaterialLists.add(mutation.materialListId);
              break;
            }
            case "updateItemSupplierPart": {
              const resolvedItemId = localItemIdMap.get(mutation.itemId) ?? mutation.itemId;
              if (isLocalOnlyItemId(resolvedItemId) && !localItemIdMap.has(mutation.itemId)) {
                remaining.push(mutation);
                break;
              }

              await utils.client.materialList.updateMaterialListItem.mutate({
                itemId: resolvedItemId,
                supplierPartId: mutation.supplierPartId,
              });
              touchedMaterialLists.add(mutation.materialListId);
              break;
            }
            case "removeItem": {
              const resolvedItemId = localItemIdMap.get(mutation.itemId) ?? mutation.itemId;
              if (isLocalOnlyItemId(resolvedItemId) && !localItemIdMap.has(mutation.itemId)) {
                touchedMaterialLists.add(mutation.materialListId);
                break;
              }

              try {
                await utils.client.materialList.removeMaterialListItem.mutate({
                  itemId: resolvedItemId,
                });
              } catch (error) {
                // Offline deletes should be idempotent. If the item is already gone
                // on the server, the user's intended end state is satisfied, so do
                // not keep retrying forever and pin the list in "syncing".
                if (!isNotFoundError(error)) {
                  const itemStillExists = await serverMaterialListStillHasItem(
                    utils.client.materialList.getMaterialList,
                    mutation.materialListId,
                    resolvedItemId,
                  );

                  if (itemStillExists) throw error;
                }
              }

              const itemStillExists = await serverMaterialListStillHasItem(
                utils.client.materialList.getMaterialList,
                mutation.materialListId,
                resolvedItemId,
              );

              if (itemStillExists) {
                throw new Error(
                  `Offline delete did not persist for item ${resolvedItemId}`,
                );
              }

              touchedMaterialLists.add(mutation.materialListId);
              break;
            }
            case "renameMaterialList":
              await utils.client.materialList.updateMaterialListName.mutate({
                materialListId: mutation.materialListId,
                name: mutation.name,
              });
              touchedMaterialLists.add(mutation.materialListId);
              break;
          }
        } catch (error) {
          console.error("Failed to replay offline material list mutation", mutation, error);
          remaining.push(mutation);
        }
      }

      if (remaining.length === 0) {
        await clearQueue();
      } else {
        await setQueue(remaining);
      }

      const materialListsToRefresh = new Set([
        ...queuedMaterialListIds.map(
          (materialListId) => localMaterialListIdMap.get(materialListId) ?? materialListId,
        ),
        ...touchedMaterialLists,
      ].filter((materialListId) => !materialListId.startsWith("offline-list-")));

      for (const materialListId of materialListsToRefresh) {
        await queryClient.invalidateQueries({
          queryKey: [["materialList", "getMaterialList"], { input: { materialListId }, type: "query" }],
        });

        const refreshed = await utils.client.materialList.getMaterialList.query({ materialListId });
        const cached = await getOfflineMaterialList(materialListId);
        const remainingForList = remaining.filter(
          (item) => item.materialListId === materialListId,
        );
        const remainingDeletedItemIds = remainingForList
          .filter((item) => item.type === "removeItem")
          .map((item) => item.itemId);

        if (refreshed) {
          await setOfflineMaterialList(materialListId, refreshed, {
            pendingSync: remainingForList.length > 0,
            pendingDeletedItemIds: remainingDeletedItemIds,
          });
          utils.materialList.getMaterialList.setData({ materialListId }, refreshed);
        } else if (cached?.data) {
          await setOfflineMaterialList(materialListId, cached.data, {
            pendingSync: remainingForList.length > 0,
            pendingDeletedItemIds: remainingDeletedItemIds,
          });
        }
      }

      if (localMaterialListIdMap.size > 0 && typeof window !== "undefined") {
        const pathname = window.location.pathname;
        for (const [localId, serverId] of localMaterialListIdMap) {
          if (pathname.endsWith(`/dashboard/material-lists/${localId}`)) {
            window.history.replaceState(null, "", `/dashboard/material-lists/${serverId}`);
            break;
          }
        }
      }

      const remainingCount = remaining.length + entityQueue.length;
      return { synced: remainingCount === 0, remaining: remainingCount };
    } finally {
      materialListSyncInFlight = false;
      releasePersistentSyncLock(syncLockToken);
      await setSyncingMaterialListIds([]);
    }
  }, [queryClient, utils]);
}

export function useOfflineMaterialListSync() {
  const sync = useOfflineMaterialListSyncRunner();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const runSync = async () => {
      await sync();
    };

    void runSync();
    window.addEventListener("online", runSync);
    return () => window.removeEventListener("online", runSync);
  }, [sync]);
}
