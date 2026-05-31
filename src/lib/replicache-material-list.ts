import { Replicache, dropDatabase, type WriteTransaction } from "replicache";

import { MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";

// ---------------------------------------------------------------------------
// Mutator type definitions
// ---------------------------------------------------------------------------

export type MaterialListReplicacheMutators = {
  // Material list operations
  renameMaterialList(
    tx: WriteTransaction,
    args: { materialListId: string; name: string },
  ): Promise<void>;
  updateItemQuantity(
    tx: WriteTransaction,
    args: { materialListId: string; itemId: string; quantity: number },
  ): Promise<void>;
  removeItem(
    tx: WriteTransaction,
    args: { materialListId: string; itemId: string },
  ): Promise<void>;
  addItem(
    tx: WriteTransaction,
    args: {
      materialListId: string;
      itemId: string;
      partDefinitionId?: string | null;
      supplierPartId?: string | null;
      supplierId?: string | null;
      quantity: number;
      unitCost?: number | null;
      descriptionSnapshot?: string | null;
      // Snapshot data for optimistic display
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
        supplier: { id: string; name: string } | null;
      } | null;
    },
  ): Promise<void>;
  updateItemSupplierPart(
    tx: WriteTransaction,
    args: {
      itemId: string;
      materialListId?: string;
      supplierPartId: string | null;
      supplierId: string | null;
      unitCost?: number | null;
    },
  ): Promise<void>;

  // Job operations
  createJob(
    tx: WriteTransaction,
    args: { jobId: string; name: string; locationId?: string | null },
  ): Promise<void>;
  updateJob(
    tx: WriteTransaction,
    args: {
      jobId: string;
      name?: string;
      locationId?: string | null;
      foremanName?: string | null;
      poNumber?: string | null;
    },
  ): Promise<void>;
  deleteJob(tx: WriteTransaction, args: { jobId: string }): Promise<void>;

  // Material list CRUD
  createMaterialList(
    tx: WriteTransaction,
    args: { materialListId: string; jobId: string; name: string },
  ): Promise<void>;
  deleteMaterialList(
    tx: WriteTransaction,
    args: { materialListId: string },
  ): Promise<void>;

  // Supplier operations
  createSupplier(
    tx: WriteTransaction,
    args: {
      supplierId: string;
      name: string;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      orderingNotes?: string | null;
      locationId?: string | null;
    },
  ): Promise<void>;
  updateSupplier(
    tx: WriteTransaction,
    args: {
      supplierId: string;
      name?: string;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      orderingNotes?: string | null;
      locationId?: string | null;
    },
  ): Promise<void>;
  deleteSupplier(tx: WriteTransaction, args: { supplierId: string }): Promise<void>;
};

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let materialListReplicache: Replicache<MaterialListReplicacheMutators> | null = null;
let materialListReplicacheResetting = false;
let materialListReplicacheClosing = false;
let materialListReplicacheSyncTimer: ReturnType<typeof setTimeout> | null = null;
let materialListReplicacheSyncInFlight = false;
let materialListReplicacheSyncRequested: "none" | "pull" | "push-pull" = "none";
let materialListReplicacheScheduledMode: "pull" | "push-pull" = "pull";

function mergeSyncMode(
  current: "none" | "pull" | "push-pull",
  next: "pull" | "push-pull",
) {
  return current === "push-pull" || next === "push-pull" ? "push-pull" : "pull";
}

function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("Replicache material-list sync is browser-only");
  }
}

function isReplicacheClosedError(error: unknown) {
  return error instanceof Error && error.message === "Closed";
}

export async function resetMaterialListReplicacheStorage() {
  if (materialListReplicacheResetting) return;
  materialListReplicacheResetting = true;

  if (materialListReplicacheSyncTimer) {
    clearTimeout(materialListReplicacheSyncTimer);
    materialListReplicacheSyncTimer = null;
  }
  materialListReplicacheSyncRequested = "none";
  materialListReplicacheScheduledMode = "pull";

  const staleReplicache = materialListReplicache;
  const staleDbName = staleReplicache?.idbName;

  materialListReplicache = null;
  materialListReplicacheClosing = true;
  try {
    await staleReplicache?.close();
  } catch (error) {
    if (!isReplicacheClosedError(error)) throw error;
  } finally {
    materialListReplicacheClosing = false;
  }

  if (staleDbName) await dropDatabase(staleDbName);

  window.location.reload();
}

