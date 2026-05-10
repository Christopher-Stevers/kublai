import { getOfflineDexieDb } from "~/lib/offline-dexie-db";

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

export type OfflineSupplierMutation =
  | {
      type: "createSupplier";
      localSupplierId: string;
      supplier: OfflineSupplierOption;
      queuedAt: string;
    }
  | {
      type: "updateSupplier";
      supplierId: string;
      updates: SupplierEditableFields;
      queuedAt: string;
    }
  | {
      type: "deleteSupplier";
      supplierId: string;
      queuedAt: string;
    };

type SupplierEditableFields = Pick<
  OfflineSupplierOption,
  "name" | "contactName" | "contactEmail" | "contactPhone" | "orderingNotes" | "locationId"
>;

const STORAGE_KEY = "foremanhq.offline.suppliers";
const QUEUE_KEY = "foremanhq.offline.supplier-queue";
const PART_SUPPLIERS_KEY = "foremanhq.offline.part-suppliers";
export const OFFLINE_SUPPLIERS_EVENT = "foremanhq:offline-suppliers-changed";

function notifyOfflineSuppliersChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OFFLINE_SUPPLIERS_EVENT));
}

function sortSuppliers(suppliers: OfflineSupplierOption[]) {
  return [...suppliers].sort((a, b) => a.name.localeCompare(b.name));
}

async function writeSuppliersToDexie(suppliers: OfflineSupplierOption[]) {
  const db = getOfflineDexieDb();
  if (!db) return;
  const updatedAt = new Date().toISOString();
  await db.transaction("rw", db.suppliers, async () => {
    const existingIds = new Set((await db.suppliers.toArray()).map((row) => row.id));
    const nextIds = new Set(suppliers.map((supplier) => supplier.id));
    const removedIds = [...existingIds].filter((id) => !nextIds.has(id));
    if (removedIds.length > 0) await db.suppliers.bulkDelete(removedIds);
    await db.suppliers.bulkPut(
      suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        locationId: supplier.locationId ?? null,
        updatedAt,
        value: supplier,
      })),
    );
  });
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
  void writeSuppliersToDexie(envelope.data);
  notifyOfflineSuppliersChanged();
}

export function getOfflineSupplierMutationQueue(): OfflineSupplierMutation[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OfflineSupplierMutation[];
  } catch {
    return [];
  }
}

