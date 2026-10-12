import {packContents, pieceCount, packsFromPieces} from "~/lib/pack-quantity";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { userCan } from "~/server/auth/permissions";
import type { db as database } from "~/server/db";
import {
  materialPrefabItems,
  materialPrefabs,
  partDefinitions,
  supplierParts,
  suppliers,
} from "~/server/db/schema";

/**
 * Prefabs: company-wide named sets of parts (e.g. a whole room). Adding one to a
 * material list happens on the device through the normal offline list
 * mutations; this router only stores and edits the prefabs themselves.
 */
const name = z.string().trim().min(1).max(255);
const quantity = z.number().positive().max(1_000_000);
const itemInput = z.object({
  partDefinitionId: z.string().uuid(),
  supplierPartId: z.string().uuid().nullish(),
  quantity,
});

type Ctx = { db: typeof database; user: unknown };
type Db = Pick<typeof database, "select" | "insert">;

function organizationOf(ctx: Ctx) {
  return (ctx.user as { organizationId: string }).organizationId;
}
function userIdOf(ctx: Ctx) {
  return (ctx.user as { id: string }).id;
}
function assertCanEdit(ctx: Ctx) {
  if (!userCan(ctx.user as never, "lists.edit"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to edit prefabs",
    });
}
async function requirePrefab(ctx: Ctx, prefabId: string) {
  const [prefab] = await ctx.db
    .select()
    .from(materialPrefabs)
    .where(
      and(
        eq(materialPrefabs.id, prefabId),
        eq(materialPrefabs.organizationId, organizationOf(ctx)),
      ),
    )
    .limit(1);
  if (!prefab)
    throw new TRPCError({ code: "NOT_FOUND", message: "Prefab not found" });
  return prefab;
}

