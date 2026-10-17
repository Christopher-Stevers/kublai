// @vitest-environment node
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableName, getTableColumns, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
const test = vi.hoisted(() => ({ transaction: vi.fn(), receive: true }));
vi.mock("~/server/db", () => ({ db: { transaction: test.transaction } }));
vi.mock("~/server/auth/permissions", () => ({
  userCan: (_: unknown, key: string) =>
    key === "orders.receive" ? test.receive : key !== "documents.manage",
  hasManagingSeat: () => false,
}));
import * as schema from "~/server/db/schema";
import { saveDocumentVersion } from "../documents/service";
import { assertDocumentAccess } from "../documents/access";
import {
  startSlipAnalysis,
  confirmSlipReceipt,
  refreshSlipReview,
} from "./service";
vi.mock("./extract", () => ({
  extractSlip: async () => ({ rows: [], warnings: [] }),
}));
vi.mock("./analyze", () => ({
  analyzeSlip: async () => ({
    model: "test-fixture",
    warnings: [],
    lines: [
      {
        page: 1,
        evidence: "Valve 6 ea",
        orderItemId: "00000000-0000-4000-8000-000000000006",
        shipped: 6,
        backordered: 4,
        unit: "ea",
        proposed: 6,
        issues: [],
      },
    ],
  }),
}));
vi.mock("~/server/material-list-events", () => ({
  publishMaterialListEvent: vi.fn(),
}));
import { emptyDocumentState } from "../documents/domain";
const socket = process.env.PURCHASE_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-packing-db",
  port: 55461,
  database: "purchase_integration",
  max: 1,
});
const db = drizzle(conn, { schema });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1),
  job = id(2),
  list = id(3),
  order = id(4);
const tables = [
  schema.users,
  schema.jobs,
  schema.materialLists,
  schema.orders,
  schema.jobDocumentWorkspaces,
  schema.orderItems,
  schema.partDefinitions,
  schema.supplierParts,
  schema.partSynonyms,
  schema.units,
] as PgTable[];
const file = {
  packingSlipOrderId: order,
  name: "image.jpg",
  mimeType: "image/jpeg",
  size: 100,
  sha256: "a".repeat(64),
};
describe.skipIf(!socket)("packing slip receipt transactions", () => {
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/foremanhq-purchase-pg."))
      throw Error("Refusing non-isolated database");
    for (const table of tables) {
      const columns = Object.values(getTableColumns(table)).map(
        (c) =>
          `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`,
      );
      await conn.unsafe(
        `CREATE TABLE "${getTableName(table)}" (${columns.join(",")})`,
      );
    }
    test.transaction.mockImplementation(db.transaction.bind(db));
  });
  beforeEach(async () => {
    test.receive = true;
    for (const table of [...tables].reverse())
      await conn.unsafe(`TRUNCATE "${getTableName(table)}"`);
    await db.insert(schema.users).values({
      id: "receiver",
      name: "Receiver",
      email: "receiver@example.test",
      organizationId: org,
      organizationAccessStatus: "approved",
    });
    await db
      .insert(schema.jobs)
      .values({ id: job, organizationId: org, name: "Test", poNumber: "P" });
    await db
      .insert(schema.materialLists)
      .values({ id: list, jobId: job, organizationId: org, name: "Level 3" });
    await db.insert(schema.orders).values({
      id: order,
      jobId: job,
      organizationId: org,
      materialListId: list,
      status: "sent",
      orderNumber: "PO-123",
    });
    await db.insert(schema.partDefinitions).values({
      id: id(5),
      organizationId: org,
      catalogId: id(50),
      displayName: "Valve",
    });
    await db.insert(schema.orderItems).values({
      id: id(6),
      orderId: order,
      partDefinitionId: id(5),
      quantity: "10",
      receivedQuantity: "2",
      verificationStatus: "partial",
    });
    await db.insert(schema.jobDocumentWorkspaces).values({
      jobId: job,
      organizationId: org,
      revision: 1,
      state: emptyDocumentState(),
    });
  });
  afterAll(() => conn.end());
  const workspace = async () =>
    (await db.select().from(schema.jobDocumentWorkspaces))[0]!.state;

  async function ready() {
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    for (let i = 0; i < 100; i++) {
      const analysis = (await workspace()).documents[0]!.packingSlipAnalysis;
      if (analysis?.status === "ready") return { access, doc, analysis };
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Analysis did not finish");
  }
  it("does not receive anything during analysis and applies a confirmed delivery only once", async () => {
    const { access, doc, analysis } = await ready();
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
    await confirmSlipReceipt(access, doc.documentId, analysis.runId, {
      [id(6)]: 6,
    });
    await confirmSlipReceipt(access, doc.documentId, analysis.runId, {
      [id(6)]: 6,
    });
    const item = (await db.select().from(schema.orderItems))[0]!;
    expect(Number(item.receivedQuantity)).toBe(8);
    expect(item.verificationStatus).toBe("partial");
    expect(
      (await workspace()).documents[0]!.packingSlipAnalysis!.applied,
    ).toBeDefined();
  });
  it("flags differences between actual delivery and slip", async () => {
    const { access, doc, analysis } = await ready();
    await confirmSlipReceipt(access, doc.documentId, analysis.runId, {
      [id(6)]: 5,
    });
    const item = (await db.select().from(schema.orderItems))[0]!;
    expect(Number(item.receivedQuantity)).toBe(7);
    expect(item.verificationStatus).toBe("problem");
  });
  it("rejects stale receipts until totals are refreshed", async () => {
    const { access, doc, analysis } = await ready();
    await db
      .update(schema.orderItems)
      .set({ receivedQuantity: "3" })
      .where(eq(schema.orderItems.orderId, order));
    await expect(
      confirmSlipReceipt(access, doc.documentId, analysis.runId, {
        [id(6)]: 6,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const fresh = await refreshSlipReview(
      access,
      doc.documentId,
      analysis.runId,
    );
    await confirmSlipReceipt(access, doc.documentId, fresh.runId, {
      [id(6)]: 6,
    });
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(9);
  });
  it("rejects cancelled orders, foreign item IDs, revoked permission, and changed documents", async () => {
    const { access, doc, analysis } = await ready();
    await expect(
      confirmSlipReceipt(access, doc.documentId, analysis.runId, {
        [id(999)]: 6,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    test.receive = false;
    await expect(
      confirmSlipReceipt(access, doc.documentId, analysis.runId, {
        [id(6)]: 6,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    test.receive = true;
    await db
      .update(schema.orders)
      .set({ status: "cancelled" })
      .where(eq(schema.orders.id, order));
    await expect(
      confirmSlipReceipt(access, doc.documentId, analysis.runId, {
        [id(6)]: 6,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await db
      .update(schema.orders)
      .set({ status: "sent" })
      .where(eq(schema.orders.id, order));
    const state = await workspace();
    state.documents[0]!.currentVersionId = id(80);
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    await expect(
      confirmSlipReceipt(access, doc.documentId, analysis.runId, {
        [id(6)]: 6,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
  });
});
