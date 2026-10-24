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
const test = vi.hoisted(() => ({
  transaction: vi.fn(),
  receive: true,
  extractionFails: false,
  extractionGate: null as Promise<void> | null,
}));
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
  clearSlipAnalysis,
  confirmSlipReceipt,
  refreshSlipReview,
} from "./service";
vi.mock("./extract", () => ({
  extractSlip: async () => {
    await test.extractionGate;
    if (test.extractionFails) throw Error("Fixture reading failure");
    return { rows: [], pages: [], warnings: [] };
  },
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
  schema.packingSlipReviewHistory,
  schema.jobPriceLists,
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
    await conn.unsafe(
      `CREATE UNIQUE INDEX packing_slip_history_test_unique ON kublai_packing_slip_review_history ("organizationId", "runId", kind)`,
    );
    test.transaction.mockImplementation(db.transaction.bind(db));
  });
  beforeEach(async () => {
    test.receive = true;
    test.extractionFails = false;
    test.extractionGate = null;
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
  it("retains failed attempts after a successful retry", async () => {
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    test.extractionFails = true;
    await startSlipAnalysis(access, doc.documentId);
    for (
      let i = 0;
      i < 100 &&
      (await workspace()).documents[0]!.packingSlipAnalysis?.status !==
        "failed";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "failed",
    );
    test.extractionFails = false;
    await startSlipAnalysis(access, doc.documentId, true);
    for (
      let i = 0;
      i < 100 &&
      (await workspace()).documents[0]!.packingSlipAnalysis?.status !== "ready";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    const history = await db.select().from(schema.packingSlipReviewHistory);
    expect(history.map((r) => r.kind).sort()).toEqual(["analysis", "failure"]);
    expect(history.find((r) => r.kind === "failure")!.data).toMatchObject({
      analysis: { error: "Fixture reading failure" },
    });
  });
  it("archives original matches and human changes once, without calling receipt differences OCR truth", async () => {
    const { access, doc, analysis } = await ready();
    const initial = await db.select().from(schema.packingSlipReviewHistory);
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      organizationId: org,
      jobId: job,
      kind: "analysis",
      userId: "receiver",
    });
    const links = { "0": null };
    await confirmSlipReceipt(
      access,
      doc.documentId,
      analysis.runId,
      { [id(6)]: 5 },
      links,
    );
    await confirmSlipReceipt(
      access,
      doc.documentId,
      analysis.runId,
      { [id(6)]: 5 },
      links,
    );
    const history = await db.select().from(schema.packingSlipReviewHistory);
    expect(history).toHaveLength(2);
    const saved = history.find((r) => r.kind === "confirmation")!.data as {
      originalAnalysis: typeof analysis;
      confirmedAnalysis: typeof analysis;
      quantityMeaning: string;
      source: { sha256: string };
    };
    expect(saved.originalAnalysis.lines[0]!.orderItemId).toBe(id(6));
    expect(saved.confirmedAnalysis.lines[0]!.orderItemId).toBeNull();
    expect(saved.confirmedAnalysis.applied!.quantities[id(6)]).toBe(5);
    expect(saved.originalAnalysis.lines[0]!.shipped).toBe(6);
    expect(saved.quantityMeaning).toBe(
      "physically_received_not_transcribed_shipped",
    );
    expect(saved.source.sha256).toBe(file.sha256);
  });
  it("rolls back receipt changes if correction history cannot be saved", async () => {
    const { access, doc, analysis } = await ready();
    await conn.unsafe(
      `ALTER TABLE kublai_packing_slip_review_history ADD CONSTRAINT block_confirmation CHECK (kind <> 'confirmation')`,
    );
    try {
      await expect(
        confirmSlipReceipt(access, doc.documentId, analysis.runId, {
          [id(6)]: 5,
        }),
      ).rejects.toThrow();
      expect(
        Number(
          (await db.select().from(schema.orderItems))[0]!.receivedQuantity,
        ),
      ).toBe(2);
      expect(
        (await workspace()).documents[0]!.packingSlipAnalysis!.applied,
      ).toBeUndefined();
    } finally {
      await conn.unsafe(
        `ALTER TABLE kublai_packing_slip_review_history DROP CONSTRAINT block_confirmation`,
      );
    }
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
  async function waitForReady() {
    for (let i = 0; i < 100; i++) {
      const analysis = (await workspace()).documents[0]!.packingSlipAnalysis;
      if (analysis?.status === "ready") return analysis;
      await new Promise(r => setTimeout(r, 10));
    }
    throw Error("Detection did not finish");
  }
  it("clears unconfirmed detection while retaining the file and rejecting an old review", async () => {
    const {access,doc,analysis}=await ready();
    const cleared=await clearSlipAnalysis(access,doc.documentId,analysis.runId);
    expect(cleared).toMatchObject({status:"cleared",items:[],lines:[],warnings:[]});
    expect(cleared.runId).not.toBe(analysis.runId);
    const state=await workspace();
    expect(state.documents[0]!.currentVersionId).toBe(analysis.versionId);
    expect(state.versions).toHaveLength(1);
    await expect(confirmSlipReceipt(access,doc.documentId,analysis.runId,{[id(6)]:6})).rejects.toMatchObject({code:"CONFLICT"});
    expect(Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity)).toBe(2);
    await startSlipAnalysis(access,doc.documentId,true,cleared.runId);
    const rerun=await waitForReady();
    expect(rerun.lines).toHaveLength(1);
    expect(rerun.applied).toBeUndefined();
    await confirmSlipReceipt(access,doc.documentId,rerun.runId,{[id(6)]:6});
    expect(Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity)).toBe(8);
  });
  const item = async () => (await db.select().from(schema.orderItems))[0]!;
  it("takes back a confirmed delivery when detection is cleared, so the slip can be confirmed afresh", async () => {
    const {access,doc,analysis}=await ready();
    await confirmSlipReceipt(access,doc.documentId,analysis.runId,{[id(6)]:6});
    expect(Number((await item()).receivedQuantity)).toBe(8);
    const cleared=await clearSlipAnalysis(access,doc.documentId,analysis.runId);
    expect(cleared.applied).toBeUndefined();
    expect(cleared.confirmedItems).toBeUndefined();
    expect(cleared.lines).toEqual([]);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    expect((await item()).verificationStatus).toBe("partial");
    const state=await workspace();
    expect(state.versions).toHaveLength(1);
    expect(state.activity.at(-1)!.detail).toContain("took back its confirmed receipt");
    await startSlipAnalysis(access,doc.documentId,true,cleared.runId);
    const rerun=await waitForReady();
    expect(rerun.applied).toBeUndefined();
    expect(rerun.items[0]!.received).toBe(2);
    expect(await confirmSlipReceipt(access,doc.documentId,rerun.runId,{[id(6)]:6})).toMatchObject({alreadyApplied:false});
    expect(Number((await item()).receivedQuantity)).toBe(8);
    expect((await db.select().from(schema.packingSlipReviewHistory)).filter(row=>row.kind==="confirmation")).toHaveLength(2);
  });
  it("starts a confirmed slip over when detection is rerun", async () => {
    const {access,doc,analysis}=await ready();
    await confirmSlipReceipt(access,doc.documentId,analysis.runId,{[id(6)]:10});
    expect((await item()).verificationStatus).toBe("problem");
    await startSlipAnalysis(access,doc.documentId,true,analysis.runId);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    expect((await item()).verificationStatus).toBe("partial");
    const rerun=await waitForReady();
    expect(rerun.runId).not.toBe(analysis.runId);
    expect(rerun.applied).toBeUndefined();
    expect(rerun.warnings).toContain("Previous receipts exist. Check that this is a new delivery before adding quantities.");
    await confirmSlipReceipt(access,doc.documentId,rerun.runId,{[id(6)]:5});
    expect(Number((await item()).receivedQuantity)).toBe(7);
  });
  it("only takes off the slip's own quantity when the item changed after confirming", async () => {
    const {access,doc,analysis}=await ready();
    await confirmSlipReceipt(access,doc.documentId,analysis.runId,{[id(6)]:6});
    await db.update(schema.orderItems).set({receivedQuantity:"10",verificationStatus:"complete"}).where(eq(schema.orderItems.id,id(6)));
    await clearSlipAnalysis(access,doc.documentId,analysis.runId);
    expect(Number((await item()).receivedQuantity)).toBe(4);
    expect((await item()).verificationStatus).toBe("partial");
  });
  it("does nothing to quantities when an unconfirmed slip is rerun", async () => {
    const {access,doc,analysis}=await ready();
    await startSlipAnalysis(access,doc.documentId,true,analysis.runId);
    await waitForReady();
    expect(Number((await item()).receivedQuantity)).toBe(2);
    expect((await workspace()).activity.some(a=>a.action==="undoPackingSlipReceipt")).toBe(false);
  });
  it("requires receiving permission and a current run for detection controls", async () => {
    const {access,doc,analysis}=await ready();
    test.receive=false;
    await expect(clearSlipAnalysis(access,doc.documentId,analysis.runId)).rejects.toMatchObject({code:"FORBIDDEN"});
    test.receive=true;
    await expect(clearSlipAnalysis(access,doc.documentId,id(90))).rejects.toMatchObject({code:"CONFLICT"});
    await expect(startSlipAnalysis(access,doc.documentId,true,id(90))).rejects.toMatchObject({code:"CONFLICT"});
    expect((await workspace()).documents[0]!.packingSlipAnalysis!.runId).toBe(analysis.runId);
    expect(Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity)).toBe(2);
  });

  it("discards an in-flight result after detection is cleared", async () => {
    let release!: () => void;
    test.extractionGate=new Promise<void>(resolve=>{release=resolve;});
    const access=await assertDocumentAccess("receiver",job,db);
    const doc=await saveDocumentVersion(access,file,async()=>undefined);
    await startSlipAnalysis(access,doc.documentId);
    const processing=(await workspace()).documents[0]!.packingSlipAnalysis!;
    expect(processing.status).toBe("processing");
    const cleared=await clearSlipAnalysis(access,doc.documentId,processing.runId);
    const transactions=test.transaction.mock.calls.length;
    release();
    for(let i=0;i<100 && test.transaction.mock.calls.length===transactions;i++)await new Promise(r=>setTimeout(r,10));
    expect(test.transaction.mock.calls.length).toBeGreaterThan(transactions);
    await test.transaction.mock.results.at(-1)!.value;
    expect((await workspace()).documents[0]!.packingSlipAnalysis).toEqual(cleared);
    expect(Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity)).toBe(2);
  });

});
