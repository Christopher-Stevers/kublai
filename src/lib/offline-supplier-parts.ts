export interface OfflineSupplierPartOption {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  isPreferred: boolean;
  supplier: {
    id: string;
    name: string;
  };
}

interface OfflineSupplierPartsEnvelope {
  version: 1;
  updatedAt: string;
  data: Record<string, OfflineSupplierPartOption[]>;
}

const STORAGE_KEY = "foremanhq.offline.supplier-parts-by-part";

export function getOfflineSupplierPartsByPart(partDefinitionId: string) {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const envelope = JSON.parse(raw) as OfflineSupplierPartsEnvelope;
    return envelope.data[partDefinitionId] ?? null;
  } catch {
    return null;
  }
}

export function setOfflineSupplierPartsByPart(
  partDefinitionId: string,
  supplierParts: OfflineSupplierPartOption[],
) {
  if (typeof window === "undefined") return;

  let data: Record<string, OfflineSupplierPartOption[]> = {};
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (raw) {
    try {
      data = (JSON.parse(raw) as OfflineSupplierPartsEnvelope).data ?? {};
    } catch {
      data = {};
    }
  }

  data[partDefinitionId] = supplierParts;

  const envelope: OfflineSupplierPartsEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}
