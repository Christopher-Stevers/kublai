"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getOfflineMaterialList,
  setOfflineMaterialList,
  type OfflineMaterialListEnvelope,
  type OfflineMaterialListRecord,
} from "~/lib/offline-material-list";
import {
  getActiveItemSyncStatuses,
  getOfflineMutationQueue,
  getQueuedItemIdsForMaterialList,
  OFFLINE_MATERIAL_LIST_SYNC_EVENT,
  pruneActiveItemSyncStatuses,
} from "~/lib/offline-material-list-mutations";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import { projectMaterialListWithMutations } from "~/lib/material-list-projector";
import type { OfflineMaterialListMutation } from "~/lib/offline-material-list-mutations";
import { normalizeLegacyOfflineMaterialListName } from "~/lib/offline-jobs";

export type MaterialListSyncStatus = "synced" | "pending" | "syncing";

export function useOfflineMaterialList(
  materialListId: string,
  serverData?: OfflineMaterialListRecord,
) {
  const [cached, setCached] = useState<OfflineMaterialListEnvelope | null>(
    null,
  );
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof window === "undefined" ? true : window.navigator.onLine,
  );
  const [syncStateVersion, setSyncStateVersion] = useState(0);
  const [syncSnapshot, setSyncSnapshot] = useState<{
    itemStatuses: Map<string, MaterialListSyncStatus>;
    listStatus: MaterialListSyncStatus;
  }>({ itemStatuses: new Map(), listStatus: "synced" });
  const [queueSnapshot, setQueueSnapshot] = useState<
    OfflineMaterialListMutation[]
  >([]);
  const liveCached = useLiveQuery(
    async () => {
      const db = getOfflineDexieDb();
      if (!db) return null;
      const row = await db.materialLists.get(materialListId);
      return (row?.value as OfflineMaterialListEnvelope | undefined) ?? null;
    },
    [materialListId],
    undefined,
  );
  const liveQueue = useLiveQuery(
    async () => {
      const db = getOfflineDexieDb();
      if (!db) return null;
      const rows = await db.mutationQueue
        .where("materialListId")
        .equals(materialListId)
        .sortBy("order");
      return rows.map((row) => row.value as OfflineMaterialListMutation);
    },
    [materialListId],
    undefined,
  );

  useEffect(() => {
    if (liveCached === undefined) return;
    setCached(liveCached);
    setCacheLoaded(true);
  }, [liveCached]);

  useEffect(() => {
    if (liveQueue === undefined) return;
    if (liveQueue) {
      setQueueSnapshot(liveQueue);
      return;
    }

    void getOfflineMutationQueue().then((queue) => {
      setQueueSnapshot(
        queue.filter((mutation) => mutation.materialListId === materialListId),
      );
    });
  }, [liveQueue, materialListId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    setCached(null);
    setCacheLoaded(false);
    setIsOnline(window.navigator.onLine);
    void getOfflineMaterialList(materialListId).then((offlineMaterialList) => {
      if (!cancelled) {
        setCached(offlineMaterialList);
        setCacheLoaded(true);
      }
    });

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onSyncStateChanged = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as
              | {
                  materialListId?: string;
                  itemId?: string;
                  status?: MaterialListSyncStatus;
                }
              | undefined)
          : undefined;

      if (
        detail?.materialListId === materialListId &&
        detail.itemId &&
        (detail.status === "pending" ||
          detail.status === "syncing" ||
          detail.status === "synced")
      ) {
        setSyncSnapshot((current) => {
          const itemStatuses = new Map(current.itemStatuses);
          if (detail.status === "synced") {
            itemStatuses.delete(detail.itemId!);
          } else {
            itemStatuses.set(detail.itemId!, detail.status!);
          }

          const statusValues = Array.from(itemStatuses.values());
          const listStatus: MaterialListSyncStatus = statusValues.includes(
            "syncing",
          )
            ? "syncing"
            : statusValues.includes("pending")
              ? "pending"
              : "synced";

          return { itemStatuses, listStatus };
        });
      }

      setSyncStateVersion((version) => version + 1);
      void getOfflineMutationQueue().then((queue) => {
        if (!cancelled) {
          setQueueSnapshot(
            queue.filter(
              (mutation) => mutation.materialListId === materialListId,
            ),
          );
        }
      });
      void getOfflineMaterialList(materialListId).then(
        (offlineMaterialList) => {
          if (!cancelled) setCached(offlineMaterialList);
        },
      );
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(
      OFFLINE_MATERIAL_LIST_SYNC_EVENT,
      onSyncStateChanged,
    );
    window.addEventListener("storage", onSyncStateChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(
        OFFLINE_MATERIAL_LIST_SYNC_EVENT,
        onSyncStateChanged,
      );
      window.removeEventListener("storage", onSyncStateChanged);
    };
  }, [materialListId]);

  useEffect(() => {
    if (!serverData) return;
    if (!isOnline) return;

    let cancelled = false;
    void (async () => {
      const current = await getOfflineMaterialList(materialListId);
      if (cancelled) return;

      const queue = await getOfflineMutationQueue();
      const queueForList = queue.filter(
        (mutation) => mutation.materialListId === materialListId,
      );
      const hasQueuedChangesForList = queueForList.length > 0;

      // Online must stay boring: write the latest server snapshot into Dexie as
      // cache, but do not carry stale local delete shadows forward. The durable
      // queue is the only pending state.
      await setOfflineMaterialList(materialListId, serverData, {
        pendingSync: hasQueuedChangesForList,
        pendingDeletedItemIds: [],
      });
      if (!cancelled) {
        setCached(await getOfflineMaterialList(materialListId));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, materialListId, serverData]);

  const baseRawData = useMemo(() => {
    const data = isOnline
      ? (serverData ?? cached?.data ?? null)
      : (cached?.data ?? null);
    if (!data) return data;

    const normalizedName = normalizeLegacyOfflineMaterialListName(
      data.materialList.name,
      data.materialList.createdAt,
    );
    if (normalizedName === data.materialList.name) return data;

    return {
      ...data,
      materialList: {
        ...data.materialList,
        name: normalizedName,
      },
    };
  }, [cacheLoaded, cached?.data, isOnline, serverData]);

  const rawData = useMemo(() => {
    if (!baseRawData) return baseRawData;

    // Stop the mixed-truth flicker: while online, render exactly what the
    // server query returned. Pending local mutations may still sync in the
    // background, but they do not get to invent a second on-screen reality.
    // Offline keeps the sticky-note overlay so field edits still work without a
    // connection.
    if (isOnline) return baseRawData;

    return projectMaterialListWithMutations(baseRawData, queueSnapshot);
  }, [baseRawData, isOnline, queueSnapshot]);

  const data = rawData;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [queue, activeStatuses] = await Promise.all([
        getOfflineMutationQueue(),
        getActiveItemSyncStatuses(),
      ]);
      const queuedItems = getQueuedItemIdsForMaterialList(
        materialListId,
        queue,
      );
      const activeListStatuses = activeStatuses[materialListId] ?? {};
      const currentItemIds = new Set(
        (data?.items ?? []).map((item) => String(item.id)),
      );
      const hasQueuedListChanges = queue.some(
        (mutation) => mutation.materialListId === materialListId,
      );

      const itemStatuses = new Map<string, MaterialListSyncStatus>();

      await pruneActiveItemSyncStatuses(materialListId, currentItemIds);

      for (const item of data?.items ?? []) {
        const itemId = String(item.id);
        const activeStatus = activeListStatuses[itemId]?.status;
        if (activeStatus === "syncing") {
          itemStatuses.set(itemId, "syncing");
        } else if (activeStatus === "pending" || queuedItems.has(itemId)) {
          itemStatuses.set(itemId, "pending");
        } else {
          itemStatuses.set(itemId, "synced");
        }
      }

      const hasPendingCachedChanges =
        !!cached?.pendingSync && (!isOnline || hasQueuedListChanges);
      const listStatus: MaterialListSyncStatus =
        hasQueuedListChanges || hasPendingCachedChanges ? "pending" : "synced";

      if (!cancelled) setSyncSnapshot({ itemStatuses, listStatus });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    cached?.pendingSync,
    data?.items,
    isOnline,
    materialListId,
    syncStateVersion,
  ]);

  return {
    data,
    cached,
    cacheLoaded,
    isOnline,
    isOfflineFallback: !isOnline && !!cached?.data,
    syncStatus: syncSnapshot.listStatus,
    itemSyncStatuses: syncSnapshot.itemStatuses,
  };
}
