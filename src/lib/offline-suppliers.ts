import type { SupplierContact } from "~/lib/supplier-contacts";

export interface OfflineSupplierOption {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contacts?: SupplierContact[] | null;
  orderingNotes?: string | null;
  locationId?: string | null;
  location?: {
    id: string;
    name: string;
    city?: string | null;
    region?: string | null;
  } | null;
}

export type OfflineSupplier = OfflineSupplierOption;

interface OfflineSuppliersEnvelope {
  version: 1;
  updatedAt: string;
  data: OfflineSupplierOption[];
}

export interface OfflinePartSupplier {
  id: string;
  supplierId: string;
  partDefinitionId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  isPreferred: boolean;
  supplier: {
    id: string;
    name: string;
  };
}

const STORAGE_KEY = "foremanhq.offline.suppliers";
const PART_SUPPLIERS_KEY = "foremanhq.offline.part-suppliers";
export const OFFLINE_SUPPLIERS_EVENT = "foremanhq:offline-suppliers-changed";

function notifyOfflineSuppliersChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OFFLINE_SUPPLIERS_EVENT));
}

function sortSuppliers(suppliers: OfflineSupplierOption[]) {
  return [...suppliers].sort((a, b) => a.name.localeCompare(b.name));
}

export function getOfflineSuppliers() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return (JSON.parse(raw) as OfflineSuppliersEnvelope).data ?? null;
  } catch {
    return null;
  }
}

export function setOfflineSuppliers(suppliers: OfflineSupplierOption[]) {
  if (typeof window === "undefined") return;

  const envelope: OfflineSuppliersEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data: sortSuppliers(suppliers),
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  notifyOfflineSuppliersChanged();
}

function getOfflinePartSuppliersMap() {
  if (typeof window === "undefined")
    return {} as Record<string, OfflinePartSupplier[]>;
  const raw = window.localStorage.getItem(PART_SUPPLIERS_KEY);
  if (!raw) return {} as Record<string, OfflinePartSupplier[]>;
  try {
    return JSON.parse(raw) as Record<string, OfflinePartSupplier[]>;
  } catch {
    return {} as Record<string, OfflinePartSupplier[]>;
  }
}

function setOfflinePartSuppliersMap(
  map: Record<string, OfflinePartSupplier[]>,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PART_SUPPLIERS_KEY, JSON.stringify(map));
  notifyOfflineSuppliersChanged();
}

export function getOfflinePartSuppliers(partDefinitionId: string) {
  return getOfflinePartSuppliersMap()[partDefinitionId] ?? null;
}

export function setOfflinePartSuppliers(
  partDefinitionId: string,
  supplierParts: OfflinePartSupplier[],
) {
  setOfflinePartSuppliersMap({
    ...getOfflinePartSuppliersMap(),
    [partDefinitionId]: supplierParts,
  });
}

export function addOfflinePartSupplier(
  partDefinitionId: string,
  supplier: Pick<OfflineSupplierOption, "id" | "name">,
  options?: { isPreferred?: boolean; supplierSku?: string | null },
) {
  const existing = getOfflinePartSuppliers(partDefinitionId) ?? [];
  const nextPart: OfflinePartSupplier = {
    id: makeOfflineSupplierPartId(partDefinitionId, supplier.id),
    supplierId: supplier.id,
    partDefinitionId,
    supplierSku: options?.supplierSku ?? null,
    lastKnownUnitCost: null,
    isPreferred: options?.isPreferred ?? existing.length === 0,
    supplier: { id: supplier.id, name: supplier.name },
  };

  setOfflinePartSuppliers(partDefinitionId, [
    ...existing
      .filter((part) => part.supplierId !== supplier.id)
      .map((part) =>
        nextPart.isPreferred ? { ...part, isPreferred: false } : part,
      ),
    nextPart,
  ]);
}

export function removeOfflinePartSupplier(
  partDefinitionId: string,
  supplierPartId: string,
) {
  const existing = getOfflinePartSuppliers(partDefinitionId) ?? [];
  const filtered = existing.filter((part) => part.id !== supplierPartId);
  if (filtered.length === 0) return;
  if (!filtered.some((part) => part.isPreferred)) {
    filtered[0] = { ...filtered[0]!, isPreferred: true };
  }
  setOfflinePartSuppliers(partDefinitionId, filtered);
}

export function setOfflinePreferredSupplier(
  partDefinitionId: string,
  supplierId: string,
) {
  setOfflinePartSuppliers(
    partDefinitionId,
    (getOfflinePartSuppliers(partDefinitionId) ?? []).map((part) => ({
      ...part,
      isPreferred: part.supplierId === supplierId,
    })),
  );
}

export function makeOfflineSupplierPartId(
  partDefinitionId: string,
  supplierId: string,
) {
  return `offline-supplier-part:${partDefinitionId}:${supplierId}`;
}

export function parseOfflineSupplierPartId(supplierPartId: string) {
  const match = /^offline-supplier-part:([^:]+):([^:]+)$/.exec(supplierPartId);
  if (!match?.[1] || !match[2]) return null;
  return { partDefinitionId: match[1], supplierId: match[2] };
}
