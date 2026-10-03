// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("~/server/db", () => ({ db: { transaction: state.transaction } }));
vi.mock("./pull", () => ({
  ensureClientGroup: vi.fn(),
  pullSnapshot: vi.fn(),
  ReplicacheOwnershipError: class extends Error {},
}));
vi.mock("~/server/material-list-events", () => ({
  publishMaterialListEvent: vi.fn(),
  publishOrganizationReplicachePoke: vi.fn(),
}));
vi.mock("~/server/auth/permissions", () => ({
  resolvePermissions: () => ({ "lists.edit": true }),
  assertCan: vi.fn(),
}));
vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
vi.mock("~/server/assets/service", () => ({ ensureToolRoomSupplier: vi.fn() }));

import { handleMaterialListReplicachePush } from "./material-list-sync";
import { materialListRouter } from "~/server/api/routers/materialList";
import { jobRouter } from "~/server/api/routers/job";
import { MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";
import { jobRooms, materialLists, quoteItems, replicacheClients } from "~/server/db/schema";

const listId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const roomId = "00000000-0000-4000-8000-000000000003";
const otherRoomId = "00000000-0000-4000-8000-000000000004";
const quoteId = "00000000-0000-4000-8000-000000000005";
const itemId = "00000000-0000-4000-8000-000000000006";
const partId = "00000000-0000-4000-8000-000000000007";
const organizationId = "00000000-0000-4000-8000-000000000008";
const user = { id: "worker", organizationId };
const list = { id: listId, jobId, quoteId, roomId };
const client = { id: "client", clientGroupId: "group", organizationId, userId: user.id };
type Row = Record<string, unknown>;

function setup(reads: Row[][]) {
  const queued = [...reads];
  const predicates: { table: unknown; sql: string; params: unknown[] }[] = [];
  const writes: { kind: string; table: unknown; data: Row }[] = [];
  const dialect = new PgDialect();
  const tx = {
    select: vi.fn(() => {
      const rows = queued.shift();
      if (!rows) throw new Error("Unexpected database read");
      let table: unknown;
      const query = Object.assign(Promise.resolve(rows), {
        from: (value: unknown) => { table = value; return query; },
        innerJoin: () => query,
        leftJoin: () => query,
        orderBy: () => query,
        groupBy: () => query,
        limit: () => query,
        where: (predicate: SQL) => {
          predicates.push({ table, ...dialect.sqlToQuery(predicate) });
          return query;
        },
      });
      return query;
    }),
    insert: (table: unknown) => ({ values: (data: Row) => {
      writes.push({ kind: "insert", table, data });
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: () => Promise.resolve(),
        returning: async () => [{ id: table === materialLists ? listId : itemId }],
      });
    } }),
    update: (table: unknown) => ({ set: (data: Row) => ({
      where: async () => { writes.push({ kind: "update", table, data }); },
    }) }),
  };
  state.transaction.mockImplementation(async (fn: (db: typeof tx) => unknown) => fn(tx));
  const db = { ...tx, transaction: state.transaction };
  return {
    writes, predicates, tx,
    material: materialListRouter.createCaller({ db, user, userId: user.id } as never),
    jobs: jobRouter.createCaller({ db, user, userId: user.id } as never),
    assertConsumed: () => expect(queued).toHaveLength(0),
  };
}

function push(name: string, args: Record<string, string | number | null>) {
  return handleMaterialListReplicachePush({
    pushVersion: 1, schemaVersion: MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION,
    clientGroupID: "group", profileID: "profile",
    mutations: [{ id: 1, clientID: "client", name, args, timestamp: 1 }],
  }, user);
}
function addArgs(room?: string | null) {
  return {
    materialListId: listId, itemId, partDefinitionId: partId,
    quantity: 2, descriptionSnapshot: '8" fitting 45',
    ...(room !== undefined ? { roomId: room } : {}),
  };
}
function assertRoomScope(test: ReturnType<typeof setup>) {
  const predicate = test.predicates.find((row) => row.table === jobRooms)!;
  expect(predicate.sql).toContain('"jobId"');
  expect(predicate.sql).toContain('"organizationId"');
  expect(predicate.params).toEqual([roomId, jobId, organizationId]);
}
beforeEach(() => vi.clearAllMocks());

