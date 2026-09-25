/**
 * End-to-end check of Asset Management against the real database, inside a
 * throwaway organization that is deleted afterwards (real data is untouched).
 *
 *   node --import dotenv/config --import tsx \
 *     --import ./scripts/bench/register-stubs.mjs scripts/assets/check-asset-flow.ts
 *
 * Covers: setup, tool types (tagged + quantity), adding tools and stock, a
 * tool request list created through the Replicache push path, generating and
 * sending the order to the tool room, fulfilment, the foreman's return,
 * receiving it, transfers, damaged/missing handling, and a count.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { appRouter } from "~/server/api/root";
import { db } from "~/server/db";
import {
  assetCountLines,
  assetCounts,
  assetLocations,
  assetMovements,
  assetStock,
  assets,
  jobs,
  organizations,
  users,
} from "~/server/db/schema";
import { handleMaterialListReplicachePush } from "~/server/replicache/material-list-sync";
import { MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";

// CLEANUP_ORG=<id> only removes a test org left behind by an interrupted run.
const cleanupOnly = process.env.CLEANUP_ORG;
const orgId = cleanupOnly ?? randomUUID();
const toolRoomUserId = `test-toolroom-${randomUUID()}`;
const foremanUserId = `test-foreman-${randomUUID()}`;
const jobId = randomUUID();
const steps: string[] = [];
const step = (message: string) => {
  steps.push(message);
  console.log(`✓ ${message}`);
};

async function cleanup() {
  const assetIds = (await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))).map((a) => a.id);
  const countIds = (await db.select({ id: assetCounts.id }).from(assetCounts).where(eq(assetCounts.organizationId, orgId))).map((c) => c.id);
  if (countIds.length) await db.delete(assetCountLines).where(inArray(assetCountLines.countId, countIds));
  await db.delete(assetCounts).where(eq(assetCounts.organizationId, orgId));
  await db.delete(assetMovements).where(eq(assetMovements.organizationId, orgId));
  if (assetIds.length) await db.delete(assets).where(inArray(assets.id, assetIds));
  await db.delete(assetStock).where(eq(assetStock.organizationId, orgId));
  await db.delete(assetLocations).where(eq(assetLocations.organizationId, orgId));
  // Jobs first: that cascades lists, quotes and orders, which hold part references.
  await db.delete(jobs).where(eq(jobs.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}

try {
  if (cleanupOnly) throw new Error("cleanup-only");
  await db.insert(organizations).values({ id: orgId, name: `Asset flow check ${orgId.slice(0, 8)}` });
  await db.insert(users).values([
    { id: toolRoomUserId, email: `${toolRoomUserId}@example.invalid`, name: "Tool Room Tess", organizationId: orgId, role: "user", permissionConfig: { actions: { canManageAssets: true } } },
    { id: foremanUserId, email: `${foremanUserId}@example.invalid`, name: "Foreman Frank", organizationId: orgId, role: "user" },
  ]);
  await db.insert(jobs).values({ id: jobId, organizationId: orgId, name: "Test Tower" });
  const [toolRoomUser] = await db.select().from(users).where(eq(users.id, toolRoomUserId));
  const [foremanUser] = await db.select().from(users).where(eq(users.id, foremanUserId));
  const as = (user: typeof toolRoomUser) =>
    appRouter.createCaller({ db, userId: user!.id, user, headers: new Headers() } as never);
  const toolRoom = as(toolRoomUser);
  const foreman = as(foremanUser);

  // Permissions: the foreman (standard account, no tool room) can't manage.
  await assert.rejects(() => foreman.assets.setup(), /tool room/i);
  step("non-tool-room member cannot run tool-room actions");

  await toolRoom.assets.setup();
  const overview = await toolRoom.assets.overview();
  assert.equal(overview.isSetUp, true);
  assert.equal(overview.canManageAssets, true);
  const holders = await toolRoom.assets.holders();
  const yard = holders.locations.find((l) => l.name === "Main Yard")!;
  assert.ok(yard, "main yard created");
  const truck = await toolRoom.assets.saveLocation({ kind: "vehicle", name: "Truck 7" });
  step("setup: tool room supplier, tools catalog, Main Yard, plus a vehicle");

  const catalogs = await toolRoom.catalogue.getCatalogs();
  const toolCatalog = catalogs.find((c) => c.kind === "assets")!;
  assert.ok(toolCatalog, "tools catalog exists");
  const drill = await toolRoom.catalogue.createPart({ displayName: "Test Hammer Drill", catalogId: toolCatalog.id, assetTracking: "serialized" });
  const blade = await toolRoom.catalogue.createPart({ displayName: "Test Saw Blade", catalogId: toolCatalog.id, assetTracking: "quantity" });
  const types = await toolRoom.assets.listTypes();
  assert.equal(types.find((t) => t.partId === drill!.id)?.tracking, "serialized");
  assert.equal(types.find((t) => t.partId === blade!.id)?.tracking, "quantity");
  step("tool types created in the tools catalog with tracking modes");

  const added = await toolRoom.assets.addAssets({ partId: drill!.id, locationId: yard.id, units: [{ serialNumber: "SN-1" }, { serialNumber: "SN-2" }, { serialNumber: "SN-3" }] });
  assert.deepEqual(added.map((a) => a.assetTag), ["T-00001", "T-00002", "T-00003"]);
  await assert.rejects(() => toolRoom.assets.addAssets({ partId: blade!.id, locationId: yard.id, units: [{}] }), /quantity/i);
  await toolRoom.assets.receiveStock({ partId: blade!.id, locationId: yard.id, quantity: 10 });
  step("3 tagged drills (T-00001..3) and 10 blades received at Main Yard");

  // Tool request list through the same Replicache push path the app uses.
  const listId = randomUUID();
  const clientGroupID = randomUUID();
  const clientID = randomUUID();
  const push = (id: number, name: string, args: unknown) =>
    handleMaterialListReplicachePush(
      { pushVersion: 1, clientGroupID, profileID: "test", schemaVersion: MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION, mutations: [{ clientID, id, name, args, timestamp: Date.now() }] } as never,
      foremanUser!,
    );
  await push(1, "createMaterialList", { materialListId: listId, jobId, name: "Tools for level 3", kind: "tools" });
  await push(2, "addItem", { materialListId: listId, itemId: randomUUID(), partDefinitionId: drill!.id, quantity: 2 });
  await push(3, "addItem", { materialListId: listId, itemId: randomUUID(), partDefinitionId: blade!.id, quantity: 4 });
  step("foreman built a tool request list via the offline sync path (2 drills, 4 blades)");

  // Same order generator as materials.
  const preview = await foreman.materialList.previewOrders({ materialListId: listId });
  assert.equal(preview.possible.length, 1, "one order, to the tool room");
  assert.equal(preview.possible[0]!.supplier?.name, "Tool Room");
  const order = await foreman.materialList.sendGeneratedOrder({ materialListId: listId, supplierId: preview.possible[0]!.supplierId!, sentTo: "Tool room" });
  assert.equal(order!.kind, "tool_request");
  assert.equal(order!.orderNumber, "TOOLS-001");
  const materialsOrders = await foreman.materialList.listOrders();
  assert.equal(materialsOrders.length, 0, "tool requests stay out of the Orders tab");
  step("foreman (standard account) generated and sent TOOLS-001 to the tool room");

  const queue = await toolRoom.assets.listRequests({ status: "open" });
  assert.equal(queue.length, 1);
  const request = await toolRoom.assets.getRequest({ orderId: order!.id });
  const drillLine = request.lines.find((l) => l.partId === drill!.id)!;
  const bladeLine = request.lines.find((l) => l.partId === blade!.id)!;
  assert.equal(drillLine.availableTools.length, 3);
  assert.equal(bladeLine.availableStock[0]?.quantity, 10);
  await assert.rejects(() => foreman.assets.fulfillRequest({ orderId: order!.id, lines: [{ orderItemId: drillLine.id, assetIds: [drillLine.availableTools[0]!.id] }] }), /tool room/i);
  let filled = await toolRoom.assets.fulfillRequest({ orderId: order!.id, lines: [{ orderItemId: drillLine.id, assetIds: [drillLine.availableTools[0]!.id] }] });
  assert.equal(filled.fulfillmentStatus, "partial");
  filled = await toolRoom.assets.fulfillRequest({
    orderId: order!.id,
    lines: [
      { orderItemId: drillLine.id, assetIds: [drillLine.availableTools[1]!.id] },
      { orderItemId: bladeLine.id, stock: [{ locationId: yard.id, quantity: 4 }] },
    ],
  });
  assert.equal(filled.fulfillmentStatus, "fulfilled");
  const atJob = await foreman.assets.holdings({ holder: { type: "job", id: jobId } });
  assert.equal(atJob.tools.length, 2);
  assert.ok(atJob.tools.every((t) => t.status === "in_use"));
  assert.equal(atJob.stock[0]?.quantity, 4);
  const yardNow = await toolRoom.assets.holdings({ holder: { type: "location", id: yard.id } });
  assert.equal(yardNow.tools.length, 1);
  assert.equal(yardNow.stock[0]?.quantity, 6);
  step("tool room filled it in two passes (partial → fulfilled); job holds 2 drills + 4 blades");

  // Receiving verification reuses the material order flow.
  const listOrders = await foreman.materialList.getOrdersForMaterialList({ materialListId: listId });
  assert.equal(listOrders.length, 1, "foreman sees the tool order on the list for verification");
  step("the tool order appears on the list for the existing receive/verify flow");

  // Over-picking is refused.
  await assert.rejects(() => toolRoom.assets.transfer({ to: { type: "job", id: jobId }, stock: [{ partId: blade!.id, from: { type: "location", id: yard.id }, quantity: 99 }] }), /Only 6/);
  step("moving more stock than a holder has is refused");

  // Field transfer rules.
  await foreman.assets.transfer({ to: { type: "user", id: foremanUserId }, assetIds: [atJob.tools[0]!.id] });
  await assert.rejects(() => foreman.assets.transfer({ to: { type: "location", id: yard.id }, assetIds: [atJob.tools[0]!.id] }), /tool room/i);
  await foreman.assets.transfer({ to: { type: "job", id: jobId }, assetIds: [atJob.tools[0]!.id] });
  await toolRoom.assets.transfer({ to: { type: "location", id: truck.id }, stock: [{ partId: blade!.id, from: { type: "location", id: yard.id }, quantity: 2 }] });
  step("foreman moved a drill job → person → job; warehouse moves refused; tool room stocked the truck");

  // Return request from the job, received by the tool room.
  const ret = await foreman.assets.requestReturn({ jobId, assetIds: [atJob.tools[0]!.id], stock: [{ partId: blade!.id, quantity: 3 }], note: "Done with these" });
  assert.equal(ret.kind, "tool_return");
  assert.equal(ret.orderNumber, "RETURN-001");
  const retDetail = await toolRoom.assets.getRequest({ orderId: ret.id });
  const received = await toolRoom.assets.receiveReturn({ orderId: ret.id, locationId: yard.id, lines: retDetail.lines.map((l) => ({ orderItemId: l.id, quantity: l.quantity })) });
  assert.equal(received.fulfillmentStatus, "fulfilled");
  const drillBack = await toolRoom.assets.getAsset({ id: atJob.tools[0]!.id });
  assert.equal(drillBack.status, "available");
  assert.equal(drillBack.holder.label, "Main Yard");
  const jobAfter = await foreman.assets.holdings({ holder: { type: "job", id: jobId } });
  assert.equal(jobAfter.tools.length, 1);
  assert.equal(jobAfter.stock[0]?.quantity, 1);
  step("RETURN-001 (1 drill, 3 blades) requested by foreman and received into Main Yard");

  // Damaged / missing, and resolving.
  const stillOut = jobAfter.tools[0]!;
  await foreman.assets.reportProblem({ assetId: stillOut.id, status: "damaged", note: "Chuck is loose" });
  assert.equal((await foreman.assets.getAsset({ id: stillOut.id })).status, "damaged");
  await assert.rejects(() => foreman.assets.resolveProblem({ assetId: stillOut.id, outcome: "in_service" }), /tool room/i);
  await toolRoom.assets.resolveProblem({ assetId: stillOut.id, outcome: "in_service", note: "Repaired" });
  assert.equal((await foreman.assets.getAsset({ id: stillOut.id })).status, "in_use");
  step("foreman reported a drill damaged; tool room put it back in service");

  // QR tag lookup.
  const byTag = await foreman.assets.getAsset({ tag: stillOut.assetTag.toLowerCase() });
  assert.equal(byTag.id, stillOut.id);
  assert.ok(byTag.history.length >= 4, "history recorded");
  step(`tag lookup (case-insensitive) finds ${stillOut.assetTag} with ${byTag.history.length} history entries`);

  // Count at Main Yard: 2 drills + 7 blades expected.
  const count = await toolRoom.assets.startCount({ holder: { type: "location", id: yard.id } });
  let countDetail = await toolRoom.assets.getCount({ countId: count.id });
  const yardDrills = countDetail.lines.filter((l) => l.tracking === "serialized");
  const bladesLine = countDetail.lines.find((l) => l.tracking === "quantity")!;
  assert.equal(yardDrills.length, 2);
  assert.equal(bladesLine.expected, 7);
  await toolRoom.assets.scanForCount({ countId: count.id, tag: yardDrills[0]!.assetTag! });
  const stray = await toolRoom.assets.scanForCount({ countId: count.id, tag: stillOut.assetTag });
  assert.equal(stray.expected, false, "the job's drill scanned at the yard is unexpected");
  await toolRoom.assets.recordCountLine({ lineId: yardDrills[1]!.id, counted: 0 });
  await toolRoom.assets.recordCountLine({ lineId: bladesLine.id, counted: 5 });
  const summary = await toolRoom.assets.completeCount({ countId: count.id });
  assert.deepEqual(summary, { missing: 1, found: 1, adjusted: 1, unchanged: 1, skipped: 0 });
  assert.equal((await toolRoom.assets.getAsset({ id: yardDrills[1]!.assetId! })).status, "missing");
  assert.equal((await toolRoom.assets.getAsset({ id: stillOut.id })).holder.label, "Main Yard");
  const yardFinal = await toolRoom.assets.holdings({ holder: { type: "location", id: yard.id } });
  assert.equal(yardFinal.stock.find((s) => s.partId === blade!.id)?.quantity, 5);
  step("count: 1 drill missing, 1 stray drill found and moved to the yard, blades corrected 7 → 5");

  const activity = await toolRoom.assets.activity({ limit: 200 });
  const [movementCount] = await db.select({ n: sql<number>`count(*)::int` }).from(assetMovements).where(eq(assetMovements.organizationId, orgId));
  assert.equal(activity.length, Number(movementCount!.n));
  step(`activity feed lists all ${activity.length} movements`);

  console.log(`\nAll ${steps.length} checks passed.`);
} catch (error) {
  if (cleanupOnly) {
    console.log(`Cleaning up ${orgId}`);
  } else {
  console.error("\nFAILED after:", steps.at(-1) ?? "(start)");
  console.error(error);
  process.exitCode = 1;
  }
} finally {
  await cleanup();
  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(eq(organizations.id, orgId));
  console.log(Number(left!.n) === 0 ? "Test organization removed." : "WARNING: test organization still present");
  process.exit(process.exitCode ?? 0);
}
