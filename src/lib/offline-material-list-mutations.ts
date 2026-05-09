import {
  getOfflineMaterialList,
  patchOfflineMaterialList,
  setOfflineMaterialList,
  type OfflineMaterialListRecord,
} from "~/lib/offline-material-list";
import { idbDeleteMeta, idbGetMeta, idbSetMeta } from "~/lib/offline-indexed-db";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";

export type OfflineMaterialListMutation =
  | {
      type: "addItem";
      materialListId: string;
      localItemId: string;
      partDefinitionId?: string;
      quantity: number;
      supplierPartId?: string;
      supplierId?: string;
      unitCost?: number;
      oneOffDisplayName?: string;
      oneOffDescription?: string;
      oneOffMaterial?: string;
      oneOffSizeNominal?: number;
      oneOffSizeUnitId?: string;
      partDefinitionSnapshot?: {
        id: string;
        displayName: string;
        imageUrl: string | null;
        material: string | null;
      } | null;
      supplierPartSnapshot?: {
        id: string;
        supplierId: string;
        supplierSku: string | null;
        lastKnownUnitCost: string | null;
        supplier: {
          id: string;
          name: string;
        } | null;
      } | null;
      queuedAt: string;
    }
  | {
      type: "updateItemQuantity";
      materialListId: string;
      itemId: string;
      quantity: number;
      queuedAt: string;
    }
  | {
      type: "removeItem";
      materialListId: string;
      itemId: string;
      queuedAt: string;
    }
  | {
      type: "updateItemSupplierPart";
      materialListId: string;
      itemId: string;
      supplierPartId: string | null;
      supplierId?: string;
      partDefinitionId?: string;
      unitCost: number | null;
      supplierPartSnapshot: {
        id: string;
        supplierId: string;
        supplierSku: string | null;
        lastKnownUnitCost: string | null;
        supplier: {
          id: string;
          name: string;
        } | null;
      } | null;
      queuedAt: string;
    }
  | {
      type: "renameMaterialList";
      materialListId: string;
      name: string;
      queuedAt: string;
    };

const QUEUE_STORAGE_KEY = "foremanhq.offline.material-list.queue";
const ACTIVE_ITEM_SYNC_STORAGE_KEY = "foremanhq.material-list.active-item-sync";
const SYNCING_LISTS_STORAGE_KEY = "foremanhq.offline.material-list.syncing";
const QUEUE_META_KEY = "material-list-mutation-queue";
const ACTIVE_ITEM_SYNC_META_KEY = "material-list-active-item-sync";
const SYNCING_LISTS_META_KEY = "material-list-syncing-ids";
let legacyMetaMigrated = false;

async function migrateLegacySyncMeta() {
  if (legacyMetaMigrated || typeof window === "undefined") return;
  legacyMetaMigrated = true;

  const legacyQueue = window.localStorage.getItem(QUEUE_STORAGE_KEY);
  if (legacyQueue) {
    try {
      const existing = await idbGetMeta<OfflineMaterialListMutation[]>(QUEUE_META_KEY, []);
      if (existing.length === 0) {
        await idbSetMeta(QUEUE_META_KEY, JSON.parse(legacyQueue) as OfflineMaterialListMutation[]);
      }
    } catch {
      // Ignore malformed legacy queue.
    }
  }

  const legacyActive = window.localStorage.getItem(ACTIVE_ITEM_SYNC_STORAGE_KEY);
  if (legacyActive) {
    try {
      const existing = await idbGetMeta<Record<string, Record<string, MaterialListItemSyncStatus>>>(
        ACTIVE_ITEM_SYNC_META_KEY,
        {},
      );
      if (Object.keys(existing).length === 0) {
        await idbSetMeta(
          ACTIVE_ITEM_SYNC_META_KEY,
          JSON.parse(legacyActive) as Record<string, Record<string, MaterialListItemSyncStatus>>,
        );
      }
    } catch {
      // Ignore malformed legacy sync state.
    }
  }

  const legacySyncing = window.localStorage.getItem(SYNCING_LISTS_STORAGE_KEY);
  if (legacySyncing) {
    try {
      const existing = await idbGetMeta<string[]>(SYNCING_LISTS_META_KEY, []);
      if (existing.length === 0) {
        await idbSetMeta(SYNCING_LISTS_META_KEY, JSON.parse(legacySyncing) as string[]);
      }
    } catch {
      // Ignore malformed legacy sync state.
    }
  }
}