describe("material-line room attribution", () => {
  it("saves the room on list creation through Replicache", async () => {
    const test = setup([[client], [{ lastMutationId: 0 }], [{ id: jobId }], [{ id: roomId }], [{ cvrVersion: 0 }]]);
    await push("createMaterialList", { materialListId: listId, jobId, name: "Room 301 — October 3", roomId });
    expect(test.writes.find((w) => w.kind === "insert" && w.table === materialLists)?.data).toMatchObject({ roomId, jobId });
    assertRoomScope(test);
    test.assertConsumed();
  });

  it.each([undefined, roomId])("inherits/preserves room when adding a catalogue part (input %s)", async (inputRoom) => {
    const test = setup([[client], [{ lastMutationId: 0 }], [list], [{ id: roomId }], [], [{ cvrVersion: 0 }]]);
    await push("addItem", addArgs(inputRoom));
    expect(test.writes.find((w) => w.table === quoteItems)?.data).toMatchObject({ roomId, partDefinitionId: partId, quantity: "2" });
    assertRoomScope(test);
    test.assertConsumed();
  });

  it("allows an explicitly blank room even on a room-specific list", async () => {
    const test = setup([[client], [{ lastMutationId: 0 }], [list], [], [{ cvrVersion: 0 }]]);
    await push("addItem", addArgs(null));
    expect(test.writes.find((w) => w.table === quoteItems)?.data.roomId).toBeNull();
    expect(test.predicates.some((row) => row.table === jobRooms)).toBe(false);
    test.assertConsumed();
  });

  it("keeps ordinary list items blank by default", async () => {
    const test = setup([[client], [{ lastMutationId: 0 }], [{ ...list, roomId: null }], [], [{ cvrVersion: 0 }]]);
    await push("addItem", addArgs());
    expect(test.writes.find((w) => w.table === quoteItems)?.data.roomId).toBeNull();
    test.assertConsumed();
  });

  it.each(["createMaterialList", "addItem"])("rejects unavailable, cross-job, or cross-organization room for %s", async (name) => {
    const test = setup([[client], [{ lastMutationId: 0 }], [name === "addItem" ? list : { id: jobId }], [], [{ cvrVersion: 0 }]]);
    const args = name === "addItem" ? addArgs(roomId) : { materialListId: listId, jobId, roomId, name: "Room 301" };
    await expect(push(name, args)).resolves.toEqual({});
    expect(test.writes.some((w) => w.table === materialLists || w.table === quoteItems)).toBe(false);
    expect(test.writes.find((w) => w.table === replicacheClients)?.data.lastMutationId).toBe(1);
    assertRoomScope(test);
  });

  it("drains an invalid offline room-list creation and its orphan item without blocking later valid items", async () => {
    const test = setup([
      [client], [{ lastMutationId: 0 }], [{ id: jobId }], [],
      [client], [{ lastMutationId: 1 }], [],
      [client], [{ lastMutationId: 2 }], [list], [{ id: roomId }],
      [], [{ cvrVersion: 0 }],
    ]);
    await handleMaterialListReplicachePush({
      pushVersion: 1, schemaVersion: MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION,
      clientGroupID: "group", profileID: "profile",
      mutations: [
        { id: 1, clientID: "client", name: "createMaterialList", args: { materialListId: listId, jobId, roomId: otherRoomId, name: "Deleted room" }, timestamp: 1 },
        { id: 2, clientID: "client", name: "addItem", args: addArgs(otherRoomId), timestamp: 2 },
        { id: 3, clientID: "client", name: "addItem", args: addArgs(), timestamp: 3 },
      ],
    }, user);
    expect(test.writes.filter((w) => w.table === quoteItems)).toHaveLength(1);
    expect(test.writes.find((w) => w.table === quoteItems)?.data.roomId).toBe(roomId);
    expect(test.writes.filter((w) => w.table === replicacheClients).map((w) => w.data.lastMutationId)).toEqual([1, 2, 3]);
    test.assertConsumed();
  });

  it("allows another valid room on the same job without merging distinct line IDs", async () => {
    const test = setup([[client], [{ lastMutationId: 0 }], [list], [{ id: otherRoomId }], [], [{ cvrVersion: 0 }]]);
    await push("addItem", addArgs(otherRoomId));
    expect(test.writes.find((w) => w.table === quoteItems)?.data).toMatchObject({ id: itemId, roomId: otherRoomId, partDefinitionId: partId });
    expect(test.writes.filter((w) => w.table === quoteItems)).toHaveLength(1);
    expect(test.writes.find((w) => w.table === quoteItems)?.kind).toBe("insert");
  });

  it.each(["updateItemQuantity", "updateItemSupplierPart"])("%s preserves the room when editing an item", async (name) => {
    const test = setup([[client], [{ lastMutationId: 0 }], [{ id: itemId, quoteId, materialListId: listId, quantity: "2", unitCost: "4" }], [], [{ cvrVersion: 0 }]]);
    await push(name, { materialListId: listId, itemId, quantity: 3, supplierId: null, supplierPartId: null });
    const write = test.writes.find((w) => w.table === quoteItems);
    expect(write?.kind).toBe("update");
    expect(write?.data).not.toHaveProperty("roomId");
    test.assertConsumed();
  });

  it("legacy list creation also persists the room and checks its scope", async () => {
    const test = setup([[], [{ id: jobId }], [{ id: roomId }]]);
    const result = await test.jobs.syncEntityMutations({ mutations: [{
      type: "createMaterialList", clientMutationId: "legacy-list", localMaterialListId: "local-list",
      localJobId: jobId, name: "Room 301 materials", roomId, queuedAt: new Date().toISOString(),
    }] });
    expect(result.failed).toEqual([]);
    expect(test.writes.find((w) => w.kind === "insert" && w.table === materialLists)?.data.roomId).toBe(roomId);
    assertRoomScope(test);
  });

  it("legacy one-off items inherit their list's room", async () => {
    const test = setup([[list], [], [{ id: roomId }], []]);
    const result = await test.material.syncMaterialListMutations({ materialListId: listId, mutations: [{
      type: "addItem", clientMutationId: "legacy-line", localItemId: "local-line", quantity: 2,
      oneOffDisplayName: "Custom room fitting", queuedAt: new Date().toISOString(),
    }] });
    expect(result.failed).toEqual([]);
    expect(test.writes.find((w) => w.table === quoteItems)?.data).toMatchObject({ roomId, oneOffDisplayName: "Custom room fitting" });
    assertRoomScope(test);
  });
});