/** Adds parts to a prefab; a part already in it gets the quantity added on. */
async function addItems(
  db: Db,
  organizationId: string,
  prefabId: string,
  items: Array<z.infer<typeof itemInput>>,
) {
  if (items.length === 0) return;
  const partIds = [...new Set(items.map((item) => item.partDefinitionId))];
  const parts = await db
    .select({ id: partDefinitions.id, piecesPerPack: partDefinitions.piecesPerPack })
    .from(partDefinitions)
    .where(
      and(
        inArray(partDefinitions.id, partIds),
        eq(partDefinitions.organizationId, organizationId),
      ),
    );
  if (parts.length !== partIds.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown part" });
  const supplierPartIds = [
    ...new Set(items.flatMap((item) => (item.supplierPartId ? [item.supplierPartId] : []))),
  ];
  const known = supplierPartIds.length
    ? await db
        .select({ id: supplierParts.id, partDefinitionId: supplierParts.partDefinitionId })
        .from(supplierParts)
        .where(
          and(
            inArray(supplierParts.id, supplierPartIds),
            eq(supplierParts.organizationId, organizationId),
          ),
        )
    : [];
  const partOfSupplierPart = new Map(known.map((row) => [row.id, row.partDefinitionId]));

  // Merge duplicates in the input first: one row per part.
  const merged = new Map<string, { supplierPartId: string | null; quantity: number }>();
  for (const item of items) {
    const supplierPartId =
      item.supplierPartId &&
      partOfSupplierPart.get(item.supplierPartId) === item.partDefinitionId
        ? item.supplierPartId
        : null;
    const existing = merged.get(item.partDefinitionId);
    const contents = parts.find(p => p.id === item.partDefinitionId)?.piecesPerPack;
    merged.set(item.partDefinitionId, {
      supplierPartId: supplierPartId ?? existing?.supplierPartId ?? null,
      quantity: packContents(contents) > 1
        ? packsFromPieces(pieceCount(existing?.quantity ?? 0, contents) + pieceCount(item.quantity, contents), contents)
        : (existing?.quantity ?? 0) + item.quantity,
    });
  }
  await db
    .insert(materialPrefabItems)
    .values(
      [...merged].map(([partDefinitionId, item]) => ({
        prefabId,
        partDefinitionId,
        supplierPartId: item.supplierPartId,
        quantity: String(item.quantity),
      })),
    )
    .onConflictDoUpdate({
      target: [materialPrefabItems.prefabId, materialPrefabItems.partDefinitionId],
      set: {
        quantity: sql`(select case when p."piecesPerPack" > 1
          then (round(${materialPrefabItems.quantity} * p."piecesPerPack") + round(excluded."quantity" * p."piecesPerPack")) / p."piecesPerPack"
          else ${materialPrefabItems.quantity} + excluded."quantity" end
          from kublai_part_definition p where p.id = excluded."partDefinitionId")`,
        supplierPartId: sql`coalesce(excluded."supplierPartId", ${materialPrefabItems.supplierPartId})`,
      },
    });
}

async function touch(ctx: Ctx, prefabId: string) {
  await ctx.db
    .update(materialPrefabs)
    .set({ updatedAt: new Date() })
    .where(eq(materialPrefabs.id, prefabId));
}

export const prefabsRouter = createTRPCRouter({
  /** Every prefab in the company with its parts, ready to add offline. */
  list: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = organizationOf(ctx);
    const prefabs = await ctx.db
      .select()
      .from(materialPrefabs)
      .where(eq(materialPrefabs.organizationId, organizationId))
      .orderBy(asc(materialPrefabs.name));
    if (prefabs.length === 0) return [];
    const items = await ctx.db
      .select({
        id: materialPrefabItems.id,
        prefabId: materialPrefabItems.prefabId,
        quantity: materialPrefabItems.quantity,
        partDefinition: {
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          piecesPerPack: partDefinitions.piecesPerPack,
          imageUrl: partDefinitions.imageUrl,
          sizeLabel: partDefinitions.sizeLabel,
        },
        supplierPartId: materialPrefabItems.supplierPartId,
        supplierId: supplierParts.supplierId,
        supplierSku: supplierParts.supplierSku,
        lastKnownUnitCost: supplierParts.lastKnownUnitCost,
        packSize: supplierParts.packSize,
        supplierName: suppliers.name,
      })
      .from(materialPrefabItems)
      .innerJoin(partDefinitions, eq(materialPrefabItems.partDefinitionId, partDefinitions.id))
      .leftJoin(supplierParts, eq(materialPrefabItems.supplierPartId, supplierParts.id))
      .leftJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
      .where(
        inArray(
          materialPrefabItems.prefabId,
          prefabs.map((prefab) => prefab.id),
        ),
      )
      .orderBy(asc(partDefinitions.displayName));
    return prefabs.map((prefab) => ({
      id: prefab.id,
      name: prefab.name,
      updatedAt: prefab.updatedAt,
      items: items
        .filter((item) => item.prefabId === prefab.id)
        .map(({ prefabId: _prefabId, supplierId, supplierSku, lastKnownUnitCost, packSize, supplierName, ...item }) => ({
          ...item,
          quantity: Number(item.quantity),
          supplierPart:
            item.supplierPartId && supplierId
              ? {
                  id: item.supplierPartId,
                  supplierId,
                  supplierSku,
                  lastKnownUnitCost,
                  packSize,
                  supplier: { id: supplierId, name: supplierName ?? "" },
                }
              : null,
        })),
    }));
  }),

  /** New prefab, empty or (for "Save as prefab") with a list's parts. */
  create: hasDashboardAccess
    .input(z.object({ name, items: z.array(itemInput).max(500).default([]) }))
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx);
      const organizationId = organizationOf(ctx);
      return ctx.db.transaction(async (tx) => {
        const [prefab] = await tx
          .insert(materialPrefabs)
          .values({ organizationId, name: input.name, createdByUserId: userIdOf(ctx) })
          .returning();
        await addItems(tx, organizationId, prefab!.id, input.items);
        return prefab!;
      });
    }),

  rename: hasDashboardAccess
    .input(z.object({ prefabId: z.string().uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx);
      await requirePrefab(ctx, input.prefabId);
      await ctx.db
        .update(materialPrefabs)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(materialPrefabs.id, input.prefabId));
    }),

  delete: hasDashboardAccess
    .input(z.object({ prefabId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx);
      await requirePrefab(ctx, input.prefabId);
      await ctx.db.delete(materialPrefabs).where(eq(materialPrefabs.id, input.prefabId));
    }),

  addItems: hasDashboardAccess
    .input(z.object({ prefabId: z.string().uuid(), items: z.array(itemInput).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx);
      await requirePrefab(ctx, input.prefabId);
      await ctx.db.transaction((tx) =>
        addItems(tx, organizationOf(ctx), input.prefabId, input.items),
      );
      await touch(ctx, input.prefabId);
    }),

  setItemQuantity: hasDashboardAccess
    .input(z.object({ prefabId: z.string().uuid(), itemId: z.string().uuid(), quantity }))
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx);
      await requirePrefab(ctx, input.prefabId);
      await ctx.db
        .update(materialPrefabItems)
        .set({ quantity: String(input.quantity) })
        .where(
          and(
            eq(materialPrefabItems.id, input.itemId),
            eq(materialPrefabItems.prefabId, input.prefabId),
          ),
        );
      await touch(ctx, input.prefabId);
    }),

  removeItem: hasDashboardAccess
    .input(z.object({ prefabId: z.string().uuid(), itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx);
      await requirePrefab(ctx, input.prefabId);
      await ctx.db
        .delete(materialPrefabItems)
        .where(
          and(
            eq(materialPrefabItems.id, input.itemId),
            eq(materialPrefabItems.prefabId, input.prefabId),
          ),
        );
      await touch(ctx, input.prefabId);
    }),
});