export const OFFLINE_MATERIAL_LIST_SYNC_EVENT = "foremanhq:offline-material-list-sync";
export const ACTIVE_ITEM_SYNC_STATUS_TTL_MS = 2 * 60 * 1000;
export type MaterialListItemSyncStatus = "pending" | "syncing";
export interface MaterialListItemSyncState {
  status: MaterialListItemSyncStatus;
  updatedAt: number;
}
type StoredMaterialListItemSyncState =
  | MaterialListItemSyncStatus
  | MaterialListItemSyncState;

function normalizeItemSyncState(
  value: StoredMaterialListItemSyncState,
): MaterialListItemSyncState | null {
  if (value === "pending" || value === "syncing") {
    return { status: value, updatedAt: 0 };
  }

  if (
    value &&
    typeof value === "object" &&
    (value.status === "pending" || value.status === "syncing")
  ) {
    return {
      status: value.status,
      updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    };
  }

  return null;
}

export function notifyOfflineMaterialListSyncStateChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OFFLINE_MATERIAL_LIST_SYNC_EVENT));
}

export function getQueuedMaterialListIds(queue: OfflineMaterialListMutation[]) {
  return Array.from(new Set(queue.map((item) => item.materialListId)));
}

export function getQueuedItemIdsForMaterialList(
  materialListId: string,
  queue: OfflineMaterialListMutation[],
) {
  const ids = new Set<string>();

  for (const mutation of queue) {
    if (mutation.materialListId !== materialListId) continue;

    if (mutation.type === "addItem") {
      ids.add(mutation.localItemId);
    } else if (
      mutation.type === "updateItemQuantity" ||
      mutation.type === "updateItemSupplierPart" ||
      mutation.type === "removeItem"
    ) {
      ids.add(mutation.itemId);
    }
  }

  return ids;
}

export async function getActiveItemSyncStatuses() {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();

  if (db) {
    const rows = await db.activeItemSync.toArray();
    if (rows.length > 0) {
      const grouped: Record<string, Record<string, MaterialListItemSyncState>> = {};
      for (const row of rows) {
        grouped[row.materialListId] ??= {};
        grouped[row.materialListId]![row.itemId] = {
          status: row.status,
          updatedAt: row.updatedAt,
        };
      }
      return grouped;
    }
  }

  const stored = await idbGetMeta<Record<string, Record<string, StoredMaterialListItemSyncState>>>(
    ACTIVE_ITEM_SYNC_META_KEY,
    {},
  );
  const normalized: Record<string, Record<string, MaterialListItemSyncState>> = {};

  for (const [materialListId, listStatuses] of Object.entries(stored)) {
    const normalizedList: Record<string, MaterialListItemSyncState> = {};
    for (const [itemId, value] of Object.entries(listStatuses)) {
      const state = normalizeItemSyncState(value);
      if (state) normalizedList[itemId] = state;
    }
    if (Object.keys(normalizedList).length > 0) {
      normalized[materialListId] = normalizedList;
    }
  }

  if (db && Object.keys(normalized).length > 0) {
    await db.activeItemSync.bulkPut(
      Object.entries(normalized).flatMap(([materialListId, listStatuses]) =>
        Object.entries(listStatuses).map(([itemId, state]) => ({
          id: `${materialListId}:${itemId}`,
          materialListId,
          itemId,
          status: state.status,
          updatedAt: state.updatedAt,
        })),
      ),
    );
  }

  return normalized;
}

