import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  ASSET_STATUSES,
  HOLDER_TYPES,
  assertHolder,
  describeHolders,
  ensureAssetSetup,
  ensureToolRoomSupplier,
  holderKey,
  inServiceStatus,
  moveAssets,
  moveStock,
  nextAssetTags,
  setAssetStatus,
  type Holder,
  type Tx,
} from "~/server/assets/service";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  assertCanAccessTab,
  assertCanManageAssets,
  getUserPermissions,
} from "~/server/auth/permissions";
import {
  assetCountLines,
  assetCounts,
  assetLocations,
  assetMovements,
  assetStock,
  assets,
  catalogs,
  jobs,
  orderItems,
  orders,
  partDefinitions,
  users,
} from "~/server/db/schema";

const holderInput = z.object({
  type: z.enum(HOLDER_TYPES),
  id: z.string().min(1).max(255),
});

const assetsProcedure = hasDashboardAccess.use(({ ctx, next }) => {
  assertCanAccessTab(ctx.user, "assets");
  return next({
    ctx: {
      organizationId: ctx.user.organizationId as string,
      canManageAssets: getUserPermissions(ctx.user).canManageAssets,
    },
  });
});

/** Tool-room-only procedures. */
const toolRoomProcedure = assetsProcedure.use(({ ctx, next }) => {
  assertCanManageAssets(ctx.user);
  return next();
});

const typeColumns = {
  partId: partDefinitions.id,
  name: partDefinitions.displayName,
  description: partDefinitions.description,
  imageUrl: partDefinitions.imageUrl,
  tracking: partDefinitions.assetTracking,
  sizeLabel: partDefinitions.sizeLabel,
};

/** Tool types: parts in "assets" catalogs. */
function toolTypeFilter(organizationId: string) {
  return and(
    eq(partDefinitions.organizationId, organizationId),
    eq(catalogs.kind, "assets"),
  );
}

async function loadOrder(db: Tx, organizationId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
    .limit(1);
  if (!order || (order.kind !== "tool_request" && order.kind !== "tool_return")) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tool request not found." });
  }
  return order;
}

