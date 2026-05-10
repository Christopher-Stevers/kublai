"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import { idbGetMeta, idbSetMeta } from "~/lib/offline-indexed-db";
import {
  getOfflineMaterialList,
  remapOfflineMaterialListCacheId,
  setOfflineMaterialList,
  type OfflineMaterialListRecord,
} from "~/lib/offline-material-list";
import {
  getOfflineMutationQueue,
  getQueuedItemIdsForMaterialList,
  getQueuedMaterialListIds,
  notifyOfflineMaterialListSyncStateChanged,
  remapOfflineMutationMaterialListId,
  setActiveItemSyncStatus,
  setOfflineMutationQueue,
  setSyncingMaterialListIds,
  type OfflineMaterialListMutation,
} from "~/lib/offline-material-list-mutations";
import {
  getOfflineEntityMutationQueue,
  remapOfflineJobId,
  remapOfflineMaterialListId,
  setOfflineEntityMutationQueue,
  type OfflineEntityMutation,
  type OfflineJobDetail,
} from "~/lib/offline-jobs";

const PULL_CURSOR_META_KEY = "material-list-sync-pull-cursor";
const BACKGROUND_PULL_INTERVAL_MS = 30_000;

type SyncResult = {
  synced: boolean;
  pushed: number;
  pulled: number;
  remaining: number;
};

function canReachServer() {
  return typeof window !== "undefined" && window.navigator.onLine;
}

function isUuid(value: string | null | undefined) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function toOfflineJobDetail(job: {
  id: string;
  name: string;
  locationId?: string | null;
  poNumber?: string | null;
  foremanUserId?: string | null;
  status?: string | null;
  createdAt?: string | Date;
}): OfflineJobDetail {
  return {
    id: job.id,
    name: job.name,
    locationId: job.locationId ?? null,
    poNumber: job.poNumber ?? null,
    foremanUserId: job.foremanUserId ?? null,
    status: job.status ?? "draft",
    createdAt: job.createdAt ?? new Date().toISOString(),
    location: null,
    foreman: null,
  };
}

