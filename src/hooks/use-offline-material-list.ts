"use client";

import { useEffect, useMemo, useState } from "react";
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
  getSyncingMaterialListIds,
  OFFLINE_MATERIAL_LIST_SYNC_EVENT,
  pruneActiveItemSyncStatuses,
  setActiveItemSyncStatus,
} from "~/lib/offline-material-list-mutations";

export type MaterialListSyncStatus = "synced" | "pending" | "syncing";

export function useOfflineMaterialList(
  materialListId: string,
  serverData?: OfflineMaterialListRecord,
) {
  const [cached, setCached] = useState<OfflineMaterialListEnvelope | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof window === "undefined" ? true : window.navigator.onLine,
  );
  const [syncStateVersion, setSyncStateVersion] = useState(0);
  const [syncSnapshot, setSyncSnapshot] = useState<{
    itemStatuses: Map<string, MaterialListSyncStatus>;
    listStatus: MaterialListSyncStatus;
  }>({ itemStatuses: new Map(), listStatus: "synced" });
  const [hiddenRemovedItemIds, setHiddenRemovedItemIds] = useState<Set<string>>(
    () => new Set(),
  );

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
    const onSyncStateChanged = () => {
      setSyncStateVersion((version) => version + 1);
      void getOfflineMaterialList(materialListId).then((offlineMaterialList) => {
        if (!cancelled) setCached(offlineMaterialList);
      });
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_MATERIAL_LIST_SYNC_EVENT, onSyncStateChanged);
    window.addEventListener("storage", onSyncStateChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_MATERIAL_LIST_SYNC_EVENT, onSyncStateChanged);
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

      if (current?.pendingSync) {
        const queue = await getOfflineMutationQueue();
        const hasQueuedChangesForList = queue.some(
          (mutation) => mutation.materialListId === materialListId,
        );
        const hasPendingDeletedItems =
          (current.pendingDeletedItemIds?.length ?? 0) > 0;

        if (hasQueuedChangesForList || hasPendingDeletedItems) {
          setCached(current);
          return;
        }
      }

      await setOfflineMaterialList(materialListId, serverData, { pendingSync: false });
      if (!cancelled) {
        setCached(await getOfflineMaterialList(materialListId));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, materialListId, serverData]);

  const rawData = useMemo(() => {
    if (isOnline && serverData && !cached?.pendingSync) return serverData;
    if (cacheLoaded && cached?.data) return cached.data;
    if (!isOnline) return cacheLoaded ? null : null;
    return cached?.data ?? serverData ?? null;
  }, [cacheLoaded, cached?.data, cached?.pendingSync, isOnline, serverData]);

  const data = useMemo(() => {
    if (!rawData || hiddenRemovedItemIds.size === 0) return rawData;

    const items = rawData.items.filter(
      (item) => !hiddenRemovedItemIds.has(String(item.id)),
    );

    if (items.length === rawData.items.length) return rawData;

    const materialTotal = items.reduce((sum, item) => {
      const price = item.extendedPrice ? parseFloat(item.extendedPrice.toString()) : 0;
      return sum + price;
    }, 0);

    return {
      ...rawData,
      items,
      materialTotal,
    };
  }, [hiddenRemovedItemIds, rawData]);

  useEffect(() => {
    const pendingDeletedItemIds = cached?.pendingDeletedItemIds ?? [];
    if (pendingDeletedItemIds.length === 0) return;

    setHiddenRemovedItemIds((current) => {
      const next = new Set(current);
      let changed = false;

      for (const itemId of pendingDeletedItemIds) {
        if (!next.has(itemId)) {
          next.add(itemId);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [cached?.pendingDeletedItemIds]);

  useEffect(() => {
    if (!rawData || hiddenRemovedItemIds.size === 0) return;

    const rawItemIds = new Set(rawData.items.map((item) => String(item.id)));
    const pendingDeletedItemIds = new Set(cached?.pendingDeletedItemIds ?? []);
    setHiddenRemovedItemIds((current) => {
      let changed = false;
      const next = new Set<string>();

      for (const itemId of current) {
        if (rawItemIds.has(itemId) || pendingDeletedItemIds.has(itemId)) {
          next.add(itemId);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [cached?.pendingDeletedItemIds, hiddenRemovedItemIds.size, rawData]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const queue = await getOfflineMutationQueue();
      const queuedRemoveIds = new Set<string>();
      for (const mutation of queue) {
        if (mutation.materialListId === materialListId && mutation.type === "removeItem") {
          queuedRemoveIds.add(mutation.itemId);
        }
      }

      if (!cancelled && queuedRemoveIds.size > 0) {
        setHiddenRemovedItemIds((current) => {
          const next = new Set(current);
          for (const itemId of queuedRemoveIds) {
            next.add(itemId);
          }
          return next;
        });
      }

      const queuedItems = getQueuedItemIdsForMaterialList(materialListId, queue);
      const rawActiveStatuses = (await getActiveItemSyncStatuses())[materialListId] ?? {};
      const currentItemIds = new Set((data?.items ?? []).map((item) => String(item.id)));
      const activeStatuses = Object.fromEntries(
        Object.entries(rawActiveStatuses).filter(([itemId]) => currentItemIds.has(itemId)),
      );
      const activeStatusValues = Object.values(activeStatuses);
      const hasQueuedListChanges = queue.some(
        (mutation) => mutation.materialListId === materialListId,
      );
      const isSyncing = isOnline && (await getSyncingMaterialListIds()).includes(materialListId);

      const itemStatuses = new Map<string, MaterialListSyncStatus>();

      await pruneActiveItemSyncStatuses(materialListId, currentItemIds);

      const hasStaleActiveStatuses =
        isOnline &&
        !!serverData &&
        !isSyncing &&
        !hasQueuedListChanges &&
        !cached?.pendingSync &&
        activeStatusValues.length > 0;

      if (hasStaleActiveStatuses) {
        await Promise.all(
          Object.keys(activeStatuses).map((itemId) =>
            setActiveItemSyncStatus(materialListId, itemId, "synced"),
          ),
        );
      }

      for (const item of data?.items ?? []) {
        const itemId = String(item.id);
        const activeStatus = activeStatuses[itemId];

        if (activeStatus && !hasStaleActiveStatuses) {
          itemStatuses.set(itemId, activeStatus === "syncing" && !isOnline ? "pending" : activeStatus);
        } else if (isSyncing && queuedItems.has(itemId)) {
          itemStatuses.set(itemId, "syncing");
        } else if (queuedItems.has(itemId)) {
          itemStatuses.set(itemId, "pending");
        } else {
          itemStatuses.set(itemId, "synced");
        }
      }

      const listStatus: MaterialListSyncStatus =
        (isOnline && !hasStaleActiveStatuses && activeStatusValues.includes("syncing")) || isSyncing
          ? "syncing"
          : (!hasStaleActiveStatuses && activeStatusValues.includes("pending")) || hasQueuedListChanges || !!cached?.pendingSync
            ? "pending"
            : "synced";

      if (!cancelled) setSyncSnapshot({ itemStatuses, listStatus });
    })();

    return () => {
      cancelled = true;
    };
  }, [cached?.pendingSync, data?.items, isOnline, materialListId, syncStateVersion]);

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
