import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  PatchOperation,
  PullRequestV1,
  PullResponseV1,
  PushRequestV1,
} from "replicache";
import { z } from "zod";

import { MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";
import { db } from "~/server/db";
import {
  jobs,
  locations,
  materials,
  materialLists,
  materialListSyncTombstones,
  orderItems,
  orders,
  partDefinitions,
  quoteItems,
  quotes,
  replicacheClientGroups,
  replicacheClients,
  supplierParts,
  suppliers,
  users,
} from "~/server/db/schema";
import {
  publishMaterialListEvent,
  publishOrganizationReplicachePoke,
} from "~/server/material-list-events";
import {
  getNextDefaultMaterialListName,
  isDefaultMaterialListName,
} from "~/server/material-list-names";

type ReplicacheUser = {
  id: string;
  organizationId: string | null;
};

type ReplicacheTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ReplicacheMutationSideEffects = {
  quoteIdsToRecalculate: Set<string>;
  materialListIdsToTouch: Set<string>;
};

export class ReplicacheOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicacheOwnershipError";
  }
}

// ---------------------------------------------------------------------------
// Zod schemas for all mutator args
// ---------------------------------------------------------------------------

const renameMaterialListArgs = z.object({
  materialListId: z.string().uuid(),
  name: z.string().min(1).max(255),
});

const updateItemQuantityArgs = z.object({
  materialListId: z.string().uuid().optional(),
  itemId: z.string().uuid(),
  quantity: z.number().positive(),
});