export async function setActiveItemSyncStatus(
  materialListId: string,
  itemId: string,
  status: MaterialListItemSyncStatus | "synced",
) {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();
  const id = `${materialListId}:${itemId}`;

  if (db) {
    if (status === "synced") {
      await db.activeItemSync.delete(id);
    } else {
      await db.activeItemSync.put({
        id,
        materialListId,
        itemId,
        status,
        updatedAt: Date.now(),
      });
    }
  } else {
    const statuses = await getActiveItemSyncStatuses();
    const listStatuses = { ...(statuses[materialListId] ?? {}) };

    if (status === "synced") {
      delete listStatuses[itemId];
    } else {
      listStatuses[itemId] = { status, updatedAt: Date.now() };
    }

    if (Object.keys(listStatuses).length === 0) {
      delete statuses[materialListId];
    } else {
      statuses[materialListId] = listStatuses;
    }

    if (Object.keys(statuses).length === 0) {
      await idbDeleteMeta(ACTIVE_ITEM_SYNC_META_KEY);
    } else {
      await idbSetMeta(ACTIVE_ITEM_SYNC_META_KEY, statuses);
    }
  }

  notifyOfflineMaterialListSyncStateChanged();
}

export async function pruneActiveItemSyncStatuses(
  materialListId: string,
  validItemIds: Set<string>,
) {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();

  if (db) {
    const rows = await db.activeItemSync.where("materialListId").equals(materialListId).toArray();
    const staleIds = rows
      .filter((row) => !validItemIds.has(row.itemId))
      .map((row) => row.id);

    if (staleIds.length === 0) return;
    await db.activeItemSync.bulkDelete(staleIds);
    notifyOfflineMaterialListSyncStateChanged();
    return;
  }

  const statuses = await getActiveItemSyncStatuses();
  const listStatuses = statuses[materialListId];

  if (!listStatuses) return;

  let changed = false;
  const nextListStatuses: Record<string, MaterialListItemSyncState> = {};

  for (const [itemId, state] of Object.entries(listStatuses)) {
    if (validItemIds.has(itemId)) {
      nextListStatuses[itemId] = state;
    } else {
      changed = true;
    }
  }

  if (!changed) return;

  if (Object.keys(nextListStatuses).length === 0) {
    delete statuses[materialListId];
  } else {
    statuses[materialListId] = nextListStatuses;
  }

  if (Object.keys(statuses).length === 0) {
    await idbDeleteMeta(ACTIVE_ITEM_SYNC_META_KEY);
  } else {
    await idbSetMeta(ACTIVE_ITEM_SYNC_META_KEY, statuses);
  }

  notifyOfflineMaterialListSyncStateChanged();
}

export async function getSyncingMaterialListIds() {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();

  if (db) {
    const rows = await db.syncingMaterialLists.toArray();
    if (rows.length > 0) return rows.map((row) => row.id);
  }

  const legacyIds = await idbGetMeta<string[]>(SYNCING_LISTS_META_KEY, []);
  if (db && legacyIds.length > 0) {
    await db.syncingMaterialLists.bulkPut(legacyIds.map((id) => ({ id })));
  }
  return legacyIds;
}

export async function setSyncingMaterialListIds(materialListIds: string[]) {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();
  const uniqueIds = Array.from(new Set(materialListIds));

  if (db) {
    await db.syncingMaterialLists.clear();
    if (uniqueIds.length > 0) {
      await db.syncingMaterialLists.bulkPut(uniqueIds.map((id) => ({ id })));
    }
  } else if (uniqueIds.length === 0) {
    await idbDeleteMeta(SYNCING_LISTS_META_KEY);
  } else {
    await idbSetMeta(SYNCING_LISTS_META_KEY, uniqueIds);
  }

  notifyOfflineMaterialListSyncStateChanged();
}

export async function getOfflineMutationQueue(): Promise<OfflineMaterialListMutation[]> {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();

  if (db) {
    const rows = await db.mutationQueue.orderBy("order").toArray();
    if (rows.length > 0) {
      return rows.map((row) => row.value as OfflineMaterialListMutation);
    }
  }

  const legacyQueue = await idbGetMeta<OfflineMaterialListMutation[]>(QUEUE_META_KEY, []);
  if (db && legacyQueue.length > 0) {
    await db.mutationQueue.bulkPut(
      legacyQueue.map((mutation, index) => ({
        id: `${mutation.queuedAt}:${index}:${mutation.type}`,
        order: index,
        materialListId: mutation.materialListId,
        type: mutation.type,
        queuedAt: mutation.queuedAt,
        value: mutation,
      })),
    );
  }
  return legacyQueue;
}