function withClientMutationId(mutation: OfflineMaterialListMutation) {
  return {
    ...mutation,
    clientMutationId:
      mutation.clientMutationId ??
      `${mutation.materialListId}:${mutation.type}:${mutation.queuedAt}:${crypto.randomUUID()}`,
  } as OfflineMaterialListMutation & { clientMutationId: string };
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
        supplierId: normalized.supplierId ?? normalized.supplierPartSnapshot?.supplierId ?? null,
        unitCost: normalized.unitCost,
        oneOffDisplayName: normalized.oneOffDisplayName,
        oneOffDescription: normalized.oneOffDescription,
        oneOffMaterial: normalized.oneOffMaterial,
        oneOffSizeNominal: normalized.oneOffSizeNominal,
        oneOffSizeUnitId: normalized.oneOffSizeUnitId,
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
        supplierId: normalized.supplierId ?? normalized.supplierPartSnapshot?.supplierId ?? null,
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

export function useOfflineMaterialListSyncRunner() {
  const utils = api.useUtils();
  const createJob = api.job.createJob.useMutation();
  const updateJob = api.job.updateJob.useMutation();
  const createMaterialList = api.materialList.createMaterialList.useMutation();
  const syncMutations = api.materialList.syncMaterialListMutations.useMutation();
  const runningRef = useRef(false);

  return useCallback(async (): Promise<SyncResult> => {
    const initialQueue = await getOfflineMutationQueue();
    const entityQueueCount = getOfflineEntityMutationQueue().length;

    if (!canReachServer()) {
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

    runningRef.current = true;
    let pushed = 0;
    let pulled = 0;
    const touchedMaterialListIds = new Set<string>(getQueuedMaterialListIds(initialQueue));

    try {
      let entityQueue = getOfflineEntityMutationQueue();
      if (entityQueue.length > 0) {
        const remainingEntityQueue: OfflineEntityMutation[] = [];

        for (const mutation of entityQueue) {
          try {
            if (mutation.type === "createJob") {
              const locationId = isUuid(mutation.locationId)
                ? String(mutation.locationId)
                : undefined;
              const serverJob = await createJob.mutateAsync({
                name: mutation.name,
                locationId,
              });
              remapOfflineJobId(mutation.localJobId, toOfflineJobDetail(serverJob));
              continue;
            }

            if (mutation.type === "updateJob") {
              if (!isUuid(mutation.jobId)) {
                remainingEntityQueue.push(mutation);
                continue;
              }
              await updateJob.mutateAsync({
                jobId: mutation.jobId,
                name: mutation.name ?? undefined,
                locationId: isUuid(mutation.locationId) ? mutation.locationId : null,
                poNumber: mutation.poNumber ?? undefined,
                foremanName: mutation.foremanName ?? undefined,
              });
              continue;
            }

            if (mutation.type === "createMaterialList") {
              if (!isUuid(mutation.localJobId)) {
                remainingEntityQueue.push(mutation);
                continue;
              }
              const created = await createMaterialList.mutateAsync({
                jobId: mutation.localJobId,
                name: mutation.name,
              });
              remapOfflineMaterialListId(
                mutation.localJobId,
                mutation.localMaterialListId,
                created.materialListId,
              );
              await remapOfflineMaterialListCacheId(
                mutation.localMaterialListId,
                created.materialListId,
              );
              await remapOfflineMutationMaterialListId(
                mutation.localMaterialListId,
                created.materialListId,
              );
              touchedMaterialListIds.add(created.materialListId);
              continue;
            }

            remainingEntityQueue.push(mutation);
          } catch (error) {
            console.warn("ForemenHQ entity sync failed", { mutation, error });
            remainingEntityQueue.push(mutation);
          }
        }

        setOfflineEntityMutationQueue(remainingEntityQueue);
      }

      let queue = (await getOfflineMutationQueue()).map(withClientMutationId);
      if (queue.length > 0) {
        const queuedIds = getQueuedMaterialListIds(queue);
        await setSyncingMaterialListIds(queuedIds);

        for (const materialListId of queuedIds) {
          const mutationsForList = queue.filter(
            (mutation) => mutation.materialListId === materialListId,
          );
          if (mutationsForList.length === 0) continue;

          for (const mutation of mutationsForList) {
            for (const itemId of mutationItemIds(mutation)) {
              await setActiveItemSyncStatus(materialListId, itemId, "syncing");
            }
          }

          const result = await syncMutations.mutateAsync({
            materialListId,
            mutations: mutationsForList.map(toServerMutation),
          });

          const appliedIds = new Set(result.applied.map((item) => item.clientMutationId));
          const failedIds = new Set(result.failed.map((item) => item.clientMutationId));

          if (appliedIds.size > 0) {
            pushed += appliedIds.size;
            for (const mutation of mutationsForList) {
              if (!appliedIds.has(mutation.clientMutationId)) continue;
              for (const itemId of mutationItemIds(mutation)) {
                await setActiveItemSyncStatus(materialListId, itemId, "synced");
              }
            }
          }

          queue = queue.filter((mutation) => {
            if (mutation.materialListId !== materialListId) return true;
            if (failedIds.has(mutation.clientMutationId)) return true;
            return !appliedIds.has(mutation.clientMutationId);
          });
          await setOfflineMutationQueue(queue);
        }
      }

      const cursor = await idbGetMeta<string | null>(PULL_CURSOR_META_KEY, null);
      const pull = await utils.materialList.pullMaterialListSyncChanges.fetch({
        since: cursor ?? undefined,
        materialListIds: touchedMaterialListIds.size
          ? Array.from(touchedMaterialListIds)
          : undefined,
      });

      for (const tombstone of pull.tombstones) {
        touchedMaterialListIds.add(tombstone.materialListId);
      }
      for (const materialListId of pull.changedMaterialListIds) {
        touchedMaterialListIds.add(materialListId);
      }

      const remainingQueue = await getOfflineMutationQueue();
      for (const materialListId of touchedMaterialListIds) {
        const serverData = (await utils.materialList.getMaterialList.fetch({
          materialListId,
        })) as OfflineMaterialListRecord;
        const queuedForList = remainingQueue.filter(
          (mutation) => mutation.materialListId === materialListId,
        );
        const existing = await getOfflineMaterialList(materialListId);
        const queuedItemIds = getQueuedItemIdsForMaterialList(materialListId, remainingQueue);

        await setOfflineMaterialList(materialListId, serverData, {
          pendingSync: queuedForList.length > 0,
          pendingDeletedItemIds: existing?.pendingDeletedItemIds?.filter((itemId) =>
            queuedItemIds.has(itemId),
          ),
        });
        pulled += 1;
      }

      await idbSetMeta(PULL_CURSOR_META_KEY, pull.cursor);
      await setSyncingMaterialListIds([]);
      notifyOfflineMaterialListSyncStateChanged();

      const finalQueue = await getOfflineMutationQueue();
      return {
        synced: finalQueue.length === 0,
        pushed,
        pulled,
        remaining: finalQueue.length + getOfflineEntityMutationQueue().length,
      };
    } catch (error) {
      await setSyncingMaterialListIds([]);
      const queue = await getOfflineMutationQueue();
      const queuedAt = latestQueuedAt(queue);
      console.warn("ForemenHQ material-list sync failed", { queuedAt, error });
      return {
        synced: false,
        pushed,
        pulled,
        remaining: queue.length + getOfflineEntityMutationQueue().length,
      };
    } finally {
      runningRef.current = false;
    }
  }, [createJob, createMaterialList, syncMutations, updateJob, utils]);
}

export function useOfflineMaterialListSync() {
  const runSync = useOfflineMaterialListSyncRunner();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay = 0) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (cancelled || !canReachServer()) return;
        void runSync();
      }, delay);
    };

    const onOnline = () => schedule(0);
    const onFocus = () => schedule(250);

    schedule(750);
    const interval = setInterval(() => schedule(0), BACKGROUND_PULL_INTERVAL_MS);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, [runSync]);
}
