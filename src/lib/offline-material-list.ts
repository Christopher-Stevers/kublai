import {
  idbDeleteMaterialList,
  idbGetMaterialList,
  idbGetMaterialListIds,
  idbSetMaterialList,
} from "~/lib/offline-indexed-db";

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
            await idbSetMaterialList(materialListId, JSON.parse(raw) as OfflineMaterialListEnvelope);
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
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(legacyStorageKey(materialListId));
  }
}

export async function getOfflineMaterialListIds(): Promise<string[]> {
  await migrateLegacyMaterialLists();
  return idbGetMaterialListIds();
}