export async function setOfflineMutationQueue(queue: OfflineMaterialListMutation[]) {
  await migrateLegacySyncMeta();
  const db = getOfflineDexieDb();

  if (db) {
    await db.mutationQueue.clear();
    if (queue.length > 0) {
      await db.mutationQueue.bulkPut(
        queue.map((mutation, index) => ({
          id: `${mutation.queuedAt}:${index}:${mutation.type}`,
          order: index,
          materialListId: mutation.materialListId,
          type: mutation.type,
          queuedAt: mutation.queuedAt,
          value: mutation,
        })),
      );
    }
  } else if (queue.length === 0) {
    await idbDeleteMeta(QUEUE_META_KEY);
  } else {
    await idbSetMeta(QUEUE_META_KEY, queue);
  }
  notifyOfflineMaterialListSyncStateChanged();
}

export async function enqueueOfflineMutation(mutation: OfflineMaterialListMutation) {
  const queue = compactOfflineMutationQueue(await getOfflineMutationQueue(), mutation);
  await setOfflineMutationQueue(queue);
}

function compactOfflineMutationQueue(
  queue: OfflineMaterialListMutation[],
  incoming: OfflineMaterialListMutation,
) {
  const nextQueue = [...queue];

  if (incoming.type === "updateItemQuantity") {
    const existingIndex = nextQueue.findIndex(
      (item) =>
        item.type === "updateItemQuantity" &&
        item.materialListId === incoming.materialListId &&
        item.itemId === incoming.itemId,
    );

    if (existingIndex >= 0) {
      nextQueue[existingIndex] = incoming;
      return nextQueue;
    }
  }

  if (incoming.type === "updateItemSupplierPart") {
    const existingIndex = nextQueue.findIndex(
      (item) =>
        item.type === "updateItemSupplierPart" &&
        item.materialListId === incoming.materialListId &&
        item.itemId === incoming.itemId,
    );

    if (existingIndex >= 0) {
      nextQueue[existingIndex] = incoming;
      return nextQueue;
    }
  }

  if (incoming.type === "renameMaterialList") {
    const existingIndex = nextQueue.findIndex(
      (item) =>
        item.type === "renameMaterialList" &&
        item.materialListId === incoming.materialListId,
    );

    if (existingIndex >= 0) {
      nextQueue[existingIndex] = incoming;
      return nextQueue;
    }
  }

  if (incoming.type === "removeItem") {
    const addIndex = nextQueue.findIndex(
      (item) =>
        item.type === "addItem" &&
        item.materialListId === incoming.materialListId &&
        item.localItemId === incoming.itemId,
    );

    if (addIndex >= 0) {
      return nextQueue.filter(
        (item, index) =>
          index !== addIndex &&
          !(
            (item.type === "updateItemQuantity" || item.type === "updateItemSupplierPart") &&
            item.materialListId === incoming.materialListId &&
            item.itemId === incoming.itemId
          ),
      );
    }
  }

  nextQueue.push(incoming);
  return nextQueue;
}

function recalculateMaterialTotal(record: OfflineMaterialListRecord) {
  return record.items.reduce((sum, item) => {
    const price = item.extendedPrice ? parseFloat(item.extendedPrice) : 0;
    return sum + price;
  }, 0);
}

export function applyOfflineQuantityUpdate(
  materialListId: string,
  itemId: string,
  quantity: number,
) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => {
      const items = current.items.map((item) => {
        if (item.id !== itemId) return item;

        const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
        const extendedPrice = (quantity * unitCost).toString();

        return {
          ...item,
          quantity: quantity.toString(),
          extendedPrice,
        };
      });

      const next = {
        ...current,
        items,
      };

      return {
        ...next,
        materialTotal: recalculateMaterialTotal(next),
      };
    },
    { pendingSync: true },
  );
}

