/** Run with: node --import dotenv/config --import tsx scripts/check-replicache-sync.ts
 * Creates a temporary organization, exercises real sync transactions, then removes it.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { PullRequestV1, PullResponseV1, PushRequestV1 } from "replicache";
import { db } from "../src/server/db";
import {
  organizations,
  users,
  catalogs,
  materials,
  partDefinitions,
} from "../src/server/db/schema";
import { handleCatalogueReplicachePull } from "../src/server/replicache/catalogue-sync";
import {
  handleMaterialListReplicachePull,
  handleMaterialListReplicachePush,
} from "../src/server/replicache/material-list-sync";
import { ReplicacheOwnershipError } from "../src/server/replicache/pull";

const id = () => crypto.randomUUID();
const org = id(),
  userId = id(),
  catalog = id(),
  material = id(),
  part = id();
const user = { id: userId, organizationId: org };
const report: Array<{
  check: string;
  milliseconds: number;
  bytes: number;
  operations: number;
}> = [];
function request(
  kind: "catalogue" | "material-lists",
  group = id(),
  cookie: PullRequestV1["cookie"] = null,
): PullRequestV1 {
  return {
    pullVersion: 1,
    clientGroupID: group,
    cookie,
    profileID: "performance-verification",
    schemaVersion: kind === "catalogue" ? "catalogue-v1" : "material-lists-v2",
  };
}
type Success = Exclude<PullResponseV1, { error: string }>;
async function pull(label: string, req: PullRequestV1): Promise<Success> {
  const start = performance.now();
  const response = await (
    req.schemaVersion === "catalogue-v1"
      ? handleCatalogueReplicachePull
      : handleMaterialListReplicachePull
  )(req, user);
  assert(!("error" in response), JSON.stringify(response));
  report.push({
    check: label,
    milliseconds: Math.round(performance.now() - start),
    bytes: Buffer.byteLength(JSON.stringify(response)),
    operations: response.patch.length,
  });
  console.log(`${label}: ${response.patch.length} patch operations`);
  return response;
}
const state = new Map<string, unknown>();
function apply(response: Success) {
  for (const op of response.patch) {
    if (op.op === "clear") state.clear();
    if (op.op === "put") state.set(op.key, op.value);
    if (op.op === "del") state.delete(op.key);
  }
}
const order = (response: Success) =>
  (response.cookie as { order: number }).order;
let created = false;
try {
  await db
    .insert(organizations)
    .values({ id: org, name: `Temporary sync verification ${org}` });
  created = true;
  await db
    .insert(users)
    .values({
      id: userId,
      organizationId: org,
      email: `${userId}@example.invalid`,
    });
  await db
    .insert(catalogs)
    .values({ id: catalog, organizationId: org, name: "Plumbing" });
  await db
    .insert(materials)
    .values({ id: material, organizationId: org, name: "XFR" });
  await db
    .insert(partDefinitions)
    .values({
      id: part,
      organizationId: org,
      catalogId: catalog,
      materialId: material,
      displayName: '8" fitting 45',
    });
  const a = request("catalogue"),
    b = request("catalogue");
  const initial = await pull("catalog initial", a);
  apply(initial);
  const other = await pull("second client initial", b);
  const unchanged = await pull("catalog unchanged", {
    ...a,
    cookie: initial.cookie,
  });
  assert.equal(unchanged.patch.length, 0);
  assert(order(unchanged) > order(initial));
  await db
    .update(partDefinitions)
    .set({ displayName: '8" XFR fitting 45' })
    .where(eq(partDefinitions.id, part));
  // This reply is intentionally ignored to simulate a connection lost after commit.
  await pull("interrupted rename reply", { ...a, cookie: initial.cookie });
  await db
    .update(materials)
    .set({ name: "XFR updated" })
    .where(eq(materials.id, material));
  const reconnect = await pull("reconnect over missed revision", {
    ...a,
    cookie: initial.cookie,
  });
  apply(reconnect);
  assert.equal(
    (state.get(`cataloguePart/${part}`) as { displayName: string }).displayName,
    '8" XFR fitting 45',
  );
  assert.equal(
    (state.get(`cataloguePart/${part}`) as { material: string }).material,
    "XFR updated",
  );
  const otherUpdate = await pull("second client catches up", {
    ...b,
    cookie: other.cookie,
  });
  assert.deepEqual(otherUpdate.patch, reconnect.patch);
  const concurrent = await Promise.all([
    pull("concurrent pull one", { ...a, cookie: reconnect.cookie }),
    pull("concurrent pull two", { ...a, cookie: reconnect.cookie }),
  ]);
  assert.notEqual(order(concurrent[0]!), order(concurrent[1]!));
  assert(
    concurrent.every(
      (r) => order(r) > order(reconnect) && r.patch.length === 0,
    ),
  );
  await assert.rejects(
    () => handleCatalogueReplicachePull(a, { ...user, id: "another-user" }),
    ReplicacheOwnershipError,
  );

  const workspace = request("material-lists"),
    workspaceB = request("material-lists");
  const client = id(),
    clientB = id(),
    job = id(),
    list = id(),
    item = id();
  const push = async (
    req: PullRequestV1,
    clientID: string,
    mutations: Array<{
      id: number;
      name: string;
      args: Record<string, unknown>;
    }>,
  ) => {
    const response = await handleMaterialListReplicachePush(
      {
        pushVersion: 1,
        clientGroupID: req.clientGroupID,
        profileID: req.profileID,
        schemaVersion: req.schemaVersion,
        mutations: mutations.map((m) => ({
          ...m,
          clientID,
          timestamp: Date.now(),
        })),
      } as PushRequestV1,
      user,
    );
    assert(!response || !("error" in response));
  };
  await push(workspace, client, [
    {
      id: 1,
      name: "createJob",
      args: { jobId: job, name: "Offline recovery test" },
    },
    {
      id: 2,
      name: "createMaterialList",
      args: { materialListId: list, jobId: job, name: "Test list" },
    },
    {
      id: 3,
      name: "addItem",
      args: {
        materialListId: list,
        itemId: item,
        partDefinitionId: part,
        quantity: 2,
        unitCost: 3,
      },
    },
  ]);
  const first = await pull("offline create replay acknowledged", workspace);
  apply(first);
  assert.equal(first.lastMutationIDChanges[client], 3);
  assert.equal(
    Number(
      (state.get(`materialListItem/${item}`) as { quantity: string }).quantity,
    ),
    2,
  );
  const wb = await pull("second workspace client", workspaceB);
  await push(workspaceB, clientB, [
    {
      id: 1,
      name: "updateItemQuantity",
      args: { materialListId: list, itemId: item, quantity: 5 },
    },
  ]);
  const changed = await pull("other client quantity change", {
    ...workspace,
    cookie: first.cookie,
  });
  apply(changed);
  assert.equal(
    Number(
      (state.get(`materialListItem/${item}`) as { quantity: string }).quantity,
    ),
    5,
  );
  const acknowledged = await pull("second client acknowledged", {
    ...workspaceB,
    cookie: wb.cookie,
  });
  assert.equal(acknowledged.lastMutationIDChanges[clientB], 1);
  // Retrying the identical mutation must not change data or mutation order.
  await push(workspaceB, clientB, [
    {
      id: 1,
      name: "updateItemQuantity",
      args: { materialListId: list, itemId: item, quantity: 5 },
    },
  ]);
  const repeated = await pull("duplicate mutation retry", {
    ...workspaceB,
    cookie: acknowledged.cookie,
  });
  assert.deepEqual(repeated.patch, []);
  assert.equal(repeated.lastMutationIDChanges[clientB], 1);
  await push(workspace, client, [
    { id: 4, name: "removeItem", args: { materialListId: list, itemId: item } },
  ]);
  const removed = await pull("offline delete replay", {
    ...workspace,
    cookie: changed.cookie,
  });
  apply(removed);
  assert(!state.has(`materialListItem/${item}`));
  assert.equal(removed.lastMutationIDChanges[client], 4);
  const healed = await pull("expired or restarted server view", {
    ...workspace,
    cookie: { order: order(removed), cvr: "evicted-view" },
  });
  assert.equal(healed.patch[0]?.op, "clear");
  assert.equal(healed.lastMutationIDChanges[client], 4);
  await push(workspace, client, [
    { id: 5, name: "deleteMaterialList", args: { materialListId: list } },
    { id: 6, name: "deleteJob", args: { jobId: job } },
  ]);
  await db.delete(partDefinitions).where(eq(partDefinitions.id, part));
  const catalogDelete = await pull("catalog hard deletion", {
    ...a,
    cookie: reconnect.cookie,
  });
  assert(
    catalogDelete.patch.some(
      (op) => op.op === "del" && op.key === `cataloguePart/${part}`,
    ),
  );
  await writeFile(
    ".tmp/performance-implementation/sync-integration.json",
    JSON.stringify({ passed: true, report }, null, 2),
  );
  console.log("All real-database sync checks passed.");
} finally {
  if (created) {
    await db
      .delete(partDefinitions)
      .where(eq(partDefinitions.organizationId, org));
    await db.delete(catalogs).where(eq(catalogs.organizationId, org));
    await db.delete(organizations).where(eq(organizations.id, org));
  }
  await (
    globalThis as unknown as { conn?: { end: () => Promise<void> } }
  ).conn?.end();
}