export function getMaterialListReplicache() {
  assertBrowser();
  if (materialListReplicache) return materialListReplicache;

  const replicache = new Replicache<MaterialListReplicacheMutators>({
    name: "foremenhq-material-lists",
    schemaVersion: MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION,
    pullURL: "/api/replicache/material-lists/pull",
    pushURL: "/api/replicache/material-lists/push",
    // SSE pokes, online/visibility handlers, and user mutations request immediate
    // sync. Keep polling as a low-frequency safety net instead of a competing
    // foreground refresh loop.
    pullInterval: 60_000,
    pushDelay: 250,
    requestOptions: {
      minDelayMs: 100,
      maxDelayMs: 2_000,
    },
    mutators: {
      // -----------------------------------------------------------------
      // Material list operations
      // -----------------------------------------------------------------
      async renameMaterialList(tx, args) {
        const existing = await tx.get(`materialList/${args.materialListId}`);
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
        await tx.put(`materialList/${args.materialListId}`, {
          ...existing,
          name: args.name,
          pendingSync: true,
        });
      },

      async updateItemQuantity(tx, args) {
        const existing = await tx.get(`materialListItem/${args.itemId}`);
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
        const unitCost = Number("unitCost" in existing ? existing.unitCost : 0);
        const extendedPrice = args.quantity * (Number.isFinite(unitCost) ? unitCost : 0);
        await tx.put(`materialListItem/${args.itemId}`, {
          ...existing,
          materialListId: args.materialListId,
          quantity: String(args.quantity),
          extendedPrice: String(extendedPrice),
          pendingSync: true,
        });
      },

      async removeItem(tx, args) {
        await tx.del(`materialListItem/${args.itemId}`);
        await tx.put(`materialListItemTombstone/${args.itemId}`, {
          itemId: args.itemId,
          materialListId: args.materialListId,
          pendingSync: true,
          deletedAt: new Date().toISOString(),
        });
      },

      async addItem(tx, args) {
        const unitCost = args.unitCost ?? 0;
        const extendedPrice = args.quantity * (Number.isFinite(unitCost) ? unitCost : 0);
        await tx.put(`materialListItem/${args.itemId}`, {
          id: args.itemId,
          materialListId: args.materialListId,
          quoteId: null,
          partDefinitionId: args.partDefinitionId ?? null,
          supplierPartId: args.supplierPartId ?? null,
          supplierId: args.supplierId ?? null,
          quantity: String(args.quantity),
          unitCost: String(unitCost),
          extendedPrice: String(extendedPrice),
          descriptionSnapshot: args.descriptionSnapshot ?? null,
          // Snapshot fields for optimistic display in UI
          partDefinition: args.partDefinitionSnapshot ?? null,
          supplierPart: args.supplierPartSnapshot ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pendingSync: true,
        });
      },

      async updateItemSupplierPart(tx, args) {
        const existing = await tx.get(`materialListItem/${args.itemId}`);
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
        const quantity = Number("quantity" in existing ? existing.quantity : 0);
        const unitCost = args.unitCost ?? 0;
        const extendedPrice = (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitCost) ? unitCost : 0);
        await tx.put(`materialListItem/${args.itemId}`, {
          ...existing,
          supplierPartId: args.supplierPartId,
          supplierId: args.supplierId,
          unitCost: String(unitCost),
          extendedPrice: String(extendedPrice),
          pendingSync: true,
        });
      },

      // -----------------------------------------------------------------
      // Job operations
      // -----------------------------------------------------------------
      async createJob(tx, args) {
        await tx.put(`job/${args.jobId}`, {
          id: args.jobId,
          name: args.name,
          locationId: args.locationId ?? null,
          status: "draft",
          foremanName: null,
          poNumber: null,
          location: null,
          createdAt: new Date().toISOString(),
          pendingSync: true,
        });
      },

      async updateJob(tx, args) {
        const existing = await tx.get(`job/${args.jobId}`);
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
        await tx.put(`job/${args.jobId}`, {
          ...existing,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...("locationId" in args ? { locationId: args.locationId ?? null } : {}),
          ...("foremanName" in args ? { foremanName: args.foremanName ?? null } : {}),
          ...("poNumber" in args ? { poNumber: args.poNumber ?? null } : {}),
          pendingSync: true,
        });
      },

      async deleteJob(tx, args) {
        // Delete all material lists and items for this job
        const allEntries = await tx.scan({ prefix: "materialList/" }).entries().toArray();
        const itemEntries = await tx.scan({ prefix: "materialListItem/" }).entries().toArray();
        for (const [key, value] of allEntries) {
          if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            "jobId" in value &&
            value.jobId === args.jobId
          ) {
            const mlId = (value as { id?: string }).id;
            if (mlId) {
              for (const [itemKey, itemValue] of itemEntries) {
                if (
                  itemValue &&
                  typeof itemValue === "object" &&
                  !Array.isArray(itemValue) &&
                  "materialListId" in itemValue &&
                  itemValue.materialListId === mlId
                ) {
                  await tx.del(itemKey);
                }
              }
            }
            await tx.del(key);
          }
        }
        await tx.del(`job/${args.jobId}`);
      },

      // -----------------------------------------------------------------
      // Material list CRUD
      // -----------------------------------------------------------------
      async createMaterialList(tx, args) {
        await tx.put(`materialList/${args.materialListId}`, {
          id: args.materialListId,
          name: args.name,
          jobId: args.jobId,
          quoteId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pendingSync: true,
        });
      },

      async deleteMaterialList(tx, args) {
        // Delete all items for this material list
        const itemEntries = await tx.scan({ prefix: "materialListItem/" }).entries().toArray();
        for (const [key, value] of itemEntries) {
          if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            "materialListId" in value &&
            value.materialListId === args.materialListId
          ) {
            await tx.del(key);
          }
        }
        await tx.del(`materialList/${args.materialListId}`);
      },

      // -----------------------------------------------------------------
      // Supplier operations
      // -----------------------------------------------------------------
      async createSupplier(tx, args) {
        await tx.put(`supplier/${args.supplierId}`, {
          id: args.supplierId,
          name: args.name,
          contactName: args.contactName ?? null,
          contactEmail: args.contactEmail ?? null,
          contactPhone: args.contactPhone ?? null,
          orderingNotes: args.orderingNotes ?? null,
          locationId: args.locationId ?? null,
          createdAt: new Date().toISOString(),
          pendingSync: true,
        });
      },

      async updateSupplier(tx, args) {
        const existing = await tx.get(`supplier/${args.supplierId}`);
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
        await tx.put(`supplier/${args.supplierId}`, {
          ...existing,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...("contactName" in args ? { contactName: args.contactName ?? null } : {}),
          ...("contactEmail" in args ? { contactEmail: args.contactEmail ?? null } : {}),
          ...("contactPhone" in args ? { contactPhone: args.contactPhone ?? null } : {}),
          ...("orderingNotes" in args ? { orderingNotes: args.orderingNotes ?? null } : {}),
          ...("locationId" in args ? { locationId: args.locationId ?? null } : {}),
          pendingSync: true,
        });
      },

      async deleteSupplier(tx, args) {
        await tx.del(`supplier/${args.supplierId}`);
      },
    },
  });

  replicache.onClientStateNotFound = () => {
    void resetMaterialListReplicacheStorage();
  };

  materialListReplicache = replicache;

  return materialListReplicache;
}

