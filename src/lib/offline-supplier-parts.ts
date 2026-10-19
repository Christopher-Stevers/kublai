export interface OfflineSupplierPartOption {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  packSize?: string | null;
  isPreferred: boolean;
  supplier: {
    id: string;
    name: string;
  };
}

interface OfflineSupplierPartsEnvelope {
  version: 2;
  updatedAt: string;
  data: Record<string, OfflineSupplierPartOption[]>;
}

const STORAGE_KEY = "foremanhq.offline.supplier-parts-by-part";

let cachedData: OfflineSupplierPartsEnvelope["data"] | undefined;
let listening = false;
function readData() {
  if (typeof window === "undefined") return {};
  if (!listening) {
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY || event.key === null)
        cachedData = undefined;
    });
    listening = true;
  }
  if (cachedData) return cachedData;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const envelope = raw
      ? (JSON.parse(raw) as OfflineSupplierPartsEnvelope)
      : null;
    cachedData =
      envelope?.version === 2 &&
      envelope.data &&
      typeof envelope.data === "object"
        ? envelope.data
        : {};
  } catch {
    cachedData = {};
  }
  return cachedData;
}

export function getOfflineSupplierPartsByPart(partDefinitionId: string) {
  return readData()[partDefinitionId] ?? null;
}
export function setOfflineSupplierPartsByPart(
  partDefinitionId: string,
  supplierParts: OfflineSupplierPartOption[],
) {
  if (typeof window === "undefined") return;
  const data = readData();
  data[partDefinitionId] = supplierParts;
  cachedData = data;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), data }),
    );
  } catch {
    /* Keep the session cache usable when persistent storage is unavailable. */
  }
}
