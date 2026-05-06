export interface OfflineSupplier {
  id: string;
  organizationId?: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  orderingNotes: string | null;
  locationId: string | null;
  createdAt: string | Date;
  location: {
    id: string;
    name: string;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
}

export interface OfflineSuppliersEnvelope {
  version: 1;
  updatedAt: string;
  data: OfflineSupplier[];
}

const STORAGE_KEY = "foremanhq.offline.suppliers";

export function getOfflineSuppliers(): OfflineSuppliersEnvelope | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OfflineSuppliersEnvelope;
  } catch {
    return null;
  }
}

export function setOfflineSuppliers(data: OfflineSupplier[]) {
  if (typeof window === "undefined") return;

  const envelope: OfflineSuppliersEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}