export function applyOfflineAddItem(
  materialListId: string,
  item: {
    localItemId: string;
    quantity: number;
    unitCost?: number;
    oneOffDisplayName?: string;
    oneOffDescription?: string;
    oneOffMaterial?: string;
    oneOffSizeNominal?: number;
    oneOffSizeUnitId?: string;
    partDefinitionSnapshot?: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
    supplierPartSnapshot?: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
  },
) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => {
      const unitCost = item.unitCost ?? 0;
      const extendedPrice = item.quantity * unitCost;

      const next = {
        ...current,
        items: [
          ...current.items,
          {
            id: item.localItemId,
            quantity: item.quantity.toString(),
            unitCost: unitCost.toString(),
            extendedPrice: extendedPrice.toString(),
            descriptionSnapshot:
              item.partDefinitionSnapshot?.displayName ?? item.oneOffDisplayName ?? null,
            partDefinition: item.partDefinitionSnapshot
              ? {
                  id: item.partDefinitionSnapshot.id,
                  displayName: item.partDefinitionSnapshot.displayName,
                  imageUrl: item.partDefinitionSnapshot.imageUrl,
                  material: item.partDefinitionSnapshot.material,
                }
              : null,
            supplierPart: item.supplierPartSnapshot
              ? {
                  id: item.supplierPartSnapshot.id,
                  supplierId: item.supplierPartSnapshot.supplierId,
                  supplierSku: item.supplierPartSnapshot.supplierSku,
                  lastKnownUnitCost: item.supplierPartSnapshot.lastKnownUnitCost,
                  supplier: item.supplierPartSnapshot.supplier,
                }
              : null,
            uom: null,
            oneOff: item.oneOffDisplayName
              ? {
                  displayName: item.oneOffDisplayName,
                  description: item.oneOffDescription ?? null,
                  material: item.oneOffMaterial ?? null,
                  sizeNominal:
                    item.oneOffSizeNominal !== undefined
                      ? item.oneOffSizeNominal.toString()
                      : null,
                  sizeUnitId: item.oneOffSizeUnitId ?? null,
                }
              : null,
          },
        ],
      };

      return {
        ...next,
        materialTotal: recalculateMaterialTotal(next),
      };
    },
    { pendingSync: true },
  );
}

export function applyOfflineRemoveItem(materialListId: string, itemId: string) {
  return (async () => {
    const existing = await getOfflineMaterialList(materialListId);
    if (!existing) return null;

    const pendingDeletedItemIds = new Set(existing.pendingDeletedItemIds ?? []);
    pendingDeletedItemIds.add(itemId);

    const next = {
      ...existing.data,
      items: existing.data.items.filter((item) => item.id !== itemId),
    };

    const nextData = {
      ...next,
      materialTotal: recalculateMaterialTotal(next),
    };

    await setOfflineMaterialList(materialListId, nextData, {
      pendingSync: true,
      pendingDeletedItemIds: Array.from(pendingDeletedItemIds),
    });

    return nextData;
  })();
}

export function applyOfflineSupplierPartUpdate(
  materialListId: string,
  itemId: string,
  supplierPart: {
    supplierPartId: string | null;
    supplierId?: string | null;
    unitCost: number | null;
    supplierPartSnapshot: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
  },
) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => {
      const items = current.items.map((item) => {
        if (item.id !== itemId) return item;

        const nextUnitCost = supplierPart.unitCost ?? 0;
        const nextQuantity = parseFloat(item.quantity);
        const nextExtendedPrice = nextQuantity * nextUnitCost;

        return {
          ...item,
          unitCost: nextUnitCost.toString(),
          extendedPrice: nextExtendedPrice.toString(),
          selectedSupplierId:
            supplierPart.supplierId ??
            supplierPart.supplierPartSnapshot?.supplierId ??
            null,
          supplierPart: supplierPart.supplierPartSnapshot
            ? {
                id: supplierPart.supplierPartSnapshot.id,
                supplierId: supplierPart.supplierPartSnapshot.supplierId,
                supplierSku: supplierPart.supplierPartSnapshot.supplierSku,
                lastKnownUnitCost: supplierPart.supplierPartSnapshot.lastKnownUnitCost,
                supplier: supplierPart.supplierPartSnapshot.supplier,
              }
            : null,
        };
      });

      const next = {
        ...current,
        items,
      };

      return {
        ...next,
        materialTotal: recalculateMaterialTotal(next),
      };
    },
    { pendingSync: true },
  );
}

export function applyOfflineRenameMaterialList(
  materialListId: string,
  name: string,
) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => ({
      ...current,
      materialList: {
        ...current.materialList,
        name,
      },
    }),
    { pendingSync: true },
  );
}