const removeItemArgs = z.object({
  materialListId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const uuidOrOfflineSupplierPartId = z.union([
  z.string().uuid(),
  z.string().regex(/^offline-supplier-part:[^:]+:[^:]+$/),
]);

function parseOfflineSupplierPartId(value: string | null | undefined) {
  if (!value) return null;
  const match = /^offline-supplier-part:([^:]+):([^:]+)$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { partDefinitionId: match[1], supplierId: match[2] };
}

function isUuid(value: string | null | undefined) {
  return (
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

const addItemArgs = z.object({
  materialListId: z.string().uuid(),
  itemId: z.string().uuid(),
  partDefinitionId: z.string().uuid().nullable().optional(),
  supplierPartId: uuidOrOfflineSupplierPartId.nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive(),
  unitCost: z.number().nullable().optional(),
  descriptionSnapshot: z.string().nullable().optional(),
});

const updateItemSupplierPartArgs = z.object({
  itemId: z.string().uuid(),
  materialListId: z.string().uuid().optional(),
  supplierPartId: uuidOrOfflineSupplierPartId.nullable(),
  supplierId: z.string().uuid().nullable(),
  unitCost: z.number().nullable().optional(),
});

const createJobArgs = z.object({
  jobId: z.string().uuid(),
  name: z.string().min(1).max(255),
  locationId: z.string().uuid().nullable().optional(),
});

const updateJobArgs = z.object({
  jobId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  locationId: z.string().uuid().nullable().optional(),
  foremanName: z.string().max(255).nullable().optional(),
  poNumber: z.string().max(100).nullable().optional(),
});

const deleteJobArgs = z.object({
  jobId: z.string().uuid(),
});

const createMaterialListArgs = z.object({
  materialListId: z.string().uuid(),
  jobId: z.string().uuid(),
  name: z.string().min(1).max(255),
});

const deleteMaterialListArgs = z.object({
  materialListId: z.string().uuid(),
});

const createSupplierArgs = z.object({
  supplierId: z.string().uuid(),
  name: z.string().min(1).max(255),
  contactName: z.string().max(255).nullable().optional(),
  contactEmail: z.string().max(255).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  orderingNotes: z.string().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
});

const updateSupplierArgs = z.object({
  supplierId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  contactName: z.string().max(255).nullable().optional(),
  contactEmail: z.string().max(255).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  orderingNotes: z.string().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
});

const deleteSupplierArgs = z.object({
  supplierId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Replicache bookkeeping helpers
// ---------------------------------------------------------------------------

async function ensureClientGroup(
  tx: ReplicacheTx,
  input: {
    clientGroupId: string;
    organizationId: string;
    userId: string;
    schemaVersion: string;
  },
) {
  const [existing] = await tx
    .select({
      id: replicacheClientGroups.id,
      organizationId: replicacheClientGroups.organizationId,
      userId: replicacheClientGroups.userId,
    })
    .from(replicacheClientGroups)
    .where(eq(replicacheClientGroups.id, input.clientGroupId))
    .limit(1);

  if (existing) {
    if (
      existing.organizationId !== input.organizationId ||
      existing.userId !== input.userId
    ) {
      throw new ReplicacheOwnershipError("Replicache client group ownership mismatch");
    }

    await tx
      .update(replicacheClientGroups)
      .set({ schemaVersion: input.schemaVersion, updatedAt: new Date() })
      .where(eq(replicacheClientGroups.id, input.clientGroupId));
    return;
  }

  await tx
    .insert(replicacheClientGroups)
    .values({
      id: input.clientGroupId,
      organizationId: input.organizationId,
      userId: input.userId,
      schemaVersion: input.schemaVersion,
    })
    .onConflictDoNothing();
}

async function ensureClient(
  tx: ReplicacheTx,
  input: {
    clientId: string;
    clientGroupId: string;
    organizationId: string;
    userId: string;
  },
) {
  const [existing] = await tx
    .select({
      id: replicacheClients.id,
      clientGroupId: replicacheClients.clientGroupId,
      organizationId: replicacheClients.organizationId,
      userId: replicacheClients.userId,
    })
    .from(replicacheClients)
    .where(eq(replicacheClients.id, input.clientId))
    .limit(1);

  if (existing) {
    if (
      existing.clientGroupId !== input.clientGroupId ||
      existing.organizationId !== input.organizationId ||
      existing.userId !== input.userId
    ) {
      throw new ReplicacheOwnershipError("Replicache client ownership mismatch");
    }
    return;
  }

  await tx
    .insert(replicacheClients)
    .values({
      id: input.clientId,
      clientGroupId: input.clientGroupId,
      organizationId: input.organizationId,
      userId: input.userId,
      lastMutationId: 0,
    })
    .onConflictDoNothing();
}

async function getClientLastMutationId(
  tx: ReplicacheTx,
  input: { clientId: string; clientGroupId: string; organizationId: string },
) {
  const [client] = await tx
    .select({ lastMutationId: replicacheClients.lastMutationId })
    .from(replicacheClients)
    .where(
      and(
        eq(replicacheClients.id, input.clientId),
        eq(replicacheClients.clientGroupId, input.clientGroupId),
        eq(replicacheClients.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  return client?.lastMutationId ?? 0;
}

async function setClientLastMutationId(
  tx: ReplicacheTx,
  input: {
    clientId: string;
    clientGroupId: string;
    organizationId: string;
    lastMutationId: number;
  },
) {
  await tx
    .update(replicacheClients)
    .set({ lastMutationId: input.lastMutationId, updatedAt: new Date() })
    .where(
      and(
        eq(replicacheClients.id, input.clientId),
        eq(replicacheClients.clientGroupId, input.clientGroupId),
        eq(replicacheClients.organizationId, input.organizationId),
      ),
    );
}

async function bumpClientGroupVersion(tx: ReplicacheTx, clientGroupId: string) {
  const [group] = await tx
    .select({ cvrVersion: replicacheClientGroups.cvrVersion })
    .from(replicacheClientGroups)
    .where(eq(replicacheClientGroups.id, clientGroupId))
    .limit(1);

  await tx
    .update(replicacheClientGroups)
    .set({
      cvrVersion: (group?.cvrVersion ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(replicacheClientGroups.id, clientGroupId));
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

async function recalculateQuoteTotals(tx: ReplicacheTx, quoteId: string) {
  const allItems = await tx
    .select({ extendedPrice: quoteItems.extendedPrice })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));

  const subtotal = allItems.reduce((sum, item) => {
    const value = item.extendedPrice ? parseFloat(String(item.extendedPrice)) : 0;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  await tx
    .update(quotes)
    .set({ subtotalMaterials: subtotal.toString(), total: subtotal.toString() })
    .where(eq(quotes.id, quoteId));
}

async function touchMaterialList(tx: ReplicacheTx, materialListId: string) {
  await tx
    .update(materialLists)
    .set({ updatedAt: new Date() })
    .where(eq(materialLists.id, materialListId));
}

async function recordMaterialListItemTombstone(
  tx: ReplicacheTx,
  input: { organizationId: string; materialListId: string; itemId: string },
) {
  await tx
    .insert(materialListSyncTombstones)
    .values({
      organizationId: input.organizationId,
      materialListId: input.materialListId,
      entityType: "quoteItem",
      entityId: input.itemId,
      deletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        materialListSyncTombstones.organizationId,
        materialListSyncTombstones.entityType,
        materialListSyncTombstones.entityId,
      ],
      set: { deletedAt: new Date(), materialListId: input.materialListId },
    });
}

async function recordMaterialListTombstone(
  tx: ReplicacheTx,
  input: { organizationId: string; materialListId: string },
) {
  await tx
    .insert(materialListSyncTombstones)
    .values({
      organizationId: input.organizationId,
      materialListId: input.materialListId,
      entityType: "materialList",
      entityId: input.materialListId,
      deletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        materialListSyncTombstones.organizationId,
        materialListSyncTombstones.entityType,
        materialListSyncTombstones.entityId,
      ],
      set: { deletedAt: new Date(), materialListId: input.materialListId },
    });
}

async function getMaterialListForMutation(
  tx: ReplicacheTx,
  input: { organizationId: string; materialListId: string },
) {
  const [materialList] = await tx
    .select({ id: materialLists.id, quoteId: materialLists.quoteId })
    .from(materialLists)
    .where(
      and(
        eq(materialLists.id, input.materialListId),
        eq(materialLists.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!materialList?.quoteId) {
    throw new Error("Material list not found");
  }

  return materialList;
}

async function getUnitCostFromSupplierPart(
  tx: ReplicacheTx,
  supplierPartId: string,
): Promise<number> {
  const [sp] = await tx
    .select({ lastKnownUnitCost: supplierParts.lastKnownUnitCost })
    .from(supplierParts)
    .where(eq(supplierParts.id, supplierPartId))
    .limit(1);
  const raw = sp?.lastKnownUnitCost ? parseFloat(String(sp.lastKnownUnitCost)) : 0;
  return Number.isFinite(raw) ? raw : 0;
}

// ---------------------------------------------------------------------------
// Mutator dispatch
// ---------------------------------------------------------------------------

async function applyReplicacheMutation(
  tx: ReplicacheTx,
  input: {
    name: string;
    args: unknown;
    organizationId: string;
    userId: string;
    sideEffects: ReplicacheMutationSideEffects;
  },
) {
  switch (input.name) {
    // -----------------------------------------------------------------------
    case "renameMaterialList": {
      const args = renameMaterialListArgs.parse(input.args);
      await getMaterialListForMutation(tx, {
        organizationId: input.organizationId,
        materialListId: args.materialListId,
      });
      await tx
        .update(materialLists)
        .set({ name: args.name, updatedAt: new Date() })
        .where(eq(materialLists.id, args.materialListId));
      publishMaterialListEvent(args.materialListId, "updated", input.organizationId);
      return;
    }
    // -----------------------------------------------------------------------
    case "updateItemQuantity": {
      const args = updateItemQuantityArgs.parse(input.args);
      const [item] = await tx
        .select({
          id: quoteItems.id,
          quoteId: quoteItems.quoteId,
          unitCost: quoteItems.unitCost,
          materialListId: quotes.materialListId,
        })
        .from(quoteItems)
        .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
        .where(and(eq(quoteItems.id, args.itemId), eq(quotes.organizationId, input.organizationId)))
        .limit(1);

      if (!item?.materialListId) {
        throw new Error(`Cannot update missing material-list item ${args.itemId}`);
      }
      if (args.materialListId && item.materialListId !== args.materialListId) {
        throw new Error(`Material-list item ${args.itemId} does not belong to ${args.materialListId}`);
      }

      const unitCost = item.unitCost ? parseFloat(String(item.unitCost)) : 0;
      const extendedPrice = args.quantity * (Number.isFinite(unitCost) ? unitCost : 0);
      await tx
        .update(quoteItems)
        .set({
          quantity: args.quantity.toString(),
          extendedPrice: extendedPrice.toString(),
          updatedAt: new Date(),
        })
        .where(eq(quoteItems.id, args.itemId));
      input.sideEffects.quoteIdsToRecalculate.add(item.quoteId);
      input.sideEffects.materialListIdsToTouch.add(item.materialListId);
      publishMaterialListEvent(item.materialListId, "updated", input.organizationId);
      return;
    }
    // -----------------------------------------------------------------------
    case "removeItem": {
      const args = removeItemArgs.parse(input.args);
      let materialList: Awaited<ReturnType<typeof getMaterialListForMutation>>;
      try {
        materialList = await getMaterialListForMutation(tx, {
          organizationId: input.organizationId,
          materialListId: args.materialListId,
        });
      } catch {
        return;
      }
      const [item] = await tx
        .select({ id: quoteItems.id, quoteId: quoteItems.quoteId })
        .from(quoteItems)
        .where(eq(quoteItems.id, args.itemId))
        .limit(1);

      if (!item || item.quoteId !== materialList.quoteId) {
        await recordMaterialListItemTombstone(tx, {
          organizationId: input.organizationId,
          materialListId: args.materialListId,
          itemId: args.itemId,
        });
        return;
      }

      await tx.delete(quoteItems).where(eq(quoteItems.id, args.itemId));
      await recordMaterialListItemTombstone(tx, {
        organizationId: input.organizationId,
        materialListId: args.materialListId,
        itemId: args.itemId,
      });
      input.sideEffects.quoteIdsToRecalculate.add(materialList.quoteId);
      input.sideEffects.materialListIdsToTouch.add(args.materialListId);
      publishMaterialListEvent(args.materialListId, "updated", input.organizationId);
      return;
    }
    // -----------------------------------------------------------------------
    case "addItem": {
      const args = addItemArgs.parse(input.args);
      let materialList: Awaited<ReturnType<typeof getMaterialListForMutation>>;
      try {
        materialList = await getMaterialListForMutation(tx, {
          organizationId: input.organizationId,
          materialListId: args.materialListId,
        });
      } catch (error) {
        throw new Error(`Cannot add item to missing material list ${args.materialListId}`, {
          cause: error,
        });
      }

      const offlineSupplierPart = parseOfflineSupplierPartId(args.supplierPartId);
      const serverSupplierPartId = isUuid(args.supplierPartId) ? args.supplierPartId : null;
      const resolvedSupplierId = args.supplierId ?? offlineSupplierPart?.supplierId ?? null;

      let unitCost = args.unitCost ?? 0;
      if (serverSupplierPartId) {
        unitCost = await getUnitCostFromSupplierPart(tx, serverSupplierPartId);
      }
      if (!Number.isFinite(unitCost)) unitCost = 0;

      const extendedPrice = args.quantity * unitCost;

      await tx
        .insert(quoteItems)
        .values({
          id: args.itemId,
          quoteId: materialList.quoteId,
          partDefinitionId: args.partDefinitionId ?? null,
          supplierPartId: serverSupplierPartId,
          supplierId: resolvedSupplierId,
          quantity: args.quantity.toString(),
          unitCost: unitCost.toString(),
          extendedPrice: extendedPrice.toString(),
          descriptionSnapshot: args.descriptionSnapshot ?? null,
          addedByUserId: input.userId,
        })
        .onConflictDoNothing(); // Idempotent: skip if already applied

      input.sideEffects.quoteIdsToRecalculate.add(materialList.quoteId);
      input.sideEffects.materialListIdsToTouch.add(args.materialListId);
      publishMaterialListEvent(args.materialListId, "updated", input.organizationId);
      return;
    }
    // -----------------------------------------------------------------------
    case "updateItemSupplierPart": {
      const args = updateItemSupplierPartArgs.parse(input.args);
      const [item] = await tx
        .select({
          id: quoteItems.id,
          quoteId: quoteItems.quoteId,
          quantity: quoteItems.quantity,
          materialListId: quotes.materialListId,
        })
        .from(quoteItems)
        .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
        .where(
          and(eq(quoteItems.id, args.itemId), eq(quotes.organizationId, input.organizationId)),
        )
        .limit(1);

      if (!item?.materialListId) {
        throw new Error(`Cannot update supplier for missing material-list item ${args.itemId}`);
      }
      if (args.materialListId && item.materialListId !== args.materialListId) {
        throw new Error(`Material-list item ${args.itemId} does not belong to ${args.materialListId}`);
      }

      const offlineSupplierPart = parseOfflineSupplierPartId(args.supplierPartId);
      const serverSupplierPartId = isUuid(args.supplierPartId) ? args.supplierPartId : null;
      const resolvedSupplierId = args.supplierId ?? offlineSupplierPart?.supplierId ?? null;

      let unitCost = args.unitCost ?? 0;
      if (serverSupplierPartId) {
        unitCost = await getUnitCostFromSupplierPart(tx, serverSupplierPartId);
      }
      if (!Number.isFinite(unitCost)) unitCost = 0;

      const quantity = parseFloat(String(item.quantity));
      const extendedPrice = (Number.isFinite(quantity) ? quantity : 0) * unitCost;

      await tx
        .update(quoteItems)
        .set({
          supplierPartId: serverSupplierPartId,
          supplierId: resolvedSupplierId,
          unitCost: unitCost.toString(),
          extendedPrice: extendedPrice.toString(),
          updatedAt: new Date(),
        })
        .where(eq(quoteItems.id, args.itemId));

      input.sideEffects.quoteIdsToRecalculate.add(item.quoteId);
      input.sideEffects.materialListIdsToTouch.add(item.materialListId);
      publishMaterialListEvent(item.materialListId, "updated", input.organizationId);
      return;
    }
    // -----------------------------------------------------------------------
    case "createJob": {
      const args = createJobArgs.parse(input.args);
      await tx
        .insert(jobs)
        .values({
          id: args.jobId,
          organizationId: input.organizationId,
          name: args.name,
          locationId: args.locationId ?? null,
          createdByUserId: input.userId,
        })
        .onConflictDoNothing(); // Idempotent
      return;
    }
    // -----------------------------------------------------------------------
    case "updateJob": {
      const args = updateJobArgs.parse(input.args);
      const setValues: Partial<typeof jobs.$inferInsert> = {};
      if (args.name !== undefined) setValues.name = args.name;
      if ("locationId" in args) setValues.locationId = args.locationId ?? null;
      if ("foremanName" in args) setValues.foremanName = args.foremanName ?? null;
      if ("poNumber" in args) setValues.poNumber = args.poNumber ?? null;

      if (Object.keys(setValues).length > 0) {
        setValues.updatedAt = new Date();
        await tx
          .update(jobs)
          .set(setValues)
          .where(
            and(eq(jobs.id, args.jobId), eq(jobs.organizationId, input.organizationId)),
          );
      }
      return;
    }
    // -----------------------------------------------------------------------
    case "deleteJob": {
      const args = deleteJobArgs.parse(input.args);

      // Find all material lists and their quotes
      const jobMaterialLists = await tx
        .select({ id: materialLists.id, quoteId: materialLists.quoteId })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.jobId, args.jobId),
            eq(materialLists.organizationId, input.organizationId),
          ),
        );

      const quoteIds = jobMaterialLists
        .map((ml) => ml.quoteId)
        .filter((id): id is string => id !== null);

      if (quoteIds.length > 0) {
        await tx.delete(quoteItems).where(inArray(quoteItems.quoteId, quoteIds));
        await tx.delete(quotes).where(inArray(quotes.id, quoteIds));
      }

      const mlIds = jobMaterialLists.map((ml) => ml.id);
      if (mlIds.length > 0) {
        await tx.delete(materialLists).where(inArray(materialLists.id, mlIds));
      }

      await tx
        .delete(jobs)
        .where(and(eq(jobs.id, args.jobId), eq(jobs.organizationId, input.organizationId)));
      return;
    }
    // -----------------------------------------------------------------------
    case "createMaterialList": {
      const args = createMaterialListArgs.parse(input.args);

      // Verify the job belongs to this org
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, args.jobId), eq(jobs.organizationId, input.organizationId)))
        .limit(1);

      if (!job) {
        throw new Error(`Cannot create material list ${args.materialListId}; parent job ${args.jobId} is missing`);
      }

      const materialListName = isDefaultMaterialListName(args.name)
        ? await getNextDefaultMaterialListName(tx, {
            organizationId: input.organizationId,
            jobId: args.jobId,
          })
        : args.name.trim();

      // Insert materialList first (quoteId null to break the circular FK)
      await tx
        .insert(materialLists)
        .values({
          id: args.materialListId,
          organizationId: input.organizationId,
          jobId: args.jobId,
          name: materialListName,
          quoteId: null,
          createdByUserId: input.userId,
        })
        .onConflictDoNothing();

      // Insert the associated quote
      const quoteId = crypto.randomUUID();
      await tx
        .insert(quotes)
        .values({
          id: quoteId,
          organizationId: input.organizationId,
          materialListId: args.materialListId,
          jobId: args.jobId,
          createdByUserId: input.userId,
        })
        .onConflictDoNothing();

      // Back-fill the quoteId onto the materialList (if not already set)
      await tx
        .update(materialLists)
        .set({ quoteId })
        .where(
          and(
            eq(materialLists.id, args.materialListId),
            eq(materialLists.organizationId, input.organizationId),
          ),
        );
      return;
    }
    // -----------------------------------------------------------------------
    case "deleteMaterialList": {
      const args = deleteMaterialListArgs.parse(input.args);

      const [materialList] = await tx
        .select({ id: materialLists.id, quoteId: materialLists.quoteId })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, args.materialListId),
            eq(materialLists.organizationId, input.organizationId),
          ),
        )
        .limit(1);

      if (!materialList) {
        // The server may already have applied this delete before tombstones were
        // recorded. Still emit a material-list tombstone so Replicache can clear
        // any stale base value when the client retries the delete.
        await recordMaterialListTombstone(tx, {
          organizationId: input.organizationId,
          materialListId: args.materialListId,
        });
        return;
      }

      if (materialList.quoteId) {
        const listItems = await tx
          .select({ id: quoteItems.id })
          .from(quoteItems)
          .where(eq(quoteItems.quoteId, materialList.quoteId));

        for (const item of listItems) {
          await recordMaterialListItemTombstone(tx, {
            organizationId: input.organizationId,
            materialListId: materialList.id,
            itemId: item.id,
          });
        }

        await tx.delete(quoteItems).where(eq(quoteItems.quoteId, materialList.quoteId));
        await tx.delete(quotes).where(eq(quotes.id, materialList.quoteId));
      }

      await recordMaterialListTombstone(tx, {
        organizationId: input.organizationId,
        materialListId: materialList.id,
      });

      await tx
        .delete(materialLists)
        .where(
          and(
            eq(materialLists.id, args.materialListId),
            eq(materialLists.organizationId, input.organizationId),
          ),
        );
      return;
    }
    // -----------------------------------------------------------------------
    case "createSupplier": {
      const args = createSupplierArgs.parse(input.args);
      await tx
        .insert(suppliers)
        .values({
          id: args.supplierId,
          organizationId: input.organizationId,
          name: args.name,
          contactName: args.contactName ?? null,
          contactEmail: args.contactEmail ?? null,
          contactPhone: args.contactPhone ?? null,
          orderingNotes: args.orderingNotes ?? null,
          locationId: args.locationId ?? null,
        })
        .onConflictDoNothing();
      return;
    }
    // -----------------------------------------------------------------------
    case "updateSupplier": {
      const args = updateSupplierArgs.parse(input.args);
      const setValues: Partial<typeof suppliers.$inferInsert> = {};
      if (args.name !== undefined) setValues.name = args.name;
      if ("contactName" in args) setValues.contactName = args.contactName ?? null;
      if ("contactEmail" in args) setValues.contactEmail = args.contactEmail ?? null;
      if ("contactPhone" in args) setValues.contactPhone = args.contactPhone ?? null;
      if ("orderingNotes" in args) setValues.orderingNotes = args.orderingNotes ?? null;
      if ("locationId" in args) setValues.locationId = args.locationId ?? null;

      if (Object.keys(setValues).length > 0) {
        setValues.updatedAt = new Date();
        await tx
          .update(suppliers)
          .set(setValues)
          .where(
            and(
              eq(suppliers.id, args.supplierId),
              eq(suppliers.organizationId, input.organizationId),
            ),
          );
      }
      return;
    }
    // -----------------------------------------------------------------------
    case "deleteSupplier": {
      const args = deleteSupplierArgs.parse(input.args);
      await tx
        .delete(suppliers)
        .where(
          and(
            eq(suppliers.id, args.supplierId),
            eq(suppliers.organizationId, input.organizationId),
          ),
        );
      return;
    }
    // -----------------------------------------------------------------------
    default:
      // Unknown/obsolete mutators: silently swallow so stale clients don't block sync.
      return;
  }
}

function assertSupportedSchema(schemaVersion: string) {
  if (schemaVersion !== MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION) {
    return { error: "VersionNotSupported" as const, versionType: "schema" as const };
  }
  return null;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "40P01" || candidate.code === "40001") return true;
  return isRetryableTransactionError(candidate.cause);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetryableReplicacheTransaction<T>(
  work: (tx: ReplicacheTx) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction(work);
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(50 * attempt);
    }
  }
  throw new Error("Unreachable retry state");
}

// ---------------------------------------------------------------------------
// Push handler
// ---------------------------------------------------------------------------

export async function handleMaterialListReplicachePush(
  request: PushRequestV1,
  user: ReplicacheUser,
) {
  const organizationId = user.organizationId;
  if (!organizationId) throw new Error("User must belong to an organization");

  const unsupported = assertSupportedSchema(request.schemaVersion);
  if (unsupported) return unsupported;
  if (request.pushVersion !== 1) {
    return { error: "VersionNotSupported" as const, versionType: "push" as const };
  }

  let appliedMutationCount = 0;

  await withRetryableReplicacheTransaction(async (tx) => {
    const sideEffects: ReplicacheMutationSideEffects = {
      quoteIdsToRecalculate: new Set(),
      materialListIdsToTouch: new Set(),
    };

    await ensureClientGroup(tx, {
      clientGroupId: request.clientGroupID,
      organizationId,
      userId: user.id,
      schemaVersion: request.schemaVersion,
    });

    for (const mutation of request.mutations) {
      await ensureClient(tx, {
        clientId: mutation.clientID,
        clientGroupId: request.clientGroupID,
        organizationId,
        userId: user.id,
      });

      const clientIdentity = {
        clientId: mutation.clientID,
        clientGroupId: request.clientGroupID,
        organizationId,
      };
      const lastMutationId = await getClientLastMutationId(tx, clientIdentity);
      const nextMutationId = lastMutationId + 1;

      if (mutation.id < nextMutationId) continue;
      if (mutation.id > nextMutationId) {
        throw new Error(
          `Mutation ${mutation.id} is out of order for client ${mutation.clientID}; expected ${nextMutationId}`,
        );
      }

      await applyReplicacheMutation(tx, {
        name: mutation.name,
        args: mutation.args,
        organizationId,
        userId: user.id,
        sideEffects,
      });
      appliedMutationCount += 1;
      await setClientLastMutationId(tx, {
        ...clientIdentity,
        lastMutationId: mutation.id,
      });
    }

    // A single Replicache push can contain dozens of local mutations. Recomputing
    // quote totals and touching the same material list after every mutation makes
    // large offline batches degrade to O(n²), which was slow enough to trip
    // Cloudflare's 100s origin timeout. Coalesce those side effects once per
    // affected quote/list while staying inside the same transaction.
    for (const quoteId of sideEffects.quoteIdsToRecalculate) {
      await recalculateQuoteTotals(tx, quoteId);
    }

    for (const materialListId of sideEffects.materialListIdsToTouch) {
      await touchMaterialList(tx, materialListId);
    }

    if (request.mutations.length > 0) {
      await bumpClientGroupVersion(tx, request.clientGroupID);
    }
  });

  if (appliedMutationCount > 0) {
    publishOrganizationReplicachePoke(organizationId, {
      sourceClientGroupId: request.clientGroupID,
      mutationCount: appliedMutationCount,
    });
  }

  return {};
}

// ---------------------------------------------------------------------------
// Pull handler
// ---------------------------------------------------------------------------

export async function handleMaterialListReplicachePull(
  request: PullRequestV1,
  user: ReplicacheUser,
): Promise<PullResponseV1> {
  const organizationId = user.organizationId;
  if (!organizationId) throw new Error("User must belong to an organization");

  const unsupported = assertSupportedSchema(request.schemaVersion);
  if (unsupported) return unsupported;
  if (request.pullVersion !== 1) {
    return { error: "VersionNotSupported", versionType: "pull" };
  }

  const { patch, lastMutationIDChanges, cookie } = await db.transaction(async (tx) => {
    await ensureClientGroup(tx, {
      clientGroupId: request.clientGroupID,
      organizationId,
      userId: user.id,
      schemaVersion: request.schemaVersion,
    });

    const groupClients = await tx
      .select({ id: replicacheClients.id, lastMutationId: replicacheClients.lastMutationId })
      .from(replicacheClients)
      .where(eq(replicacheClients.clientGroupId, request.clientGroupID));

    const highWatermark = new Date();

    // Jobs with location + foreman joins
    const jobRows = await tx
      .select({
        id: jobs.id,
        name: jobs.name,
        locationId: jobs.locationId,
        status: jobs.status,
        foremanName: jobs.foremanName,
        poNumber: jobs.poNumber,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        locationName: locations.name,
        locationAddress1: locations.address1,
        locationCity: locations.city,
        locationRegion: locations.region,
        locationPostalCode: locations.postalCode,
        locationCountry: locations.country,
        foremanUserName: users.name,
      })
      .from(jobs)
      .leftJoin(locations, eq(jobs.locationId, locations.id))
      .leftJoin(users, eq(jobs.foremanUserId, users.id))
      .where(eq(jobs.organizationId, organizationId))
      .orderBy(asc(jobs.updatedAt), asc(jobs.id));

    const materialListRows = await tx
      .select({
        id: materialLists.id,
        name: materialLists.name,
        jobId: materialLists.jobId,
        quoteId: materialLists.quoteId,
        createdByUserId: materialLists.createdByUserId,
        createdAt: materialLists.createdAt,
        updatedAt: materialLists.updatedAt,
      })
      .from(materialLists)
      .where(eq(materialLists.organizationId, organizationId))
      .orderBy(asc(materialLists.updatedAt), asc(materialLists.id));

    const itemRows = await tx
      .select({
        id: quoteItems.id,
        quoteId: quoteItems.quoteId,
        materialListId: quotes.materialListId,
        quantity: quoteItems.quantity,
        unitCost: quoteItems.unitCost,
        extendedPrice: quoteItems.extendedPrice,
        descriptionSnapshot: quoteItems.descriptionSnapshot,
        partDefinitionId: quoteItems.partDefinitionId,
        partDefinitionDisplayName: partDefinitions.displayName,
        partDefinitionImageUrl: partDefinitions.imageUrl,
        partDefinitionMaterial: materials.name,
        supplierPartId: quoteItems.supplierPartId,
        supplierId: quoteItems.supplierId,
        supplierPartSku: supplierParts.supplierSku,
        supplierPartLastKnownUnitCost: supplierParts.lastKnownUnitCost,
        supplierName: suppliers.name,
        addedByUserId: quoteItems.addedByUserId,
        updatedAt: quoteItems.updatedAt,
        createdAt: quoteItems.createdAt,
      })
      .from(quoteItems)
      .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
      .leftJoin(partDefinitions, eq(quoteItems.partDefinitionId, partDefinitions.id))
      .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
      .leftJoin(supplierParts, eq(quoteItems.supplierPartId, supplierParts.id))
      .leftJoin(suppliers, eq(quoteItems.supplierId, suppliers.id))
      .where(eq(quotes.organizationId, organizationId))
      .orderBy(asc(quoteItems.updatedAt), asc(quoteItems.id));

    const supplierRows = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        contactName: suppliers.contactName,
        contactEmail: suppliers.contactEmail,
        contactPhone: suppliers.contactPhone,
        orderingNotes: suppliers.orderingNotes,
        locationId: suppliers.locationId,
        createdAt: suppliers.createdAt,
        updatedAt: suppliers.updatedAt,
      })
      .from(suppliers)
      .where(eq(suppliers.organizationId, organizationId))
      .orderBy(asc(suppliers.updatedAt), asc(suppliers.id));

    const contributorUserIds = Array.from(
      new Set(
        [
          ...materialListRows.map((materialList) => materialList.createdByUserId),
          ...itemRows.map((item) => item.addedByUserId),
        ]
          .filter((userId): userId is string => !!userId),
      ),
    );
    const contributorUserRows =
      contributorUserIds.length > 0
        ? await tx
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
            })
            .from(users)
            .where(inArray(users.id, contributorUserIds))
        : [];
    const contributorUserMap = new Map(
      contributorUserRows.map((user) => [user.id, user]),
    );

    const totalSupplierIdsByQuoteId = new Map<string, Set<string>>();
    for (const item of itemRows) {
      const supplierId = item.supplierId;
      if (!item.quoteId || !supplierId) continue;

      const supplierIds =
        totalSupplierIdsByQuoteId.get(item.quoteId) ?? new Set<string>();
      supplierIds.add(supplierId);
      totalSupplierIdsByQuoteId.set(item.quoteId, supplierIds);
    }

    const materialListIds = materialListRows.map((materialList) => materialList.id);
    const orderRows = materialListIds.length
      ? await tx
          .select({
            id: orders.id,
            materialListId: orders.materialListId,
            supplierId: orders.supplierId,
            status: orders.status,
            sentAt: orders.sentAt,
          })
          .from(orders)
          .where(inArray(orders.materialListId, materialListIds))
      : [];

    const orderIds = orderRows.map((order) => order.id);
    const orderItemRows = orderIds.length
      ? await tx
          .select({
            orderId: orderItems.orderId,
            verificationStatus: orderItems.verificationStatus,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIds))
      : [];

    const verifiedStatuses = new Set(["complete", "partial", "problem"]);
    const verificationByOrderId = new Map<
      string,
      { itemCount: number; verifiedItemCount: number }
    >();

    for (const item of orderItemRows) {
      const counts = verificationByOrderId.get(item.orderId) ?? {
        itemCount: 0,
        verifiedItemCount: 0,
      };
      counts.itemCount += 1;
      if (verifiedStatuses.has(item.verificationStatus)) {
        counts.verifiedItemCount += 1;
      }
      verificationByOrderId.set(item.orderId, counts);
    }

    const sentSupplierIdsByListId = new Map<string, Set<string>>();
    const verifiedSupplierIdsByListId = new Map<string, Set<string>>();
    for (const order of orderRows) {
      if (!order.materialListId || !order.supplierId) continue;

      const hasBeenSent =
        !!order.sentAt || ["sent", "confirmed", "received"].includes(order.status);
      if (!hasBeenSent) continue;

      const sentSupplierIds =
        sentSupplierIdsByListId.get(order.materialListId) ?? new Set<string>();
      sentSupplierIds.add(order.supplierId);
      sentSupplierIdsByListId.set(order.materialListId, sentSupplierIds);

      const verificationCounts = verificationByOrderId.get(order.id);
      const isVerified =
        !!verificationCounts &&
        verificationCounts.itemCount > 0 &&
        verificationCounts.verifiedItemCount === verificationCounts.itemCount;
      if (!isVerified) continue;

      const verifiedSupplierIds =
        verifiedSupplierIdsByListId.get(order.materialListId) ?? new Set<string>();
      verifiedSupplierIds.add(order.supplierId);
      verifiedSupplierIdsByListId.set(order.materialListId, verifiedSupplierIds);
    }

    // Timestamp-only incremental pulls can leave a device permanently stale if
    // it advances its cookie after receiving a partial patch. Until this uses a
    // real CVR diff, send a full organization snapshot so every pull self-heals
    // local IndexedDB state.
    const patch: PatchOperation[] = [{ op: "clear" }];

    for (const job of jobRows) {
      patch.push({
        op: "put",
        key: `job/${job.id}`,
        value: {
          id: job.id,
          name: job.name,
          locationId: job.locationId ?? null,
          status: job.status,
          foremanName: job.foremanName ?? job.foremanUserName ?? null,
          poNumber: job.poNumber ?? null,
          createdAt: job.createdAt?.toISOString?.() ?? String(job.createdAt),
          updatedAt: job.updatedAt?.toISOString?.() ?? String(job.updatedAt),
          location: job.locationName
            ? {
                name: job.locationName,
                address1: job.locationAddress1 ?? null,
                city: job.locationCity ?? null,
                region: job.locationRegion ?? null,
                postalCode: job.locationPostalCode ?? null,
                country: job.locationCountry ?? null,
              }
            : null,
        },
      });
    }

    for (const materialList of materialListRows) {
      patch.push({
        op: "put",
        key: `materialList/${materialList.id}`,
        value: {
          ...materialList,
          totalSupplierCount: materialList.quoteId
            ? (totalSupplierIdsByQuoteId.get(materialList.quoteId)?.size ?? 0)
            : 0,
          sentSupplierCount: sentSupplierIdsByListId.get(materialList.id)?.size ?? 0,
          verifiedSupplierCount:
            verifiedSupplierIdsByListId.get(materialList.id)?.size ?? 0,
          createdBy: materialList.createdByUserId
            ? (() => {
                const createdByUser = contributorUserMap.get(
                  materialList.createdByUserId,
                );
                return {
                  id: materialList.createdByUserId,
                  name: createdByUser?.name ?? createdByUser?.email ?? "Unknown",
                  email: createdByUser?.email ?? null,
                };
              })()
            : null,
          createdAt: materialList.createdAt?.toISOString?.() ?? String(materialList.createdAt),
          updatedAt: materialList.updatedAt?.toISOString?.() ?? String(materialList.updatedAt),
        },
      });
    }

    for (const item of itemRows) {
      patch.push({
        op: "put",
        key: `materialListItem/${item.id}`,
        value: {
          id: item.id,
          quoteId: item.quoteId,
          materialListId: item.materialListId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          extendedPrice: item.extendedPrice,
          descriptionSnapshot: item.descriptionSnapshot,
          partDefinitionId: item.partDefinitionId,
          supplierPartId: item.supplierPartId,
          supplierId: item.supplierId,
          selectedSupplierId: item.supplierId,
          partDefinition: item.partDefinitionId
            ? {
                id: item.partDefinitionId,
                displayName:
                  item.partDefinitionDisplayName ??
                  item.descriptionSnapshot ??
                  "Unknown Part",
                imageUrl: item.partDefinitionImageUrl ?? null,
                material: item.partDefinitionMaterial ?? null,
              }
            : null,
          supplierPart: item.supplierPartId
            ? {
                id: item.supplierPartId,
                supplierId: item.supplierId ?? "",
                supplierSku: item.supplierPartSku ?? null,
                lastKnownUnitCost: item.supplierPartLastKnownUnitCost ?? null,
                supplier: item.supplierId
                  ? {
                      id: item.supplierId,
                      name: item.supplierName ?? "Supplier",
                    }
                  : null,
              }
            : null,
          addedBy: item.addedByUserId
            ? (() => {
                const addedByUser = contributorUserMap.get(item.addedByUserId);
                return {
                  id: item.addedByUserId,
                  name: addedByUser?.name ?? addedByUser?.email ?? "Unknown",
                  email: addedByUser?.email ?? null,
                };
              })()
            : null,
          createdAt: item.createdAt?.toISOString?.() ?? String(item.createdAt),
          updatedAt: item.updatedAt?.toISOString?.() ?? String(item.updatedAt),
        },
      });
    }

    for (const supplier of supplierRows) {
      patch.push({
        op: "put",
        key: `supplier/${supplier.id}`,
        value: {
          ...supplier,
          createdAt: supplier.createdAt?.toISOString?.() ?? String(supplier.createdAt),
          updatedAt: supplier.updatedAt?.toISOString?.() ?? String(supplier.updatedAt),
        },
      });
    }

    return {
      patch,
      lastMutationIDChanges: Object.fromEntries(
        groupClients.map((client) => [client.id, client.lastMutationId]),
      ),
      cookie: {
        order: highWatermark.getTime(),
        cvr: request.clientGroupID,
      },
    };
  });

  return { cookie, lastMutationIDChanges, patch };
}
