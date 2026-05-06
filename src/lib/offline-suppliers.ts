export interface OfflineSupplierOption {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
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

const STORAGE_KEY = "foremanhq.offline.suppliers";

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
    data: suppliers,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export function makeOfflineSupplierPartId(partDefinitionId: string, supplierId: string) {
  return `offline-supplier-part:${partDefinitionId}:${supplierId}`;
}

export function parseOfflineSupplierPartId(supplierPartId: string) {
  const match = /^offline-supplier-part:([^:]+):([^:]+)$/.exec(supplierPartId);
  if (!match?.[1] || !match[2]) return null;
  return { partDefinitionId: match[1], supplierId: match[2] };
}