export function setOfflineSupplierMutationQueue(queue: OfflineSupplierMutation[]) {
  if (typeof window === "undefined") return;
  if (queue.length === 0) {
    window.localStorage.removeItem(QUEUE_KEY);
  } else {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
  notifyOfflineSuppliersChanged();
}

function enqueueSupplierMutation(mutation: OfflineSupplierMutation) {
  const queue = getOfflineSupplierMutationQueue();

  if (mutation.type === "updateSupplier") {
    const createIndex = queue.findIndex(
      (item) => item.type === "createSupplier" && item.localSupplierId === mutation.supplierId,
    );
    if (createIndex >= 0) {
      const createMutation = queue[createIndex];
      if (createMutation?.type === "createSupplier") {
        queue[createIndex] = {
          ...createMutation,
          supplier: { ...createMutation.supplier, ...mutation.updates },
        };
        setOfflineSupplierMutationQueue(queue);
        return;
      }
    }

    const updateIndex = queue.findIndex(
      (item) => item.type === "updateSupplier" && item.supplierId === mutation.supplierId,
    );
    if (updateIndex >= 0) {
      const existing = queue[updateIndex];
      if (existing?.type === "updateSupplier") {
        queue[updateIndex] = {
          ...existing,
          updates: { ...existing.updates, ...mutation.updates },
          queuedAt: mutation.queuedAt,
        };
        setOfflineSupplierMutationQueue(queue);
        return;
      }
    }
  }

  if (mutation.type === "deleteSupplier") {
    const createIndex = queue.findIndex(
      (item) => item.type === "createSupplier" && item.localSupplierId === mutation.supplierId,
    );
    if (createIndex >= 0) {
      setOfflineSupplierMutationQueue(
        queue.filter(
          (item, index) =>
            index !== createIndex &&
            !(item.type === "updateSupplier" && item.supplierId === mutation.supplierId),
        ),
      );
      return;
    }

    setOfflineSupplierMutationQueue([
      ...queue.filter(
        (item) =>
          !(item.type === "updateSupplier" && item.supplierId === mutation.supplierId) &&
          !(item.type === "deleteSupplier" && item.supplierId === mutation.supplierId),
      ),
      mutation,
    ]);
    return;
  }

  setOfflineSupplierMutationQueue([...queue, mutation]);
}

export function createOfflineSupplier(fields: SupplierEditableFields) {
  const now = new Date().toISOString();
  const supplier: OfflineSupplierOption = {
    id: `offline-supplier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: fields.name,
    contactName: fields.contactName ?? null,
    contactEmail: fields.contactEmail ?? null,
    contactPhone: fields.contactPhone ?? null,
    orderingNotes: fields.orderingNotes ?? null,
    locationId: fields.locationId ?? null,
    location: null,
  };

  setOfflineSuppliers([supplier, ...(getOfflineSuppliers() ?? [])]);
  enqueueSupplierMutation({
    type: "createSupplier",
    localSupplierId: supplier.id,
    supplier,
    queuedAt: now,
  });
  return supplier;
}

export function updateOfflineSupplier(supplierId: string, updates: SupplierEditableFields) {
  setOfflineSuppliers(
    (getOfflineSuppliers() ?? []).map((supplier) =>
      supplier.id === supplierId
        ? {
            ...supplier,
            ...updates,
            contactName: updates.contactName ?? null,
            contactEmail: updates.contactEmail ?? null,
            contactPhone: updates.contactPhone ?? null,
            orderingNotes: updates.orderingNotes ?? null,
            locationId: updates.locationId ?? null,
          }
        : supplier,
    ),
  );
  enqueueSupplierMutation({
    type: "updateSupplier",
    supplierId,
    updates,
    queuedAt: new Date().toISOString(),
  });
}

export function tombstoneOfflineSupplier(supplierId: string) {
  setOfflineSuppliers((getOfflineSuppliers() ?? []).filter((supplier) => supplier.id !== supplierId));
  enqueueSupplierMutation({
    type: "deleteSupplier",
    supplierId,
    queuedAt: new Date().toISOString(),
  });
}

export function remapOfflineSupplierId(localSupplierId: string, serverSupplier: OfflineSupplierOption) {
  setOfflineSuppliers(
    (getOfflineSuppliers() ?? []).map((supplier) =>
      supplier.id === localSupplierId ? { ...supplier, ...serverSupplier, id: serverSupplier.id } : supplier,
    ),
  );
  setOfflineSupplierMutationQueue(
    getOfflineSupplierMutationQueue().map((mutation) => {
      if (mutation.type === "updateSupplier" && mutation.supplierId === localSupplierId) {
        return { ...mutation, supplierId: serverSupplier.id };
      }
      if (mutation.type === "deleteSupplier" && mutation.supplierId === localSupplierId) {
        return { ...mutation, supplierId: serverSupplier.id };
      }
      return mutation;
    }),
  );
}

function getOfflinePartSuppliersMap() {
  if (typeof window === "undefined") return {} as Record<string, OfflinePartSupplier[]>;
  const raw = window.localStorage.getItem(PART_SUPPLIERS_KEY);
  if (!raw) return {} as Record<string, OfflinePartSupplier[]>;
  try {
    return JSON.parse(raw) as Record<string, OfflinePartSupplier[]>;
  } catch {
    return {} as Record<string, OfflinePartSupplier[]>;
  }
}

function setOfflinePartSuppliersMap(map: Record<string, OfflinePartSupplier[]>) {
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

  setOfflinePartSuppliers(
    partDefinitionId,
    [
      ...existing
        .filter((part) => part.supplierId !== supplier.id)
        .map((part) =>
          nextPart.isPreferred ? { ...part, isPreferred: false } : part,
        ),
      nextPart,
    ],
  );
}

export function removeOfflinePartSupplier(partDefinitionId: string, supplierPartId: string) {
  const existing = getOfflinePartSuppliers(partDefinitionId) ?? [];
  const filtered = existing.filter((part) => part.id !== supplierPartId);
  if (filtered.length === 0) return;
  if (!filtered.some((part) => part.isPreferred)) {
    filtered[0] = { ...filtered[0]!, isPreferred: true };
  }
  setOfflinePartSuppliers(partDefinitionId, filtered);
}

export function setOfflinePreferredSupplier(partDefinitionId: string, supplierId: string) {
  setOfflinePartSuppliers(
    partDefinitionId,
    (getOfflinePartSuppliers(partDefinitionId) ?? []).map((part) => ({
      ...part,
      isPreferred: part.supplierId === supplierId,
    })),
  );
}

export function makeOfflineSupplierPartId(partDefinitionId: string, supplierId: string) {
  return `offline-supplier-part:${partDefinitionId}:${supplierId}`;
}

export function parseOfflineSupplierPartId(supplierPartId: string) {
  const match = /^offline-supplier-part:([^:]+):([^:]+)$/.exec(supplierPartId);
  if (!match?.[1] || !match[2]) return null;
  return { partDefinitionId: match[1], supplierId: match[2] };
}
