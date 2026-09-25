/**
 * Asset management core. Every change of holder, quantity or status goes
 * through these helpers so the movement history is always complete.
 *
 * A "holder" is where a tool is: an asset location (warehouse or vehicle),
 * a job, or a person (user id).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { db as appDb } from "~/server/db";
import {
  assetLocations,
  assetMovements,
  assetStock,
  assets,
  catalogs,
  jobs,
  partDefinitions,
  suppliers,
  users,
} from "~/server/db/schema";

type Db = typeof appDb;
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const HOLDER_TYPES = ["location", "job", "user"] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];
export type Holder = { type: HolderType; id: string };

export const ASSET_STATUSES = [
  "available",
  "in_use",
  "damaged",
  "missing",
  "retired",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const holderKey = (holder: Holder) => `${holder.type}:${holder.id}`;

function fail(message: string, code: TRPCError["code"] = "BAD_REQUEST"): never {
  throw new TRPCError({ code, message });
}

/** The organization's own tool room, used as the "supplier" of tool requests. */
export async function ensureToolRoomSupplier(tx: Tx, organizationId: string) {
  const [existing] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.kind, "tool_room")))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(suppliers)
    .values({
      organizationId,
      name: "Tool Room",
      kind: "tool_room",
      orderingNotes: "Internal: tool requests are filled from company stock.",
    })
    .returning({ id: suppliers.id });
  return created!.id;
}

/** Creates the tool room supplier, a tools catalog and a main yard if missing. */
export async function ensureAssetSetup(tx: Tx, organizationId: string) {
  const toolRoomSupplierId = await ensureToolRoomSupplier(tx, organizationId);
  const [catalog] = await tx
    .select({ id: catalogs.id })
    .from(catalogs)
    .where(and(eq(catalogs.organizationId, organizationId), eq(catalogs.kind, "assets")))
    .limit(1);
  if (!catalog) {
    const [maxSort] = await tx
      .select({ value: sql<number>`coalesce(max(${catalogs.sortOrder}), -1)` })
      .from(catalogs)
      .where(eq(catalogs.organizationId, organizationId));
    await tx.insert(catalogs).values({
      organizationId,
      name: "Tools & Equipment",
      kind: "assets",
      sortOrder: (maxSort?.value ?? -1) + 1,
    });
  }
  const [location] = await tx
    .select({ id: assetLocations.id })
    .from(assetLocations)
    .where(eq(assetLocations.organizationId, organizationId))
    .limit(1);
  if (!location) {
    await tx.insert(assetLocations).values({
      organizationId,
      kind: "warehouse",
      name: "Main Yard",
    });
  }
  return { toolRoomSupplierId };
}

/** Throws unless the holder exists in this organization (and is active). */
export async function assertHolder(tx: Tx, organizationId: string, holder: Holder) {
  if (holder.type === "location") {
    const [row] = await tx
      .select({ id: assetLocations.id, isActive: assetLocations.isActive })
      .from(assetLocations)
      .where(and(eq(assetLocations.id, holder.id), eq(assetLocations.organizationId, organizationId)))
      .limit(1);
    if (!row) fail("That location was not found.", "NOT_FOUND");
    if (!row.isActive) fail("That location is archived.");
    return;
  }
  if (holder.type === "job") {
    const [row] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, holder.id), eq(jobs.organizationId, organizationId)))
      .limit(1);
    if (!row) fail("That job was not found.", "NOT_FOUND");
    return;
  }
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, holder.id), eq(users.organizationId, organizationId)))
    .limit(1);
  if (!row) fail("That person is not in your organization.", "NOT_FOUND");
}

export type HolderInfo = {
  type: HolderType;
  id: string;
  /** warehouse | vehicle | job | person */
  kind: string;
  label: string;
};

/** Display names for a set of holders. Unknown holders get a generic label. */
export async function describeHolders(tx: Tx, organizationId: string, holders: Holder[]) {
  const out = new Map<string, HolderInfo>();
  const ids = (type: HolderType) => [...new Set(holders.filter((h) => h.type === type).map((h) => h.id))];
  const locationIds = ids("location");
  const jobIds = ids("job");
  const userIds = ids("user");
  if (locationIds.length) {
    const rows = await tx
      .select({ id: assetLocations.id, name: assetLocations.name, kind: assetLocations.kind })
      .from(assetLocations)
      .where(and(eq(assetLocations.organizationId, organizationId), inArray(assetLocations.id, locationIds)));
    for (const row of rows) out.set(`location:${row.id}`, { type: "location", id: row.id, kind: row.kind, label: row.name });
  }
  if (jobIds.length) {
    const rows = await tx
      .select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(and(eq(jobs.organizationId, organizationId), inArray(jobs.id, jobIds)));
    for (const row of rows) out.set(`job:${row.id}`, { type: "job", id: row.id, kind: "job", label: row.name });
  }
  if (userIds.length) {
    const rows = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), inArray(users.id, userIds)));
    for (const row of rows) out.set(`user:${row.id}`, { type: "user", id: row.id, kind: "person", label: row.name || row.email });
  }
  for (const holder of holders) {
    if (!out.has(holderKey(holder))) {
      out.set(holderKey(holder), { ...holder, kind: holder.type === "user" ? "person" : holder.type, label: "Unknown" });
    }
  }
  return out;
}

/** Reserves the next `count` asset tags (T-00001, T-00002, …) for the organization. */
export async function nextAssetTags(tx: Tx, organizationId: string, count: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:asset-tags`}))`);
  const [row] = await tx
    .select({
      max: sql<number>`coalesce(max(substring(${assets.assetTag} from '^T-([0-9]+)$')::int), 0)`,
    })
    .from(assets)
    .where(eq(assets.organizationId, organizationId));
  const start = Number(row?.max ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => `T-${String(start + i).padStart(5, "0")}`);
}