export function tryGetMaterialListReplicache() {
  if (typeof window === "undefined") return null;
  try {
    return getMaterialListReplicache();
  } catch (error) {
    console.error("Failed to initialize Replicache material-list sync", error);
    return null;
  }
}

async function flushMaterialListReplicacheNow(mode: "pull" | "push-pull") {
  if (materialListReplicacheClosing) return;
  if (materialListReplicacheSyncInFlight) {
    materialListReplicacheSyncRequested = mergeSyncMode(
      materialListReplicacheSyncRequested,
      mode,
    );
    return;
  }

  materialListReplicacheSyncInFlight = true;
  const replicache = getMaterialListReplicache();
  try {
    if (mode === "push-pull") {
      await replicache.push({ now: true });
    }
    await replicache.pull({ now: true });
  } catch (error) {
    // Replicache keeps its own retry/backoff. This helper is latency sugar, not
    // the source of durability, so don't throw into UI event handlers. A close
    // during route teardown/React StrictMode is expected and should not be
    // reported as a sync failure.
    if (!isReplicacheClosedError(error)) {
      console.error("Immediate Replicache sync failed", error);
    }
  } finally {
    materialListReplicacheSyncInFlight = false;
    if (materialListReplicacheSyncRequested !== "none") {
      const requestedMode = materialListReplicacheSyncRequested;
      materialListReplicacheSyncRequested = "none";
      requestMaterialListReplicacheSync(0, requestedMode);
    }
  }
}

export function requestMaterialListReplicacheSync(
  delayMs = 50,
  mode: "pull" | "push-pull" = "push-pull",
) {
  assertBrowser();
  materialListReplicacheScheduledMode = mergeSyncMode(
    materialListReplicacheScheduledMode,
    mode,
  );
  if (materialListReplicacheSyncTimer) {
    clearTimeout(materialListReplicacheSyncTimer);
  }
  materialListReplicacheSyncTimer = setTimeout(() => {
    const scheduledMode = materialListReplicacheScheduledMode;
    materialListReplicacheScheduledMode = "pull";
    materialListReplicacheSyncTimer = null;
    void flushMaterialListReplicacheNow(scheduledMode);
  }, delayMs);
}

export function requestMaterialListReplicachePull(delayMs = 0) {
  requestMaterialListReplicacheSync(delayMs, "pull");
}

export async function mutateMaterialListAndSync<T>(mutation: Promise<T>) {
  try {
    return await mutation;
  } finally {
    requestMaterialListReplicacheSync(0, "push-pull");
  }
}

export async function closeMaterialListReplicache() {
  if (materialListReplicacheSyncTimer) {
    clearTimeout(materialListReplicacheSyncTimer);
    materialListReplicacheSyncTimer = null;
  }
  materialListReplicacheSyncRequested = "none";
  materialListReplicacheScheduledMode = "pull";

  const replicache = materialListReplicache;
  materialListReplicache = null;
  if (!replicache) return;

  materialListReplicacheClosing = true;
  try {
    await replicache.close();
  } catch (error) {
    if (!isReplicacheClosedError(error)) throw error;
  } finally {
    materialListReplicacheClosing = false;
  }
}
