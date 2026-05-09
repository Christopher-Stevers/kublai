import {
  idbDeleteMaterialList,
  idbGetMaterialList,
  idbGetMaterialListIds,
  idbSetMaterialList,
} from "~/lib/offline-indexed-db";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";

export interface OfflineMaterialListItem {
  id: string;
  quantity: string;
  unitCost: string | null;
  extendedPrice: string | null;
  descriptionSnapshot: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  syncVersion?: string | null;
  partDefinition: {
    id: string;
    displayName: string | null;
    imageUrl: string | null;
    material: string | null;
  } | null;
  supplierPart: {
    id: string;
    supplierId: string | null;
    supplierSku: string | null;
    lastKnownUnitCost: string | null;
    supplier: {
      id: string;
      name: string | null;
    } | null;
  } | null;
  uom: {
    id: string;
    code: string | null;
    displayName: string | null;
  } | null;
  oneOff?: {
    displayName: string;
    description: string | null;
    material: string | null;
    sizeNominal: string | null;
    sizeUnitId: string | null;
  } | null;
}

export interface OfflineMaterialListRecord {
  materialList: {
    id: string;
    name: string;
    createdAt?: string | Date;
    updatedAt?: string | Date;
    syncVersion?: string | null;
  };
  job: {
    id: string;
    name: string;
    locationId?: string | null;
    foremanUserId?: string | null;
    status?: string | null;
    location?: {
      id: string;
      name: string;
    } | null;
    foreman?: {
      id: string;
      name: string;
      email?: string;
    } | null;
  };
  quote?: {
    id?: string;
  } | null;
  items: OfflineMaterialListItem[];
  materialTotal: number;
}

export interface OfflineMaterialListEnvelope {
  version: 1;
  updatedAt: string;
  pendingSync: boolean;
  pendingDeletedItemIds?: string[];
  data: OfflineMaterialListRecord;
}

const STORAGE_PREFIX = "foremanhq.offline.material-list";
const OFFLINE_MATERIAL_LIST_SYNC_EVENT = "foremanhq:offline-material-list-sync";
let migratedLegacyLocalStorage = false;

function notifyOfflineMaterialListChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OFFLINE_MATERIAL_LIST_SYNC_EVENT));
}

function legacyStorageKey(materialListId: string) {
  return `${STORAGE_PREFIX}:${materialListId}`;
}

function toIsoString(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function writeNormalizedMaterialListToDexie(envelope: OfflineMaterialListEnvelope) {
  const db = getOfflineDexieDb();
  if (!db) return;

  const data = envelope.data;
  await db.transaction(
    "rw",
    db.materialListHeaders,
    db.materialListItems,
    async () => {
      await db.materialListHeaders.put({
        id: data.materialList.id,
        name: data.materialList.name,
        jobId: data.job.id,
        jobName: data.job.name,
        quoteId: data.quote?.id ?? null,
        materialTotal: data.materialTotal,
        pendingSync: envelope.pendingSync,
        pendingDeletedItemIds: envelope.pendingDeletedItemIds ?? [],
        updatedAt: envelope.updatedAt,
        serverUpdatedAt: toIsoString(data.materialList.updatedAt),
        syncVersion: data.materialList.syncVersion ?? null,
      });

      const existingItems = await db.materialListItems
        .where("materialListId")
        .equals(data.materialList.id)
        .toArray();
      const nextItemIds = new Set(data.items.map((item) => item.id));
      const removedItemIds = existingItems
        .filter((item) => !nextItemIds.has(item.id))
        .map((item) => item.id);

      if (removedItemIds.length > 0) {
        await db.materialListItems.bulkDelete(removedItemIds);
      }

      await db.materialListItems.bulkPut(
        data.items.map((item) => ({
          id: item.id,
          materialListId: data.materialList.id,
          quantity: item.quantity,
          unitCost: item.unitCost,
          extendedPrice: item.extendedPrice,
          descriptionSnapshot: item.descriptionSnapshot,
          partDefinitionId: item.partDefinition?.id ?? null,
          partDefinitionDisplayName: item.partDefinition?.displayName ?? null,
          supplierPartId: item.supplierPart?.id ?? null,
          selectedSupplierId:
            item.supplierPart?.supplierId ??
            (item as { selectedSupplierId?: string | null }).selectedSupplierId ??
            null,
          updatedAt: toIsoString(item.updatedAt),
          syncVersion: item.syncVersion ?? null,
          value: item,
        })),
      );
    },
  );
}

async function migrateLegacyMaterialLists() {
  if (migratedLegacyLocalStorage || typeof window === "undefined") return;
  migratedLegacyLocalStorage = true;

  const migrations: Promise<void>[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(`${STORAGE_PREFIX}:`)) continue;

    const materialListId = key.slice(`${STORAGE_PREFIX}:`.length);
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    migrations.push(
      (async () => {
        try {
          const existing = await idbGetMaterialList<OfflineMaterialListEnvelope>(materialListId);
          if (!existing) {
            const envelope = JSON.parse(raw) as OfflineMaterialListEnvelope;
            await idbSetMaterialList(materialListId, envelope);
            await writeNormalizedMaterialListToDexie(envelope);
          } else {
            await writeNormalizedMaterialListToDexie(existing);
          }
        } catch {
          // Ignore malformed legacy cache entries.
        }
      })(),
    );
  }

  await Promise.all(migrations);
}

export async function getOfflineMaterialList(
  materialListId: string,
): Promise<OfflineMaterialListEnvelope | null> {
  await migrateLegacyMaterialLists();
  return idbGetMaterialList<OfflineMaterialListEnvelope>(materialListId);
}

export async function setOfflineMaterialList(
  materialListId: string,
  data: OfflineMaterialListRecord,
  options?: { pendingSync?: boolean; pendingDeletedItemIds?: string[] },
) {
  const envelope: OfflineMaterialListEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pendingSync: options?.pendingSync ?? false,
    pendingDeletedItemIds: options?.pendingDeletedItemIds ?? [],
    data,
  };

  await idbSetMaterialList(materialListId, envelope);
  await writeNormalizedMaterialListToDexie(envelope);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(legacyStorageKey(materialListId), JSON.stringify(envelope));
  }
  notifyOfflineMaterialListChanged();
}

export async function patchOfflineMaterialList(
  materialListId: string,
  updater: (current: OfflineMaterialListRecord) => OfflineMaterialListRecord,
  options?: { pendingSync?: boolean; pendingDeletedItemIds?: string[] },
) {
  const existing = await getOfflineMaterialList(materialListId);
  if (!existing) return null;

  const nextData = updater(existing.data);
  await setOfflineMaterialList(materialListId, nextData, {
    pendingSync: options?.pendingSync ?? existing.pendingSync,
    pendingDeletedItemIds:
      options?.pendingDeletedItemIds ?? existing.pendingDeletedItemIds ?? [],
  });

  return nextData;
}

export async function clearOfflineMaterialList(materialListId: string) {
  await idbDeleteMaterialList(materialListId);
  const db = getOfflineDexieDb();
  if (db) {
    await db.transaction("rw", db.materialListHeaders, db.materialListItems, async () => {
      await db.materialListHeaders.delete(materialListId);
      const itemIds = await db.materialListItems
        .where("materialListId")
        .equals(materialListId)
        .primaryKeys();
      if (itemIds.length > 0) await db.materialListItems.bulkDelete(itemIds.map(String));
    });
  }
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(legacyStorageKey(materialListId));
  }
}

export async function getOfflineMaterialListIds(): Promise<string[]> {
  await migrateLegacyMaterialLists();
  return idbGetMaterialListIds();
}