/** Recomputes a tool order's fulfilment from its lines. */
async function updateFulfillment(tx: Tx, orderId: string) {
  const items = await tx
    .select({ quantity: orderItems.quantity, fulfilled: orderItems.fulfilledQuantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const done = items.every((i) => Number(i.fulfilled ?? 0) + 1e-9 >= Number(i.quantity));
  const any = items.some((i) => Number(i.fulfilled ?? 0) > 0);
  const [row] = await tx
    .update(orders)
    .set({
      fulfillmentStatus: done ? "fulfilled" : any ? "partial" : "open",
      fulfilledAt: done ? new Date() : null,
    })
    .where(eq(orders.id, orderId))
    .returning();
  return row!;
}

export const assetsRouter = createTRPCRouter({
  // ───────────────────────────── Queries ─────────────────────────────

  /** Headline numbers for the Asset Management tab. */
  overview: assetsProcedure.query(async ({ ctx }) => {
    const org = ctx.organizationId;
    const statusRows = await ctx.db
      .select({ status: assets.status, count: sql<number>`count(*)::int` })
      .from(assets)
      .where(eq(assets.organizationId, org))
      .groupBy(assets.status);
    const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.count)]));
    const openRows = await ctx.db
      .select({ kind: orders.kind, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, org),
          inArray(orders.kind, ["tool_request", "tool_return"]),
          inArray(orders.fulfillmentStatus, ["open", "partial"]),
        ),
      )
      .groupBy(orders.kind);
    const open = Object.fromEntries(openRows.map((r) => [r.kind, Number(r.count)]));
    const [typeCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(partDefinitions)
      .innerJoin(catalogs, eq(partDefinitions.catalogId, catalogs.id))
      .where(and(toolTypeFilter(org), eq(partDefinitions.isActive, true)));
    const [assetCatalog] = await ctx.db
      .select({ id: catalogs.id })
      .from(catalogs)
      .where(and(eq(catalogs.organizationId, org), eq(catalogs.kind, "assets")))
      .limit(1);
    const [openCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(assetCounts)
      .where(and(eq(assetCounts.organizationId, org), eq(assetCounts.status, "open")));
    return {
      canManageAssets: ctx.canManageAssets,
      isSetUp: Boolean(assetCatalog),
      toolTypes: Number(typeCount?.count ?? 0),
      tools: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        available: byStatus.available ?? 0,
        inUse: byStatus.in_use ?? 0,
        damaged: byStatus.damaged ?? 0,
        missing: byStatus.missing ?? 0,
        retired: byStatus.retired ?? 0,
      },
      openRequests: open.tool_request ?? 0,
      openReturns: open.tool_return ?? 0,
      openCounts: Number(openCount?.count ?? 0),
    };
  }),

  /** Everywhere a tool can be: locations, jobs and people (for pickers). */
  holders: assetsProcedure.query(async ({ ctx }) => {
    const org = ctx.organizationId;
    const [locationRows, jobRows, peopleRows] = await Promise.all([
      ctx.db
        .select()
        .from(assetLocations)
        .where(eq(assetLocations.organizationId, org))
        .orderBy(asc(assetLocations.kind), asc(assetLocations.name)),
      ctx.db
        .select({ id: jobs.id, name: jobs.name, status: jobs.status })
        .from(jobs)
        .where(eq(jobs.organizationId, org))
        .orderBy(desc(jobs.updatedAt)),
      ctx.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(eq(users.organizationId, org), or(eq(users.organizationAccessStatus, "approved"), sql`${users.organizationAccessStatus} is null`)))
        .orderBy(asc(users.name), asc(users.email)),
    ]);
    return {
      locations: locationRows,
      jobs: jobRows,
      people: peopleRows.map((p) => ({ id: p.id, name: p.name || p.email })),
      me: ctx.userId,
    };
  }),

  /** Tool types with how many of each are where. */
  listTypes: assetsProcedure.query(async ({ ctx }) => {
    const org = ctx.organizationId;
    const types = await ctx.db
      .select({ ...typeColumns, catalogId: partDefinitions.catalogId, isActive: partDefinitions.isActive })
      .from(partDefinitions)
      .innerJoin(catalogs, eq(partDefinitions.catalogId, catalogs.id))
      .where(toolTypeFilter(org))
      .orderBy(asc(partDefinitions.displayName));
    const serialized = await ctx.db
      .select({ partId: assets.partDefinitionId, status: assets.status, count: sql<number>`count(*)::int` })
      .from(assets)
      .where(eq(assets.organizationId, org))
      .groupBy(assets.partDefinitionId, assets.status);
    const stock = await ctx.db
      .select({
        partId: assetStock.partDefinitionId,
        atLocations: sql<number>`coalesce(sum(case when ${assetStock.holderType} = 'location' then ${assetStock.quantity} else 0 end), 0)::float`,
        outInField: sql<number>`coalesce(sum(case when ${assetStock.holderType} <> 'location' then ${assetStock.quantity} else 0 end), 0)::float`,
      })
      .from(assetStock)
      .where(eq(assetStock.organizationId, org))
      .groupBy(assetStock.partDefinitionId);
    const stockBy = new Map(stock.map((s) => [s.partId, s]));
    return types.map((type) => {
      const counts = Object.fromEntries(
        serialized.filter((s) => s.partId === type.partId).map((s) => [s.status, Number(s.count)]),
      );
      const held = stockBy.get(type.partId);
      return {
        ...type,
        tracking: type.tracking === "quantity" ? ("quantity" as const) : ("serialized" as const),
        available: type.tracking === "quantity" ? Number(held?.atLocations ?? 0) : (counts.available ?? 0),
        inUse: type.tracking === "quantity" ? Number(held?.outInField ?? 0) : (counts.in_use ?? 0),
        damaged: counts.damaged ?? 0,
        missing: counts.missing ?? 0,
      };
    });
  }),

  /** Individually tracked tools, filtered. */
  listAssets: assetsProcedure
    .input(
      z.object({
        search: z.string().trim().max(120).optional(),
        status: z.enum(ASSET_STATUSES).optional(),
        holder: holderInput.optional(),
        partId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(1000).default(300),
      }),
    )
    .query(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      const conditions = [eq(assets.organizationId, org)];
      if (input.status) conditions.push(eq(assets.status, input.status));
      if (input.partId) conditions.push(eq(assets.partDefinitionId, input.partId));
      if (input.holder) {
        conditions.push(eq(assets.holderType, input.holder.type), eq(assets.holderId, input.holder.id));
      }
      if (input.search) {
        const term = `%${input.search}%`;
        conditions.push(
          or(
            ilike(assets.assetTag, term),
            ilike(assets.serialNumber, term),
            ilike(partDefinitions.displayName, term),
          )!,
        );
      }
      const rows = await ctx.db
        .select({
          id: assets.id,
          assetTag: assets.assetTag,
          serialNumber: assets.serialNumber,
          status: assets.status,
          holderType: assets.holderType,
          holderId: assets.holderId,
          notes: assets.notes,
          updatedAt: assets.updatedAt,
          ...typeColumns,
        })
        .from(assets)
        .innerJoin(partDefinitions, eq(assets.partDefinitionId, partDefinitions.id))
        .where(and(...conditions))
        .orderBy(asc(partDefinitions.displayName), asc(assets.assetTag))
        .limit(input.limit);
      const holders = await describeHolders(
        ctx.db,
        org,
        rows.map((r) => ({ type: r.holderType as Holder["type"], id: r.holderId })),
      );
      return rows.map((r) => ({
        ...r,
        holder: holders.get(`${r.holderType}:${r.holderId}`)!,
      }));
    }),

  /** Quantity-tracked stock, optionally for one holder or type. */
  listStock: assetsProcedure
    .input(z.object({ holder: holderInput.optional(), partId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      const conditions = [eq(assetStock.organizationId, org), gt(assetStock.quantity, "0")];
      if (input.partId) conditions.push(eq(assetStock.partDefinitionId, input.partId));
      if (input.holder) {
        conditions.push(eq(assetStock.holderType, input.holder.type), eq(assetStock.holderId, input.holder.id));
      }
      const rows = await ctx.db
        .select({
          holderType: assetStock.holderType,
          holderId: assetStock.holderId,
          quantity: assetStock.quantity,
          ...typeColumns,
        })
        .from(assetStock)
        .innerJoin(partDefinitions, eq(assetStock.partDefinitionId, partDefinitions.id))
        .where(and(...conditions))
        .orderBy(asc(partDefinitions.displayName));
      const holders = await describeHolders(
        ctx.db,
        org,
        rows.map((r) => ({ type: r.holderType as Holder["type"], id: r.holderId })),
      );
      return rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        holder: holders.get(`${r.holderType}:${r.holderId}`)!,
      }));
    }),

  /** One tool by id or by the tag printed on its QR label, with history. */
  getAsset: assetsProcedure
    .input(z.object({ id: z.string().uuid().optional(), tag: z.string().trim().min(1).max(40).optional() }))
    .query(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      if (!input.id && !input.tag) throw new TRPCError({ code: "BAD_REQUEST", message: "Tool id or tag required." });
      const [asset] = await ctx.db
        .select({
          id: assets.id,
          assetTag: assets.assetTag,
          serialNumber: assets.serialNumber,
          status: assets.status,
          holderType: assets.holderType,
          holderId: assets.holderId,
          notes: assets.notes,
          createdAt: assets.createdAt,
          ...typeColumns,
        })
        .from(assets)
        .innerJoin(partDefinitions, eq(assets.partDefinitionId, partDefinitions.id))
        .where(
          and(
            eq(assets.organizationId, org),
            input.id ? eq(assets.id, input.id) : sql`upper(${assets.assetTag}) = upper(${input.tag!})`,
          ),
        )
        .limit(1);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "No tool with that tag." });
      const history = await ctx.db
        .select({
          id: assetMovements.id,
          kind: assetMovements.kind,
          fromType: assetMovements.fromType,
          fromId: assetMovements.fromId,
          toType: assetMovements.toType,
          toId: assetMovements.toId,
          statusFrom: assetMovements.statusFrom,
          statusTo: assetMovements.statusTo,
          note: assetMovements.note,
          orderId: assetMovements.orderId,
          createdAt: assetMovements.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(assetMovements)
        .leftJoin(users, eq(assetMovements.userId, users.id))
        .where(and(eq(assetMovements.organizationId, org), eq(assetMovements.assetId, asset.id)))
        .orderBy(desc(assetMovements.createdAt))
        .limit(100);
      const holderList: Holder[] = [{ type: asset.holderType as Holder["type"], id: asset.holderId }];
      for (const h of history) {
        if (h.fromType && h.fromId) holderList.push({ type: h.fromType as Holder["type"], id: h.fromId });
        if (h.toType && h.toId) holderList.push({ type: h.toType as Holder["type"], id: h.toId });
      }
      const holders = await describeHolders(ctx.db, org, holderList);
      const label = (type: string | null, id: string | null) =>
        type && id ? (holders.get(`${type}:${id}`)?.label ?? "Unknown") : null;
      return {
        ...asset,
        holder: holders.get(`${asset.holderType}:${asset.holderId}`)!,
        canManageAssets: ctx.canManageAssets,
        history: history.map((h) => ({
          ...h,
          from: label(h.fromType, h.fromId),
          to: label(h.toType, h.toId),
          by: h.userName || h.userEmail,
        })),
      };
    }),

  /** Everything one holder has: tagged tools and quantity stock. */
  holdings: assetsProcedure.input(z.object({ holder: holderInput })).query(async ({ ctx, input }) => {
    const org = ctx.organizationId;
    const [info] = [(await describeHolders(ctx.db, org, [input.holder])).get(holderKey(input.holder))!];
    const tools = await ctx.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        serialNumber: assets.serialNumber,
        status: assets.status,
        ...typeColumns,
      })
      .from(assets)
      .innerJoin(partDefinitions, eq(assets.partDefinitionId, partDefinitions.id))
      .where(
        and(
          eq(assets.organizationId, org),
          eq(assets.holderType, input.holder.type),
          eq(assets.holderId, input.holder.id),
          ne(assets.status, "retired"),
        ),
      )
      .orderBy(asc(partDefinitions.displayName), asc(assets.assetTag));
    const stock = await ctx.db
      .select({ quantity: assetStock.quantity, ...typeColumns })
      .from(assetStock)
      .innerJoin(partDefinitions, eq(assetStock.partDefinitionId, partDefinitions.id))
      .where(
        and(
          eq(assetStock.organizationId, org),
          eq(assetStock.holderType, input.holder.type),
          eq(assetStock.holderId, input.holder.id),
          gt(assetStock.quantity, "0"),
        ),
      )
      .orderBy(asc(partDefinitions.displayName));
    return {
      holder: info,
      tools,
      stock: stock.map((s) => ({ ...s, quantity: Number(s.quantity) })),
    };
  }),

  /** Recent movements across the organization (activity feed). */
  activity: assetsProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      const rows = await ctx.db
        .select({
          id: assetMovements.id,
          kind: assetMovements.kind,
          quantity: assetMovements.quantity,
          fromType: assetMovements.fromType,
          fromId: assetMovements.fromId,
          toType: assetMovements.toType,
          toId: assetMovements.toId,
          statusTo: assetMovements.statusTo,
          note: assetMovements.note,
          createdAt: assetMovements.createdAt,
          assetTag: assets.assetTag,
          toolName: partDefinitions.displayName,
          userName: users.name,
          userEmail: users.email,
        })
        .from(assetMovements)
        .innerJoin(partDefinitions, eq(assetMovements.partDefinitionId, partDefinitions.id))
        .leftJoin(assets, eq(assetMovements.assetId, assets.id))
        .leftJoin(users, eq(assetMovements.userId, users.id))
        .where(eq(assetMovements.organizationId, org))
        .orderBy(desc(assetMovements.createdAt))
        .limit(input.limit);
      const list: Holder[] = [];
      for (const r of rows) {
        if (r.fromType && r.fromId) list.push({ type: r.fromType as Holder["type"], id: r.fromId });
        if (r.toType && r.toId) list.push({ type: r.toType as Holder["type"], id: r.toId });
      }
      const holders = await describeHolders(ctx.db, org, list);
      const label = (type: string | null, id: string | null) =>
        type && id ? (holders.get(`${type}:${id}`)?.label ?? "Unknown") : null;
      return rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        from: label(r.fromType, r.fromId),
        to: label(r.toType, r.toId),
        by: r.userName || r.userEmail,
      }));
    }),

  // ───────────────────────────── Setup ─────────────────────────────

  /** Creates the tool room supplier, a tools catalog and a main yard. */
  setup: toolRoomProcedure.mutation(async ({ ctx }) => {
    return ctx.db.transaction((tx) => ensureAssetSetup(tx, ctx.organizationId));
  }),

  saveLocation: toolRoomProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        kind: z.enum(["warehouse", "vehicle"]),
        name: z.string().trim().min(1).max(255),
        notes: z.string().trim().max(2000).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      if (input.id) {
        if (input.isActive === false) {
          const [held] = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(assets)
            .where(and(eq(assets.organizationId, org), eq(assets.holderType, "location"), eq(assets.holderId, input.id), ne(assets.status, "retired")));
          const [stocked] = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(assetStock)
            .where(and(eq(assetStock.organizationId, org), eq(assetStock.holderType, "location"), eq(assetStock.holderId, input.id), gt(assetStock.quantity, "0")));
          if (Number(held?.count) || Number(stocked?.count)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Move the tools out of this location before archiving it." });
          }
        }
        const [row] = await ctx.db
          .update(assetLocations)
          .set({ kind: input.kind, name: input.name, notes: input.notes ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) })
          .where(and(eq(assetLocations.id, input.id), eq(assetLocations.organizationId, org)))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found." });
        return row;
      }
      const [row] = await ctx.db
        .insert(assetLocations)
        .values({ organizationId: org, kind: input.kind, name: input.name, notes: input.notes ?? null })
        .returning();
      return row!;
    }),

  // ───────────────────────────── Tools & stock ─────────────────────────────

  /** Adds individually tracked tools of one type at a location. */
  addAssets: toolRoomProcedure
    .input(
      z.object({
        partId: z.string().uuid(),
        locationId: z.string().uuid(),
        units: z
          .array(
            z.object({
              serialNumber: z.string().trim().max(120).optional(),
              assetTag: z.string().trim().max(40).optional(),
            }),
          )
          .min(1)
          .max(200),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        const [type] = await tx
          .select({ id: partDefinitions.id, tracking: partDefinitions.assetTracking })
          .from(partDefinitions)
          .innerJoin(catalogs, eq(partDefinitions.catalogId, catalogs.id))
          .where(and(eq(partDefinitions.id, input.partId), toolTypeFilter(org)))
          .limit(1);
        if (!type) throw new TRPCError({ code: "NOT_FOUND", message: "Tool type not found." });
        if (type.tracking === "quantity") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This tool type is tracked by quantity; receive stock instead." });
        }
        const location: Holder = { type: "location", id: input.locationId };
        await assertHolder(tx, org, location);
        const generated = await nextAssetTags(tx, org, input.units.filter((u) => !u.assetTag).length);
        const created = [];
        for (const unit of input.units) {
          const assetTag = unit.assetTag?.toUpperCase() || generated.shift()!;
          const [dup] = await tx
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.organizationId, org), sql`upper(${assets.assetTag}) = upper(${assetTag})`))
            .limit(1);
          if (dup) throw new TRPCError({ code: "CONFLICT", message: `Tag ${assetTag} is already used.` });
          const [asset] = await tx
            .insert(assets)
            .values({
              organizationId: org,
              partDefinitionId: input.partId,
              assetTag,
              serialNumber: unit.serialNumber || null,
              status: "available",
              holderType: "location",
              holderId: input.locationId,
            })
            .returning();
          await tx.insert(assetMovements).values({
            organizationId: org,
            kind: "receive",
            assetId: asset!.id,
            partDefinitionId: input.partId,
            quantity: "1",
            toType: "location",
            toId: input.locationId,
            statusTo: "available",
            note: input.note ?? null,
            userId: ctx.userId,
          });
          created.push(asset!);
        }
        return created;
      });
    }),

  updateAsset: toolRoomProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        assetTag: z.string().trim().min(1).max(40).optional(),
        serialNumber: z.string().trim().max(120).nullable().optional(),
        notes: z.string().trim().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      if (input.assetTag) {
        const [dup] = await ctx.db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.organizationId, org), sql`upper(${assets.assetTag}) = upper(${input.assetTag})`, ne(assets.id, input.id)))
          .limit(1);
        if (dup) throw new TRPCError({ code: "CONFLICT", message: `Tag ${input.assetTag} is already used.` });
      }
      const [row] = await ctx.db
        .update(assets)
        .set({
          ...(input.assetTag ? { assetTag: input.assetTag.toUpperCase() } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        })
        .where(and(eq(assets.id, input.id), eq(assets.organizationId, org)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found." });
      return row;
    }),

  /** New quantity-tracked stock arriving at a location. */
  receiveStock: toolRoomProcedure
    .input(
      z.object({
        partId: z.string().uuid(),
        locationId: z.string().uuid(),
        quantity: z.number().positive().max(1_000_000),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        const [type] = await tx
          .select({ tracking: partDefinitions.assetTracking })
          .from(partDefinitions)
          .innerJoin(catalogs, eq(partDefinitions.catalogId, catalogs.id))
          .where(and(eq(partDefinitions.id, input.partId), toolTypeFilter(org)))
          .limit(1);
        if (!type) throw new TRPCError({ code: "NOT_FOUND", message: "Tool type not found." });
        if (type.tracking !== "quantity") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This tool type is tracked individually; add tools instead." });
        }
        const to: Holder = { type: "location", id: input.locationId };
        await assertHolder(tx, org, to);
        await moveStock(tx, { organizationId: org, userId: ctx.userId, partId: input.partId, from: null, to, quantity: input.quantity, kind: "receive", note: input.note });
        return { ok: true };
      });
    }),

  /** Sets a holder's quantity of a tool type to an exact number. */
  adjustStock: toolRoomProcedure
    .input(
      z.object({
        partId: z.string().uuid(),
        holder: holderInput,
        quantity: z.number().min(0).max(1_000_000),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        await assertHolder(tx, org, input.holder);
        const [row] = await tx
          .select({ quantity: assetStock.quantity })
          .from(assetStock)
          .where(and(eq(assetStock.organizationId, org), eq(assetStock.partDefinitionId, input.partId), eq(assetStock.holderType, input.holder.type), eq(assetStock.holderId, input.holder.id)))
          .limit(1);
        const delta = input.quantity - Number(row?.quantity ?? 0);
        if (Math.abs(delta) < 1e-9) return { ok: true };
        await moveStock(tx, {
          organizationId: org,
          userId: ctx.userId,
          partId: input.partId,
          from: delta < 0 ? input.holder : null,
          to: delta > 0 ? input.holder : null,
          quantity: Math.abs(delta),
          kind: "adjust",
          note: input.note ?? null,
        });
        return { ok: true };
      });
    }),

  /**
   * Moves tools between holders. The tool room can move anything; everyone
   * else can move tools between jobs and people (returns to a warehouse go
   * through a return request so the tool room checks them in).
   */
  transfer: assetsProcedure
    .input(
      z.object({
        to: holderInput,
        assetIds: z.array(z.string().uuid()).max(500).default([]),
        stock: z
          .array(z.object({ partId: z.string().uuid(), from: holderInput, quantity: z.number().positive() }))
          .max(200)
          .default([]),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      if (!input.assetIds.length && !input.stock.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one tool to move." });
      }
      return ctx.db.transaction(async (tx) => {
        await assertHolder(tx, org, input.to);
        if (!ctx.canManageAssets) {
          const fieldOnly = "Only the tool room can move tools in or out of a warehouse or vehicle.";
          if (input.to.type === "location") throw new TRPCError({ code: "FORBIDDEN", message: fieldOnly });
          if (input.stock.some((line) => line.from.type === "location")) throw new TRPCError({ code: "FORBIDDEN", message: fieldOnly });
          if (input.assetIds.length) {
            const [atLocation] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(assets)
              .where(and(eq(assets.organizationId, org), inArray(assets.id, input.assetIds), eq(assets.holderType, "location")))
            if (Number(atLocation?.count)) throw new TRPCError({ code: "FORBIDDEN", message: fieldOnly });
          }
        }
        await moveAssets(tx, input.assetIds, input.to, { organizationId: org, userId: ctx.userId, kind: "transfer", note: input.note ?? null });
        for (const line of input.stock) {
          await moveStock(tx, { organizationId: org, userId: ctx.userId, partId: line.partId, from: line.from, to: input.to, quantity: line.quantity, kind: "transfer", note: input.note ?? null });
        }
        return { ok: true };
      });
    }),

  /** Anyone can report a tool damaged or missing. */
  reportProblem: assetsProcedure
    .input(z.object({ assetId: z.string().uuid(), status: z.enum(["damaged", "missing"]), note: z.string().trim().min(1, "Say what happened").max(2000) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction((tx) =>
        setAssetStatus(tx, { organizationId: ctx.organizationId, userId: ctx.userId, assetId: input.assetId, status: input.status, note: input.note }),
      );
    }),

  /** Tool room: repaired / found (back in service) or retired. */
  resolveProblem: toolRoomProcedure
    .input(z.object({ assetId: z.string().uuid(), outcome: z.enum(["in_service", "retired"]), note: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [asset] = await tx
          .select({ holderType: assets.holderType })
          .from(assets)
          .where(and(eq(assets.id, input.assetId), eq(assets.organizationId, ctx.organizationId)))
          .limit(1);
        if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found." });
        return setAssetStatus(tx, {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          assetId: input.assetId,
          status: input.outcome === "retired" ? "retired" : inServiceStatus(asset.holderType),
          note: input.note ?? null,
        });
      });
    }),

  // ───────────────────────────── Requests & returns ─────────────────────────────

  /** Tool requests and return requests (the tool room's queue). */
  listRequests: assetsProcedure
    .input(z.object({ status: z.enum(["open", "done", "all"]).default("open"), kind: z.enum(["tool_request", "tool_return"]).optional(), jobId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      const conditions = [
        eq(orders.organizationId, org),
        input.kind ? eq(orders.kind, input.kind) : inArray(orders.kind, ["tool_request", "tool_return"]),
      ];
      if (input.status === "open") conditions.push(inArray(orders.fulfillmentStatus, ["open", "partial"]));
      if (input.status === "done") conditions.push(inArray(orders.fulfillmentStatus, ["fulfilled", "cancelled"]));
      if (input.jobId) conditions.push(eq(orders.jobId, input.jobId));
      const rows = await ctx.db
        .select({
          id: orders.id,
          kind: orders.kind,
          orderNumber: orders.orderNumber,
          fulfillmentStatus: orders.fulfillmentStatus,
          notes: orders.notes,
          sentAt: orders.sentAt,
          fulfilledAt: orders.fulfilledAt,
          jobId: orders.jobId,
          jobName: jobs.name,
          materialListId: orders.materialListId,
          requestedBy: users.name,
          requestedByEmail: users.email,
          itemCount: sql<number>`(select count(*)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
          totalQuantity: sql<number>`(select coalesce(sum(${orderItems.quantity}), 0)::float from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
          fulfilledQuantity: sql<number>`(select coalesce(sum(${orderItems.fulfilledQuantity}), 0)::float from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
        })
        .from(orders)
        .leftJoin(jobs, eq(orders.jobId, jobs.id))
        .leftJoin(users, eq(orders.createdByUserId, users.id))
        .where(and(...conditions))
        .orderBy(desc(orders.sentAt), desc(orders.createdAt))
        .limit(200);
      return rows.map((r) => ({ ...r, requestedBy: r.requestedBy || r.requestedByEmail }));
    }),

  /** One request/return with its lines and what the tool room can pick from. */
  getRequest: assetsProcedure.input(z.object({ orderId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const org = ctx.organizationId;
    const order = await loadOrder(ctx.db, org, input.orderId);
    const [job] = await ctx.db.select({ name: jobs.name }).from(jobs).where(eq(jobs.id, order.jobId)).limit(1);
    const [requester] = order.createdByUserId
      ? await ctx.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, order.createdByUserId)).limit(1)
      : [];
    const lines = await ctx.db
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        fulfilledQuantity: orderItems.fulfilledQuantity,
        receivedQuantity: orderItems.receivedQuantity,
        verificationStatus: orderItems.verificationStatus,
        assetId: orderItems.assetId,
        ...typeColumns,
        lineDescription: orderItems.descriptionSnapshot,
        assetTag: assets.assetTag,
        assetStatus: assets.status,
        assetHolderType: assets.holderType,
        assetHolderId: assets.holderId,
      })
      .from(orderItems)
      .innerJoin(partDefinitions, eq(orderItems.partDefinitionId, partDefinitions.id))
      .leftJoin(assets, eq(orderItems.assetId, assets.id))
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(partDefinitions.displayName));
    const partIds = [...new Set(lines.map((l) => l.partId))];
    // What the tool room can pick from: tagged tools and stock at locations.
    const candidates = partIds.length && order.kind === "tool_request"
      ? await ctx.db
          .select({ id: assets.id, partId: assets.partDefinitionId, assetTag: assets.assetTag, serialNumber: assets.serialNumber, holderId: assets.holderId })
          .from(assets)
          .where(and(eq(assets.organizationId, org), inArray(assets.partDefinitionId, partIds), eq(assets.holderType, "location"), eq(assets.status, "available")))
          .orderBy(asc(assets.assetTag))
      : [];
    const stockCandidates = partIds.length && order.kind === "tool_request"
      ? await ctx.db
          .select({ partId: assetStock.partDefinitionId, holderId: assetStock.holderId, quantity: assetStock.quantity })
          .from(assetStock)
          .where(and(eq(assetStock.organizationId, org), inArray(assetStock.partDefinitionId, partIds), eq(assetStock.holderType, "location"), gt(assetStock.quantity, "0")))
      : [];
    const locationRows = await ctx.db
      .select({ id: assetLocations.id, name: assetLocations.name, kind: assetLocations.kind, isActive: assetLocations.isActive })
      .from(assetLocations)
      .where(eq(assetLocations.organizationId, org));
    const locationName = new Map(locationRows.map((l) => [l.id, l.name]));
    return {
      id: order.id,
      kind: order.kind as "tool_request" | "tool_return",
      orderNumber: order.orderNumber,
      fulfillmentStatus: order.fulfillmentStatus,
      notes: order.notes,
      sentAt: order.sentAt,
      jobId: order.jobId,
      jobName: job?.name ?? "Job",
      materialListId: order.materialListId,
      requestedBy: requester?.name || requester?.email || null,
      canManageAssets: ctx.canManageAssets,
      locations: locationRows.filter((l) => l.isActive),
      lines: lines.map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        fulfilledQuantity: Number(l.fulfilledQuantity ?? 0),
        tracking: l.tracking === "quantity" ? ("quantity" as const) : ("serialized" as const),
        availableTools: candidates
          .filter((c) => c.partId === l.partId)
          .map((c) => ({ ...c, locationName: locationName.get(c.holderId) ?? "Location" })),
        availableStock: stockCandidates
          .filter((c) => c.partId === l.partId)
          .map((c) => ({ locationId: c.holderId, locationName: locationName.get(c.holderId) ?? "Location", quantity: Number(c.quantity) })),
      })),
    };
  }),

  /** Tool room checks tools out to the job against a request. */
  fulfillRequest: toolRoomProcedure
    .input(
      z.object({
        orderId: z.string().uuid(),
        lines: z
          .array(
            z.object({
              orderItemId: z.string().uuid(),
              assetIds: z.array(z.string().uuid()).max(200).default([]),
              stock: z.array(z.object({ locationId: z.string().uuid(), quantity: z.number().positive() })).max(20).default([]),
            }),
          )
          .min(1),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        const order = await loadOrder(tx, org, input.orderId);
        if (order.kind !== "tool_request") throw new TRPCError({ code: "BAD_REQUEST", message: "This is a return, not a request." });
        if (order.fulfillmentStatus === "fulfilled" || order.fulfillmentStatus === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This request is already closed." });
        }
        const job: Holder = { type: "job", id: order.jobId };
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
        const itemById = new Map(items.map((i) => [i.id, i]));
        for (const line of input.lines) {
          const item = itemById.get(line.orderItemId);
          if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Request line not found." });
          let given = 0;
          if (line.assetIds.length) {
            const picked = await tx
              .select({ id: assets.id, partId: assets.partDefinitionId, holderType: assets.holderType, status: assets.status, tag: assets.assetTag })
              .from(assets)
              .where(and(eq(assets.organizationId, org), inArray(assets.id, line.assetIds)));
            for (const tool of picked) {
              if (tool.partId !== item.partDefinitionId) throw new TRPCError({ code: "BAD_REQUEST", message: `${tool.tag} is a different tool type.` });
              if (tool.holderType !== "location" || tool.status !== "available") {
                throw new TRPCError({ code: "BAD_REQUEST", message: `${tool.tag} is not available in a warehouse or vehicle.` });
              }
            }
            await moveAssets(tx, line.assetIds, job, { organizationId: org, userId: ctx.userId, kind: "checkout", orderId: order.id, note: input.note ?? null });
            given += picked.length;
          }
          for (const pick of line.stock) {
            await moveStock(tx, { organizationId: org, userId: ctx.userId, partId: item.partDefinitionId, from: { type: "location", id: pick.locationId }, to: job, quantity: pick.quantity, kind: "checkout", orderId: order.id, note: input.note ?? null });
            given += pick.quantity;
          }
          if (given > 0) {
            await tx
              .update(orderItems)
              .set({ fulfilledQuantity: String(Number(item.fulfilledQuantity ?? 0) + given) })
              .where(eq(orderItems.id, item.id));
          }
        }
        return updateFulfillment(tx, order.id);
      });
    }),

  /** Anyone: ask the tool room to take tools back from a job. */
  requestReturn: assetsProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        assetIds: z.array(z.string().uuid()).max(500).default([]),
        stock: z.array(z.object({ partId: z.string().uuid(), quantity: z.number().positive() })).max(200).default([]),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      if (!input.assetIds.length && !input.stock.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one tool to return." });
      return ctx.db.transaction(async (tx) => {
        const job: Holder = { type: "job", id: input.jobId };
        await assertHolder(tx, org, job);
        const tools = input.assetIds.length
          ? await tx
              .select({ id: assets.id, partId: assets.partDefinitionId, tag: assets.assetTag, holderType: assets.holderType, holderId: assets.holderId, name: partDefinitions.displayName })
              .from(assets)
              .innerJoin(partDefinitions, eq(assets.partDefinitionId, partDefinitions.id))
              .where(and(eq(assets.organizationId, org), inArray(assets.id, input.assetIds)))
          : [];
        for (const tool of tools) {
          if (tool.holderType !== "job" || tool.holderId !== input.jobId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${tool.tag} is not at this job.` });
          }
        }
        for (const line of input.stock) {
          const [held] = await tx
            .select({ quantity: assetStock.quantity })
            .from(assetStock)
            .where(and(eq(assetStock.organizationId, org), eq(assetStock.partDefinitionId, line.partId), eq(assetStock.holderType, "job"), eq(assetStock.holderId, input.jobId)))
            .limit(1);
          if (Number(held?.quantity ?? 0) + 1e-9 < line.quantity) throw new TRPCError({ code: "BAD_REQUEST", message: "Return quantity is more than the job has." });
        }
        const supplierId = await ensureToolRoomSupplier(tx, org);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${org}:${input.jobId}:orders`}))`);
        const [seq] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .where(and(eq(orders.organizationId, org), eq(orders.jobId, input.jobId), eq(orders.kind, "tool_return")));
        const [order] = await tx
          .insert(orders)
          .values({
            organizationId: org,
            jobId: input.jobId,
            kind: "tool_return",
            orderNumber: `RETURN-${String(Number(seq?.count ?? 0) + 1).padStart(3, "0")}`,
            supplierId,
            createdByUserId: ctx.userId,
            status: "sent",
            sentVia: "tool_room",
            sentTo: "Tool room",
            sentAt: new Date(),
            fulfillmentStatus: "open",
            notes: input.note ?? null,
          })
          .returning();
        const stockNames = input.stock.length
          ? await tx.select({ id: partDefinitions.id, name: partDefinitions.displayName }).from(partDefinitions).where(inArray(partDefinitions.id, input.stock.map((l) => l.partId)))
          : [];
        const values = [
          ...tools.map((tool) => ({ orderId: order!.id, partDefinitionId: tool.partId, assetId: tool.id, quantity: "1", descriptionSnapshot: `${tool.name} (${tool.tag})` })),
          ...input.stock.map((line) => ({ orderId: order!.id, partDefinitionId: line.partId, quantity: String(line.quantity), descriptionSnapshot: stockNames.find((n) => n.id === line.partId)?.name ?? null })),
        ];
        await tx.insert(orderItems).values(values);
        return order!;
      });
    }),

  /** Tool room receives a return into a warehouse or vehicle. */
  receiveReturn: toolRoomProcedure
    .input(
      z.object({
        orderId: z.string().uuid(),
        locationId: z.string().uuid(),
        lines: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().positive() })).min(1),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        const order = await loadOrder(tx, org, input.orderId);
        if (order.kind !== "tool_return") throw new TRPCError({ code: "BAD_REQUEST", message: "This is a request, not a return." });
        const location: Holder = { type: "location", id: input.locationId };
        await assertHolder(tx, org, location);
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
        const itemById = new Map(items.map((i) => [i.id, i]));
        for (const line of input.lines) {
          const item = itemById.get(line.orderItemId);
          if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Return line not found." });
          const outstanding = Number(item.quantity) - Number(item.fulfilledQuantity ?? 0);
          const quantity = Math.min(line.quantity, outstanding);
          if (quantity <= 0) continue;
          if (item.assetId) {
            await moveAssets(tx, [item.assetId], location, { organizationId: org, userId: ctx.userId, kind: "return", orderId: order.id, note: input.note ?? null });
          } else {
            await moveStock(tx, { organizationId: org, userId: ctx.userId, partId: item.partDefinitionId, from: { type: "job", id: order.jobId }, to: location, quantity, kind: "return", orderId: order.id, note: input.note ?? null });
          }
          await tx
            .update(orderItems)
            .set({ fulfilledQuantity: String(Number(item.fulfilledQuantity ?? 0) + quantity) })
            .where(eq(orderItems.id, item.id));
        }
        return updateFulfillment(tx, order.id);
      });
    }),

  /** Tool room closes a request or return without (further) filling it. */
  cancelRequest: toolRoomProcedure
    .input(z.object({ orderId: z.string().uuid(), note: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.organizationId, input.orderId);
      const [row] = await ctx.db
        .update(orders)
        .set({
          fulfillmentStatus: "cancelled",
          fulfilledAt: new Date(),
          notes: input.note ? [order.notes, `Closed: ${input.note}`].filter(Boolean).join("\n") : order.notes,
        })
        .where(eq(orders.id, order.id))
        .returning();
      return row;
    }),

  /** Tool room checks tools straight in (e.g. scanning tools as they arrive). */
  checkIn: toolRoomProcedure
    .input(
      z.object({
        locationId: z.string().uuid(),
        assetIds: z.array(z.string().uuid()).max(500).default([]),
        stock: z.array(z.object({ partId: z.string().uuid(), from: holderInput, quantity: z.number().positive() })).max(200).default([]),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        const location: Holder = { type: "location", id: input.locationId };
        await assertHolder(tx, org, location);
        await moveAssets(tx, input.assetIds, location, { organizationId: org, userId: ctx.userId, kind: "return", note: input.note ?? null });
        for (const line of input.stock) {
          await moveStock(tx, { organizationId: org, userId: ctx.userId, partId: line.partId, from: line.from, to: location, quantity: line.quantity, kind: "return", note: input.note ?? null });
        }
        return { ok: true };
      });
    }),

  // ───────────────────────────── Counts & audits ─────────────────────────────

  listCounts: assetsProcedure
    .input(z.object({ status: z.enum(["open", "completed", "all"]).default("all") }))
    .query(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      const rows = await ctx.db
        .select({
          id: assetCounts.id,
          status: assetCounts.status,
          holderType: assetCounts.holderType,
          holderId: assetCounts.holderId,
          createdAt: assetCounts.createdAt,
          completedAt: assetCounts.completedAt,
          startedBy: users.name,
          lines: sql<number>`(select count(*)::int from ${assetCountLines} where ${assetCountLines.countId} = ${assetCounts.id})`,
          counted: sql<number>`(select count(*)::int from ${assetCountLines} where ${assetCountLines.countId} = ${assetCounts.id} and ${assetCountLines.countedQuantity} is not null)`,
        })
        .from(assetCounts)
        .leftJoin(users, eq(assetCounts.startedByUserId, users.id))
        .where(and(eq(assetCounts.organizationId, org), ...(input.status === "all" ? [] : [eq(assetCounts.status, input.status)])))
        .orderBy(desc(assetCounts.createdAt))
        .limit(100);
      const holders = await describeHolders(ctx.db, org, rows.map((r) => ({ type: r.holderType as Holder["type"], id: r.holderId })));
      return rows.map((r) => ({ ...r, holder: holders.get(`${r.holderType}:${r.holderId}`)! }));
    }),

  /** Starts a count: snapshot of everything the holder should have. */
  startCount: toolRoomProcedure
    .input(z.object({ holder: holderInput, notes: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        await assertHolder(tx, org, input.holder);
        const [count] = await tx
          .insert(assetCounts)
          .values({ organizationId: org, holderType: input.holder.type, holderId: input.holder.id, notes: input.notes ?? null, startedByUserId: ctx.userId })
          .returning();
        const tools = await tx
          .select({ id: assets.id, partId: assets.partDefinitionId })
          .from(assets)
          .where(and(eq(assets.organizationId, org), eq(assets.holderType, input.holder.type), eq(assets.holderId, input.holder.id), ne(assets.status, "retired")));
        const stock = await tx
          .select({ partId: assetStock.partDefinitionId, quantity: assetStock.quantity })
          .from(assetStock)
          .where(and(eq(assetStock.organizationId, org), eq(assetStock.holderType, input.holder.type), eq(assetStock.holderId, input.holder.id), gt(assetStock.quantity, "0")));
        const lines = [
          ...tools.map((t) => ({ countId: count!.id, assetId: t.id, partDefinitionId: t.partId, expectedQuantity: "1" })),
          ...stock.map((st) => ({ countId: count!.id, partDefinitionId: st.partId, expectedQuantity: String(st.quantity) })),
        ];
        if (lines.length) await tx.insert(assetCountLines).values(lines);
        return count!;
      });
    }),

  getCount: assetsProcedure.input(z.object({ countId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const org = ctx.organizationId;
    const [count] = await ctx.db
      .select()
      .from(assetCounts)
      .where(and(eq(assetCounts.id, input.countId), eq(assetCounts.organizationId, org)))
      .limit(1);
    if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Count not found." });
    const lines = await ctx.db
      .select({
        id: assetCountLines.id,
        assetId: assetCountLines.assetId,
        expected: assetCountLines.expectedQuantity,
        counted: assetCountLines.countedQuantity,
        assetTag: assets.assetTag,
        serialNumber: assets.serialNumber,
        assetStatus: assets.status,
        ...typeColumns,
      })
      .from(assetCountLines)
      .innerJoin(partDefinitions, eq(assetCountLines.partDefinitionId, partDefinitions.id))
      .leftJoin(assets, eq(assetCountLines.assetId, assets.id))
      .where(eq(assetCountLines.countId, count.id))
      .orderBy(asc(partDefinitions.displayName), asc(assets.assetTag));
    const holder = (await describeHolders(ctx.db, org, [{ type: count.holderType as Holder["type"], id: count.holderId }])).get(`${count.holderType}:${count.holderId}`)!;
    return {
      ...count,
      holder,
      canManageAssets: ctx.canManageAssets,
      lines: lines.map((l) => ({
        ...l,
        expected: Number(l.expected),
        counted: l.counted === null ? null : Number(l.counted),
        tracking: l.assetId ? ("serialized" as const) : ("quantity" as const),
      })),
    };
  }),

  recordCountLine: toolRoomProcedure
    .input(z.object({ lineId: z.string().uuid(), counted: z.number().min(0).max(1_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [line] = await ctx.db
        .select({ countId: assetCountLines.countId, assetId: assetCountLines.assetId, status: assetCounts.status })
        .from(assetCountLines)
        .innerJoin(assetCounts, eq(assetCountLines.countId, assetCounts.id))
        .where(and(eq(assetCountLines.id, input.lineId), eq(assetCounts.organizationId, ctx.organizationId)))
        .limit(1);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Count line not found." });
      if (line.status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "This count is closed." });
      const counted = input.counted === null ? null : line.assetId ? Math.min(1, Math.round(input.counted)) : input.counted;
      await ctx.db.update(assetCountLines).set({ countedQuantity: counted === null ? null : String(counted) }).where(eq(assetCountLines.id, input.lineId));
      return { ok: true };
    }),

  /** Scanning a tag during a count: ticks it, or records a tool found here unexpectedly. */
  scanForCount: toolRoomProcedure
    .input(z.object({ countId: z.string().uuid(), tag: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      const [count] = await ctx.db.select().from(assetCounts).where(and(eq(assetCounts.id, input.countId), eq(assetCounts.organizationId, org))).limit(1);
      if (!count || count.status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "This count is not open." });
      const [asset] = await ctx.db
        .select({ id: assets.id, partId: assets.partDefinitionId, tag: assets.assetTag, name: partDefinitions.displayName })
        .from(assets)
        .innerJoin(partDefinitions, eq(assets.partDefinitionId, partDefinitions.id))
        .where(and(eq(assets.organizationId, org), sql`upper(${assets.assetTag}) = upper(${input.tag})`))
        .limit(1);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: `No tool with tag ${input.tag}.` });
      const [line] = await ctx.db
        .select({ id: assetCountLines.id })
        .from(assetCountLines)
        .where(and(eq(assetCountLines.countId, count.id), eq(assetCountLines.assetId, asset.id)))
        .limit(1);
      if (line) {
        await ctx.db.update(assetCountLines).set({ countedQuantity: "1" }).where(eq(assetCountLines.id, line.id));
        return { tag: asset.tag, name: asset.name, expected: true };
      }
      await ctx.db.insert(assetCountLines).values({ countId: count.id, assetId: asset.id, partDefinitionId: asset.partId, expectedQuantity: "0", countedQuantity: "1" });
      return { tag: asset.tag, name: asset.name, expected: false };
    }),

  /**
   * Completes a count: tagged tools not found become missing, tools found
   * here that belonged elsewhere are moved here, and quantities are corrected.
   * Lines left uncounted are not changed.
   */
  completeCount: toolRoomProcedure
    .input(z.object({ countId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.organizationId;
      return ctx.db.transaction(async (tx) => {
        const [count] = await tx.select().from(assetCounts).where(and(eq(assetCounts.id, input.countId), eq(assetCounts.organizationId, org))).limit(1);
        if (!count || count.status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "This count is not open." });
        const holder: Holder = { type: count.holderType as Holder["type"], id: count.holderId };
        const lines = await tx.select().from(assetCountLines).where(eq(assetCountLines.countId, count.id));
        const summary = { missing: 0, found: 0, adjusted: 0, unchanged: 0, skipped: 0 };
        const note = "Count";
        for (const line of lines) {
          if (line.countedQuantity === null) {
            summary.skipped++;
            continue;
          }
          const expected = Number(line.expectedQuantity);
          const counted = Number(line.countedQuantity);
          if (line.assetId) {
            const [asset] = await tx.select().from(assets).where(eq(assets.id, line.assetId)).limit(1);
            if (!asset) continue;
            if (counted >= 1) {
              const elsewhere = asset.holderType !== holder.type || asset.holderId !== holder.id;
              if (elsewhere) {
                await moveAssets(tx, [asset.id], holder, { organizationId: org, userId: ctx.userId, kind: "count", countId: count.id, note: `${note}: found here` });
                summary.found++;
              } else if (asset.status === "missing") {
                await setAssetStatus(tx, { organizationId: org, userId: ctx.userId, assetId: asset.id, status: inServiceStatus(asset.holderType), note: `${note}: found`, countId: count.id });
                summary.found++;
              } else summary.unchanged++;
            } else if (expected >= 1) {
              await setAssetStatus(tx, { organizationId: org, userId: ctx.userId, assetId: asset.id, status: "missing", note: `${note}: not found`, countId: count.id });
              summary.missing++;
            }
            continue;
          }
          const [held] = await tx
            .select({ quantity: assetStock.quantity })
            .from(assetStock)
            .where(and(eq(assetStock.organizationId, org), eq(assetStock.partDefinitionId, line.partDefinitionId), eq(assetStock.holderType, holder.type), eq(assetStock.holderId, holder.id)))
            .limit(1);
          const delta = counted - Number(held?.quantity ?? 0);
          if (Math.abs(delta) < 1e-9) {
            summary.unchanged++;
            continue;
          }
          await moveStock(tx, { organizationId: org, userId: ctx.userId, partId: line.partDefinitionId, from: delta < 0 ? holder : null, to: delta > 0 ? holder : null, quantity: Math.abs(delta), kind: "count", countId: count.id, note });
          summary.adjusted++;
        }
        await tx.update(assetCounts).set({ status: "completed", completedAt: new Date(), completedByUserId: ctx.userId }).where(eq(assetCounts.id, count.id));
        return summary;
      });
    }),

  cancelCount: toolRoomProcedure.input(z.object({ countId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .update(assetCounts)
      .set({ status: "cancelled", completedAt: new Date(), completedByUserId: ctx.userId })
      .where(and(eq(assetCounts.id, input.countId), eq(assetCounts.organizationId, ctx.organizationId), eq(assetCounts.status, "open")))
      .returning();
    if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "This count is not open." });
    return row;
  }),
});