/** Status a tool should have after moving to `holder`, unless it is damaged/retired. */
function statusAfterMove(current: string, to: Holder): AssetStatus {
  if (current === "damaged" || current === "retired") return current;
  return to.type === "location" ? "available" : "in_use";
}

type MoveOptions = {
  organizationId: string;
  userId: string | null;
  kind: "checkout" | "return" | "transfer" | "count";
  orderId?: string | null;
  countId?: string | null;
  note?: string | null;
};

/** Moves serialized tools to a new holder, recording one movement each. */
export async function moveAssets(tx: Tx, assetIds: string[], to: Holder, options: MoveOptions) {
  if (!assetIds.length) return [];
  const rows = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.organizationId, options.organizationId), inArray(assets.id, assetIds)));
  if (rows.length !== new Set(assetIds).size) fail("Some tools were not found.", "NOT_FOUND");
  for (const asset of rows) {
    if (asset.status === "retired") fail(`${asset.assetTag} is retired and cannot be moved.`);
    const statusTo = statusAfterMove(asset.status, to);
    await tx
      .update(assets)
      .set({ holderType: to.type, holderId: to.id, status: statusTo })
      .where(eq(assets.id, asset.id));
    await tx.insert(assetMovements).values({
      organizationId: options.organizationId,
      kind: options.kind,
      assetId: asset.id,
      partDefinitionId: asset.partDefinitionId,
      quantity: "1",
      fromType: asset.holderType,
      fromId: asset.holderId,
      toType: to.type,
      toId: to.id,
      statusFrom: asset.status,
      statusTo,
      orderId: options.orderId ?? null,
      countId: options.countId ?? null,
      note: options.note ?? null,
      userId: options.userId,
    });
  }
  return rows;
}

async function stockRow(tx: Tx, organizationId: string, partId: string, holder: Holder) {
  const [row] = await tx
    .select()
    .from(assetStock)
    .where(
      and(
        eq(assetStock.organizationId, organizationId),
        eq(assetStock.partDefinitionId, partId),
        eq(assetStock.holderType, holder.type),
        eq(assetStock.holderId, holder.id),
      ),
    )
    .limit(1);
  return row;
}

async function addToStock(tx: Tx, organizationId: string, partId: string, holder: Holder, delta: number) {
  await tx
    .insert(assetStock)
    .values({
      organizationId,
      partDefinitionId: partId,
      holderType: holder.type,
      holderId: holder.id,
      quantity: String(delta),
    })
    .onConflictDoUpdate({
      target: [assetStock.organizationId, assetStock.partDefinitionId, assetStock.holderType, assetStock.holderId],
      set: { quantity: sql`${assetStock.quantity} + ${delta}`, updatedAt: new Date() },
    });
}

/**
 * Moves a quantity of a quantity-tracked tool type. `from` null = receiving
 * new stock; `to` null = writing stock off. Never lets a holder go negative.
 */
export async function moveStock(
  tx: Tx,
  input: {
    partId: string;
    from: Holder | null;
    to: Holder | null;
    quantity: number;
    kind: "receive" | "checkout" | "return" | "transfer" | "adjust" | "count";
  } & Omit<MoveOptions, "kind">,
) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) fail("Quantity must be more than zero.");
  if (input.from) {
    const held = await stockRow(tx, input.organizationId, input.partId, input.from);
    const available = Number(held?.quantity ?? 0);
    if (available + 1e-9 < quantity) {
      const [part] = await tx
        .select({ name: partDefinitions.displayName })
        .from(partDefinitions)
        .where(eq(partDefinitions.id, input.partId))
        .limit(1);
      fail(`Only ${available} of ${part?.name ?? "that tool"} available there.`);
    }
    await addToStock(tx, input.organizationId, input.partId, input.from, -quantity);
  }
  if (input.to) await addToStock(tx, input.organizationId, input.partId, input.to, quantity);
  await tx.insert(assetMovements).values({
    organizationId: input.organizationId,
    kind: input.kind,
    partDefinitionId: input.partId,
    quantity: String(quantity),
    fromType: input.from?.type ?? null,
    fromId: input.from?.id ?? null,
    toType: input.to?.type ?? null,
    toId: input.to?.id ?? null,
    orderId: input.orderId ?? null,
    countId: input.countId ?? null,
    note: input.note ?? null,
    userId: input.userId,
  });
}

/** Changes a tool's status (damaged, missing, repaired, found, retired). */
export async function setAssetStatus(
  tx: Tx,
  input: { organizationId: string; userId: string | null; assetId: string; status: AssetStatus; note?: string | null; countId?: string | null },
) {
  const [asset] = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.id, input.assetId), eq(assets.organizationId, input.organizationId)))
    .limit(1);
  if (!asset) fail("Tool not found.", "NOT_FOUND");
  if (asset.status === input.status) return asset;
  await tx.update(assets).set({ status: input.status }).where(eq(assets.id, asset.id));
  await tx.insert(assetMovements).values({
    organizationId: input.organizationId,
    kind: input.countId ? "count" : "status",
    assetId: asset.id,
    partDefinitionId: asset.partDefinitionId,
    quantity: "1",
    fromType: asset.holderType,
    fromId: asset.holderId,
    toType: asset.holderType,
    toId: asset.holderId,
    statusFrom: asset.status,
    statusTo: input.status,
    countId: input.countId ?? null,
    note: input.note ?? null,
    userId: input.userId,
  });
  return { ...asset, status: input.status };
}

/** Status for a tool that is back in service at its current holder. */
export function inServiceStatus(holderType: string): AssetStatus {
  return holderType === "location" ? "available" : "in_use";
}
