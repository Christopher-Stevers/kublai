export interface OfflineMaterialListItem {
  id: string;
  quantity: string;
  unitCost: string | null;
  extendedPrice: string | null;
  descriptionSnapshot: string | null;
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
}

export interface OfflineMaterialListRecord {
  materialList: {
    id: string;
    name: string;
    createdAt?: string | Date;
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
  data: OfflineMaterialListRecord;
}

const STORAGE_PREFIX = "foremanhq.offline.material-list";

function storageKey(materialListId: string) {
  return `${STORAGE_PREFIX}:${materialListId}`;
}

export function getOfflineMaterialList(
  materialListId: string,
): OfflineMaterialListEnvelope | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(storageKey(materialListId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OfflineMaterialListEnvelope;
  } catch {
    return null;
  }
}

export function setOfflineMaterialList(
  materialListId: string,
  data: OfflineMaterialListRecord,
  options?: { pendingSync?: boolean },
) {
  if (typeof window === "undefined") return;

  const envelope: OfflineMaterialListEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pendingSync: options?.pendingSync ?? false,
    data,
  };

  window.localStorage.setItem(storageKey(materialListId), JSON.stringify(envelope));
}

export function patchOfflineMaterialList(
  materialListId: string,
  updater: (current: OfflineMaterialListRecord) => OfflineMaterialListRecord,
  options?: { pendingSync?: boolean },
) {
  const existing = getOfflineMaterialList(materialListId);
  if (!existing) return null;

  const nextData = updater(existing.data);
  setOfflineMaterialList(materialListId, nextData, {
    pendingSync: options?.pendingSync ?? existing.pendingSync,
  });

  return nextData;
}

export function clearOfflineMaterialList(materialListId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(materialListId));
}
