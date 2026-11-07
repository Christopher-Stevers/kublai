/**
 * Seeds a throwaway organization with Asset Management data for trying the
 * screens on a local dev server (never touches real organizations).
 *
 *   node --import dotenv/config --import tsx \
 *     --import ./scripts/bench/register-stubs.mjs scripts/assets/seed-demo-org.ts
 *   … seed-demo-org.ts --cleanup     removes every demo org this script made
 *
 * Then run `next dev` with DEV_AUTH_EMAIL=asset-demo-toolroom@example.invalid
 * (tool room) or asset-demo-foreman@example.invalid (foreman).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";

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

const ORG_PREFIX = "Asset demo (delete me)";
const TOOL_ROOM_EMAIL = "asset-demo-toolroom@example.invalid";
const FOREMAN_EMAIL = "asset-demo-foreman@example.invalid";

async function removeOrg(orgId: string) {
  const countIds = (await db.select({ id: assetCounts.id }).from(assetCounts).where(eq(assetCounts.organizationId, orgId))).map((c) => c.id);
  if (countIds.length) await db.delete(assetCountLines).where(inArray(assetCountLines.countId, countIds));
  await db.delete(assetCounts).where(eq(assetCounts.organizationId, orgId));
  await db.delete(assetMovements).where(eq(assetMovements.organizationId, orgId));
  await db.delete(assets).where(eq(assets.organizationId, orgId));
  await db.delete(assetStock).where(eq(assetStock.organizationId, orgId));
  await db.delete(assetLocations).where(eq(assetLocations.organizationId, orgId));
  await db.delete(jobs).where(eq(jobs.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}

async function cleanupAll() {
  const orgs = await db.select({ id: organizations.id }).from(organizations).where(like(organizations.name, `${ORG_PREFIX}%`));
  for (const org of orgs) await removeOrg(org.id);
  await db.delete(users).where(inArray(users.email, [TOOL_ROOM_EMAIL, FOREMAN_EMAIL]));
  return orgs.length;
}

async function seed() {
  await cleanupAll();
  const orgId = randomUUID();
  await db.insert(organizations).values({ id: orgId, name: `${ORG_PREFIX} ${new Date().toISOString().slice(0, 10)}` });
  const toolRoomId = `demo-toolroom-${randomUUID()}`;
  const foremanId = `demo-foreman-${randomUUID()}`;
  await db.insert(users).values([
    { id: toolRoomId, email: TOOL_ROOM_EMAIL, name: "Tess (Tool Room)", organizationId: orgId, role: "user", permissionConfig: { actions: { canManageAssets: true } } },
    { id: foremanId, email: FOREMAN_EMAIL, name: "Frank (Foreman)", organizationId: orgId, role: "user" },
  ]);
  const tower = randomUUID();
  const school = randomUUID();
  await db.insert(jobs).values([
    { id: tower, organizationId: orgId, name: "Harbour Tower" },
    { id: school, organizationId: orgId, name: "Elm Street School" },
  ]);
  const [tess] = await db.select().from(users).where(eq(users.id, toolRoomId));
  const [frank] = await db.select().from(users).where(eq(users.id, foremanId));
  const as = (user: typeof tess) => appRouter.createCaller({ db, userId: user!.id, user, headers: new Headers() } as never);
  const toolRoom = as(tess);
  const foreman = as(frank);

  await toolRoom.assets.setup();
  const yard = (await toolRoom.assets.holders()).locations[0]!;
  const truck = await toolRoom.assets.saveLocation({ kind: "vehicle", name: "Truck 7", notes: "Plate BC 7K4 21" });
  const catalog = (await toolRoom.catalogue.getCatalogs()).find((c) => c.kind === "assets")!;
  const type = (displayName: string, assetTracking: "serialized" | "quantity") =>
    toolRoom.catalogue.createPart({ displayName, imageUrl: null, catalogId: catalog.id, assetTracking });
  const drill = (await type("Hilti TE 30 hammer drill", "serialized"))!;
  const laser = (await type("DeWalt rotary laser", "serialized"))!;
  const lift = (await type("Genie scissor lift", "serialized"))!;
  const blades = (await type("Diamond saw blade 14in", "quantity"))!;
  const bits = (await type("SDS bit 1/2in", "quantity"))!;

  const drills = await toolRoom.assets.addAssets({ partId: drill.id, locationId: yard.id, units: [{ serialNumber: "HT3-1101" }, { serialNumber: "HT3-1102" }, { serialNumber: "HT3-1103" }, { serialNumber: "HT3-1104" }] });
  const lasers = await toolRoom.assets.addAssets({ partId: laser.id, locationId: yard.id, units: [{ serialNumber: "DW-88" }, { serialNumber: "DW-89" }] });
  await toolRoom.assets.addAssets({ partId: lift.id, locationId: yard.id, units: [{ serialNumber: "GS1930-5521" }] });
  await toolRoom.assets.receiveStock({ partId: blades.id, locationId: yard.id, quantity: 20 });
  await toolRoom.assets.receiveStock({ partId: bits.id, locationId: yard.id, quantity: 40 });
  await toolRoom.assets.transfer({ to: { type: "location", id: truck.id }, assetIds: [lasers[1]!.id], stock: [{ partId: bits.id, from: { type: "location", id: yard.id }, quantity: 10 }] });

  // A filled request to Harbour Tower, then an open one to Elm Street.
  const push = async (user: typeof frank, listId: string, jobId: string, name: string, items: Array<[string, number]>) => {
    const clientGroupID = randomUUID();
    const clientID = randomUUID();
    const mutations = [
      { clientID, id: 1, name: "createMaterialList", args: { materialListId: listId, jobId, name, kind: "tools" }, timestamp: Date.now() },
      ...items.map(([partDefinitionId, quantity], i) => ({ clientID, id: i + 2, name: "addItem", args: { materialListId: listId, itemId: randomUUID(), partDefinitionId, quantity }, timestamp: Date.now() })),
    ];
    await handleMaterialListReplicachePush({ pushVersion: 1, clientGroupID, profileID: "demo", schemaVersion: MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION, mutations } as never, user as never);
  };
  const send = async (listId: string, notes?: string) => {
    const preview = await foreman.materialList.previewOrders({ materialListId: listId });
    return foreman.materialList.sendGeneratedOrder({ materialListId: listId, supplierId: preview.possible[0]!.supplierId!, sentTo: "Tool room", notes });
  };
  const towerList = randomUUID();
  await push(frank, towerList, tower, "Tool Request 1", [[drill.id, 2], [blades.id, 4]]);
  const towerOrder = (await send(towerList))!;
  const towerReq = await toolRoom.assets.getRequest({ orderId: towerOrder.id });
  await toolRoom.assets.fulfillRequest({
    orderId: towerOrder.id,
    lines: towerReq.lines.map((line) =>
      line.tracking === "serialized"
        ? { orderItemId: line.id, assetIds: line.availableTools.slice(0, line.quantity).map((t) => t.id) }
        : { orderItemId: line.id, stock: [{ locationId: yard.id, quantity: line.quantity }] },
    ),
  });
  const schoolList = randomUUID();
  await push(frank, schoolList, school, "Tool Request 1", [[laser.id, 1], [lift.id, 1], [bits.id, 6]]);
  await send(schoolList, "Need by Monday 7am, drop at the east gate");

  // Frank hands a drill to himself, reports another damaged, and sends blades back.
  const atTower = await foreman.assets.holdings({ holder: { type: "job", id: tower } });
  await foreman.assets.transfer({ to: { type: "user", id: foremanId }, assetIds: [atTower.tools[0]!.id] });
  await foreman.assets.reportProblem({ assetId: atTower.tools[1]!.id, status: "damaged", note: "Chuck slipping under load" });
  await foreman.assets.requestReturn({ jobId: tower, stock: [{ partId: blades.id, quantity: 2 }], note: "Leftover blades, on the pallet by the hoist" });
  await toolRoom.assets.reportProblem({ assetId: drills[3]!.id, status: "missing", note: "Not on the shelf since last week" });

  console.log(`Seeded demo org ${orgId}`);
  console.log(`Tool room login: DEV_AUTH_EMAIL=${TOOL_ROOM_EMAIL}`);
  console.log(`Foreman login:   DEV_AUTH_EMAIL=${FOREMAN_EMAIL}`);
  console.log(`Jobs: Harbour Tower ${tower}, Elm Street School ${school}`);
}

if (process.argv.includes("--cleanup")) {
  console.log(`Removed ${await cleanupAll()} demo org(s).`);
} else {
  await seed();
}
process.exit(0);
