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
import type { SlipProgress } from "~/lib/packing-slip-review";
import { resolutionCounterpartFingerprint, resolutionEvidenceFingerprint } from "~/lib/receiving-resolution";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableName, getTableColumns, eq, SQL, sql } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
const test = vi.hoisted(() => ({
  selectedLine: vi.fn(),
  transaction: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  receive: true,
  send: true,
  trial: null as unknown,
  extractionFails: false,
  extractionStarted: false,
  extractionGate: null as Promise<void> | null,
  lineGate: null as Promise<void> | null,
  lineStarted: false,
  suggestedOrder: null as string | null,
  push: null as null | {
    publicKey: string;
    privateKey: string;
    subject: string;
  },
  sendPush: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: {
    transaction: test.transaction,
    select: test.select,
    update: test.update,
  },
}));
vi.mock("~/server/auth/permissions", () => ({
  userCan: (_: unknown, key: string) =>
    key === "orders.receive" ? test.receive : key === "orders.send" ? test.send : key !== "documents.manage",
  hasManagingSeat: () => false,
}));
import * as schema from "~/server/db/schema";
import { chatPushSubscriptions } from "~/server/db/chat-push-schema";
import { CLEAN_RUN, ASK_EVERY } from "~/lib/slip-autopilot";
import { receiveIfTrusted, supplierOutcomes } from "./autopilot";
import { assertManualReceiptEditable } from "./manual-receiving";
import {
  mutateReceiving,
  receivingQueue,
  importTrialReview,
  receivingOrderComparison,
  receivingOrderCandidates,
} from "./receiving-service";
import { receivingInput } from "./receiving-input";
import { randomUUID } from "node:crypto";
import { orderSnapshot, orderFingerprint } from "./service";
import { reserveTerra } from "./production-cascade";
import { jobOrders } from "./find-order-service";
import {
  saveDocumentVersion,
  saveUnmatchedSlip,
  readableVersion,
} from "../documents/service";
import { assertDocumentAccess } from "../documents/access";
import {
  startSlipAnalysis,
  dispatchPackingSlips,
  clearSlipAnalysis,
  confirmSlipReceipt,
  refreshSlipReview,
} from "./service";
vi.mock("./trial-store", () => ({ trialDocument: async () => test.trial }));
vi.mock("./selected-line", () => ({ detectSelectedLine: test.selectedLine }));
vi.mock("./extract", () => ({
  extractSlip: async () => {
    test.extractionStarted = true;
    await test.extractionGate;
    if (test.extractionFails) throw Error("Fixture reading failure");
    return { rows: [], pages: [], warnings: [] };
  },
}));
vi.mock("./analyze", () => ({
  analyzeSlip: async (
    _rows: unknown,
    _items: unknown,
    _ask: unknown,
    options?: { onProgress?: (p: SlipProgress) => Promise<void> },
  ) => {
    await options?.onProgress?.({
      stage: "matching",
      message: "Checking each printed line against the order…",
    });
    test.lineStarted = true;
    await test.lineGate;
    return {
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
    };
  },
}));
vi.mock("~/server/chat/push", () => ({
  getPushConfiguration: () => test.push,
}));
vi.mock("~/server/chat/push-transport", () => ({
  sendPushPayload: test.sendPush,
}));
vi.mock("~/server/material-list-events", () => ({
  publishMaterialListEvent: vi.fn(),
  publishOrganizationCatalogueEvent: vi.fn(),
}));
vi.mock("./find-order-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./find-order-service")>();
  return {
    ...actual,
    identifySlipOrder: async (
      ...args: Parameters<typeof actual.identifySlipOrder>
    ) =>
      test.suggestedOrder
        ? {
            documentId: args[1],
            match: null,
            suggestion: test.suggestedOrder,
            candidates: [test.suggestedOrder],
            orders: (await actual.jobOrders(args[0])).map((o) => o.option),
          }
        : actual.identifySlipOrder(...args),
  };
});
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
  schema.catalogs,
  schema.photoAssets,
  schema.suppliers,
  schema.quotes,
  schema.quoteItems,
  schema.organizationPermissionPresets,
  schema.packingSlipJobs,
  schema.packingSlipReviewHistory,
  schema.packingSlipTerraCalls,
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
  chatPushSubscriptions,
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
          `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.default === undefined ? "" : ` DEFAULT ${c.default instanceof SQL ? new PgDialect().sqlToQuery(c.default).sql : typeof c.default === "string" ? "'" + c.default.replaceAll("'", "''") + "'" : JSON.stringify(c.default)}`}`,
      );
      await conn.unsafe(
        `CREATE TABLE "${getTableName(table)}" (${columns.join(",")})`,
      );
    }
    await conn.unsafe(
      `CREATE UNIQUE INDEX packing_slip_history_test_unique ON kublai_packing_slip_review_history ("organizationId", "runId", kind)`,
    );
    test.transaction.mockImplementation(db.transaction.bind(db));
    test.select.mockImplementation(db.select.bind(db));
    test.update.mockImplementation(db.update.bind(db));
    await conn.unsafe(
      'ALTER TABLE kublai_packing_slip_job ALTER COLUMN status SET DEFAULT \'queued\', ALTER COLUMN attempts SET DEFAULT 0, ALTER COLUMN "createdAt" SET DEFAULT now(), ALTER COLUMN "updatedAt" SET DEFAULT now()',
    );
  });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    test.receive = true;
    test.send = true;
    test.trial = null;
    test.extractionFails = false;
    test.extractionStarted = false;
    test.extractionGate = null;
    test.lineGate = null;
    test.lineStarted = false;
    test.suggestedOrder = null;
    test.push = null;
    test.sendPush.mockReset();
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
    await db.insert(schema.catalogs).values({
      id: id(50),
      organizationId: org,
      name: "Plumbing",
      kind: "materials",
    });
    await db.insert(schema.units).values({
      id: id(51),
      code: "ea",
      displayName: "Each",
      kind: "quantity",
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

  it("freezes the actual order unit and pack conversion in job matching candidates", async () => {
    const access = await assertDocumentAccess("receiver", job, db);
    await db
      .update(schema.units)
      .set({ code: "ft" })
      .where(eq(schema.units.id, id(51)));
    await db
      .update(schema.orderItems)
      .set({ uomId: id(51) })
      .where(eq(schema.orderItems.id, id(6)));
    expect((await jobOrders(access))[0]!.slip.items[0]!.unit).toBe("ft");
    await db
      .update(schema.partDefinitions)
      .set({ piecesPerPack: 50, bulkUnit: "box", individualUnit: "ea" })
      .where(eq(schema.partDefinitions.id, id(5)));
    expect((await jobOrders(access))[0]!.slip.items[0]).toMatchObject({
      unit: "box",
      piecesPerPack: 50,
      individualUnit: "ea",
    });
    expect(
      await jobOrders({ ...access, job: { ...access.job, id: id(999) } }),
    ).toEqual([]);
  });

  it("reserves Terra spending durably and never repeats an uncertain paid attempt", async () => {
    vi.stubEnv("PACKING_SLIP_TERRA_DAILY_USD", "1");
    const scope = {
      runId: id(900),
      organizationId: org,
      jobId: job,
      documentId: id(901),
      versionId: id(902),
      sourceHash: "a".repeat(64),
    };
    expect((await reserveTerra(scope, "request-1")).kind).toBe("reserved");
    expect((await reserveTerra(scope, "request-1")).kind).toBe("interrupted");
    expect(
      (await reserveTerra({ ...scope, runId: id(903) }, "request-2")).kind,
    ).toBe("budget-limited");
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
  });

  it("reuses a finished Terra call only for identical job, file and request inputs", async () => {
    const scope = {
      runId: id(900),
      organizationId: org,
      jobId: job,
      documentId: id(901),
      versionId: id(902),
      sourceHash: "a".repeat(64),
    };
    await reserveTerra(scope, "request-1");
    await db
      .update(schema.packingSlipTerraCalls)
      .set({
        status: "done",
        budgetUsd: 0.02,
        result: {
          model: "gpt-6.1-terra",
          durationMs: 10,
          usage: null,
          output: {
            document: {
              kind: "delivery",
              supplierName: null,
              deliveryNumber: null,
              supplierOrderNumber: null,
              deliveryDate: null,
            },
            orderId: null,
            orderConfidence: 0,
            lines: [],
            warnings: [],
          },
        },
      })
      .where(eq(schema.packingSlipTerraCalls.id, scope.runId));
    expect((await reserveTerra(scope, "request-1")).kind).toBe("cached");
    expect(
      (await reserveTerra({ ...scope, jobId: id(999) }, "request-1")).kind,
    ).toBe("interrupted");
    expect((await reserveTerra(scope, "request-changed")).kind).toBe(
      "interrupted",
    );
  });

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
  it("persists queued analysis without inline reading and a worker commits it once", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "processing",
    );
    expect(
      await db.select().from(schema.packingSlipReviewHistory),
    ).toHaveLength(0);
    expect((await db.select().from(schema.packingSlipJobs))[0]!.status).toBe(
      "queued",
    );
    await Promise.all([dispatchPackingSlips(), dispatchPackingSlips()]);
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "ready",
    );
    expect(
      await db.select().from(schema.packingSlipReviewHistory),
    ).toHaveLength(1);
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
  });
  it("publishes an unconfirmed order suggestion before checking lines", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const saved = await saveUnmatchedSlip(
      access,
      {
        name: "unmatched.pdf",
        mimeType: "application/pdf",
        size: 100,
        sha256: "c".repeat(64),
      },
      async () => undefined,
    );
    await startSlipAnalysis(access, saved.documentId);
    test.suggestedOrder = order;
    let release!: () => void;
    test.lineGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = dispatchPackingSlips();
    try {
      await vi.waitFor(() => expect(test.lineStarted).toBe(true));
      const doc = (await workspace()).documents[0]!;
      expect(doc.packingSlip).toBeUndefined();
      expect(doc.packingSlipAnalysis?.status).toBe("processing");
      expect(doc.packingSlipAnalysis?.orderCandidates).toEqual([order]);
      expect(doc.packingSlipAnalysis?.progress?.message).toBe(
        "Checking each printed line against suggested order PO-123…",
      );
      expect(doc.receivingReview?.orderConfirmed).not.toBe(true);
    } finally {
      release();
      await running;
    }
  });
  it("previews saved detections and confirms the same order without a new reader call", async () => {
    const { access, doc } = await ready();
    const before = (await workspace()).documents[0]!;
    const analysis = before.packingSlipAnalysis!;
    const original = structuredClone(before.receivingReview!);
    const reader = vi.spyOn(await import("./analyze"), "analyzeSlip");
    reader.mockClear();
    try {
      const preview = await receivingOrderComparison(
        access,
        doc.documentId,
        order,
      );
      const ranked = await receivingOrderCandidates(access, doc.documentId);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked.length).toBeLessThanOrEqual(5);
      expect(ranked[0]?.orderId).toBe(order);
      expect(preview.rows[0]?.slip?.quantity).toBe(6);
      expect(preview.rows[0]?.order?.quantity).toBe(10);
      expect((await workspace()).documents[0]).toEqual(before);
      await mutateReceiving(access, {
        action: "link",
        documentId: doc.documentId,
        jobId: job,
        orderId: order,
        revision: original.revision,
        requestId: randomUUID(),
        confirmed: true,
      });
      const after = (await workspace()).documents[0]!;
      expect(after.packingSlipAnalysis?.runId).toBe(analysis.runId);
      expect(after.packingSlipAnalysis?.lines).toEqual(analysis.lines);
      expect(after.receivingReview?.lines[0]?.orderItemId).toBe(
        original.lines[0]?.orderItemId,
      );
      expect(after.receivingReview?.lines[0]?.quantity).toBe(
        original.lines[0]?.quantity,
      );
      expect(reader).not.toHaveBeenCalled();
      expect(Number((await item()).receivedQuantity)).toBe(2);
      test.receive = false;
      await expect(receivingOrderCandidates(access, doc.documentId)).rejects.toMatchObject({code: "FORBIDDEN"});
      await expect(
        receivingOrderComparison(access, doc.documentId, order),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      test.receive = true;
      await expect(
        receivingOrderComparison(access, doc.documentId, id(987)),
      ).rejects.toThrow();
    } finally {
      reader.mockRestore();
    }
  });
  it("recovers an expired claim and rejects writes from the previous owner", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    const { claimPackingSlip, ownsPackingSlip, finishPackingSlip } =
      await import("../background/packing-queue");
    const previous = (await claimPackingSlip())!;
    await db
      .update(schema.packingSlipJobs)
      .set({ leaseUntil: new Date(0) })
      .where(eq(schema.packingSlipJobs.id, previous.id));
    await dispatchPackingSlips();
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "ready",
    );
    expect(await db.transaction((tx) => ownsPackingSlip(tx, previous))).toBe(
      false,
    );
    await finishPackingSlip(previous, true);
    expect((await db.select().from(schema.packingSlipJobs))[0]!.status).toBe(
      "done",
    );
    expect(
      await db.select().from(schema.packingSlipReviewHistory),
    ).toHaveLength(1);
  });
  it("leaves failed result persistence recoverable after a database outage", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    let release!: () => void;
    test.extractionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = dispatchPackingSlips();
    for (let i = 0; i < 100; i++) {
      if (test.extractionStarted) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(test.extractionStarted).toBe(true);
    expect(
      (await workspace()).documents[0]!.packingSlipAnalysis?.progress?.stage,
    ).toBe("extracting");
    for (let i = 0; i < 3; i++)
      test.transaction.mockRejectedValueOnce(Error("database unavailable"));
    const rejected = expect(running).rejects.toThrow("database unavailable");
    release();
    await rejected;
    expect((await db.select().from(schema.packingSlipJobs))[0]!.status).toBe(
      "running",
    );
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "processing",
    );
    await db
      .update(schema.packingSlipJobs)
      .set({ leaseUntil: new Date(0) })
      .where(eq(schema.packingSlipJobs.documentId, doc.documentId));
    await dispatchPackingSlips();
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "ready",
    );
    expect((await db.select().from(schema.packingSlipJobs))[0]!.status).toBe(
      "done",
    );
  });
  it("records an extraction failure as a failed queue run", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    test.extractionFails = true;
    await dispatchPackingSlips();
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "failed",
    );
    expect((await db.select().from(schema.packingSlipJobs))[0]!.status).toBe(
      "failed",
    );
  });
  it("does not read or receive a queued slip after receiving permission is revoked", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    test.receive = false;
    await dispatchPackingSlips();
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "failed",
    );
    expect(
      await db.select().from(schema.packingSlipReviewHistory),
    ).toHaveLength(0);
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
  });
  it("does not restore analysis cleared after it was queued", async () => {
    vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    const runId = (await workspace()).documents[0]!.packingSlipAnalysis!.runId;
    await clearSlipAnalysis(access, doc.documentId, runId);
    await dispatchPackingSlips();
    expect((await workspace()).documents[0]!.packingSlipAnalysis?.status).toBe(
      "cleared",
    );
  });
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
    test.trial = null;
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
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Detection did not finish");
  }
  it("clears unconfirmed detection while retaining the file and rejecting an old review", async () => {
    const { access, doc, analysis } = await ready();
    const cleared = await clearSlipAnalysis(
      access,
      doc.documentId,
      analysis.runId,
    );
    expect(cleared).toMatchObject({
      status: "cleared",
      items: [],
      lines: [],
      warnings: [],
    });
    expect(cleared.runId).not.toBe(analysis.runId);
    const state = await workspace();
    expect(state.documents[0]!.currentVersionId).toBe(analysis.versionId);
    expect(state.versions).toHaveLength(1);
    await expect(
      confirmSlipReceipt(access, doc.documentId, analysis.runId, {
        [id(6)]: 6,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
    await startSlipAnalysis(access, doc.documentId, true, cleared.runId);
    const rerun = await waitForReady();
    expect(rerun.lines).toHaveLength(1);
    expect(rerun.applied).toBeUndefined();
    await confirmSlipReceipt(access, doc.documentId, rerun.runId, {
      [id(6)]: 6,
    });
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(8);
  });
  const item = async () => (await db.select().from(schema.orderItems))[0]!;
  it("preserves a confirmed receipt through clearing and rereading", async () => {
    const { access, doc, analysis } = await ready();
    await confirmSlipReceipt(access, doc.documentId, analysis.runId, {
      [id(6)]: 6,
    });
    expect(Number((await item()).receivedQuantity)).toBe(8);
    const cleared = await clearSlipAnalysis(
      access,
      doc.documentId,
      analysis.runId,
    );
    expect(cleared.applied?.quantities[id(6)]).toBe(6);
    expect(cleared.confirmedItems).toBeDefined();
    expect(cleared.lines).toEqual([]);
    expect(Number((await item()).receivedQuantity)).toBe(8);
    expect((await item()).verificationStatus).toBe("partial");
    const state = await workspace();
    expect(state.versions).toHaveLength(1);
    expect(state.activity.at(-1)!.detail).toContain(
      "Approved receipts preserved",
    );
    await startSlipAnalysis(access, doc.documentId, true, cleared.runId);
    const rerun = await waitForReady();
    expect(rerun.applied).toBeDefined();
    expect(rerun.items[0]!.received).toBe(8);
    expect(
      await confirmSlipReceipt(access, doc.documentId, rerun.runId, {
        [id(6)]: 6,
      }),
    ).toMatchObject({ alreadyApplied: true });
    expect(Number((await item()).receivedQuantity)).toBe(8);
    expect(
      (await db.select().from(schema.packingSlipReviewHistory)).filter(
        (row) => row.kind === "confirmation",
      ),
    ).toHaveLength(1);
  });
  it("reruns detection without reversing approved quantities", async () => {
    const { access, doc, analysis } = await ready();
    await confirmSlipReceipt(access, doc.documentId, analysis.runId, {
      [id(6)]: 10,
    });
    expect((await item()).verificationStatus).toBe("problem");
    await startSlipAnalysis(access, doc.documentId, true, analysis.runId);
    expect(Number((await item()).receivedQuantity)).toBe(12);
    expect((await item()).verificationStatus).toBe("problem");
    const rerun = await waitForReady();
    expect(rerun.runId).not.toBe(analysis.runId);
    expect(rerun.applied).toBeDefined();

    await confirmSlipReceipt(access, doc.documentId, rerun.runId, {
      [id(6)]: 5,
    });
    expect(Number((await item()).receivedQuantity)).toBe(12);
  });
  it("preserves later receipt changes when detection is cleared", async () => {
    const { access, doc, analysis } = await ready();
    await confirmSlipReceipt(access, doc.documentId, analysis.runId, {
      [id(6)]: 6,
    });
    await db
      .update(schema.orderItems)
      .set({ receivedQuantity: "10", verificationStatus: "complete" })
      .where(eq(schema.orderItems.id, id(6)));
    await clearSlipAnalysis(access, doc.documentId, analysis.runId);
    expect(Number((await item()).receivedQuantity)).toBe(10);
    expect((await item()).verificationStatus).toBe("complete");
  });
  it("does nothing to quantities when an unconfirmed slip is rerun", async () => {
    const { access, doc, analysis } = await ready();
    await startSlipAnalysis(access, doc.documentId, true, analysis.runId);
    await waitForReady();
    expect(Number((await item()).receivedQuantity)).toBe(2);
    expect(
      (await workspace()).activity.some(
        (a) => a.action === "undoPackingSlipReceipt",
      ),
    ).toBe(false);
  });
  it("requires receiving permission and a current run for detection controls", async () => {
    const { access, doc, analysis } = await ready();
    test.receive = false;
    await expect(
      clearSlipAnalysis(access, doc.documentId, analysis.runId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    test.receive = true;
    test.trial = null;
    await expect(
      clearSlipAnalysis(access, doc.documentId, id(90)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      startSlipAnalysis(access, doc.documentId, true, id(90)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await workspace()).documents[0]!.packingSlipAnalysis!.runId).toBe(
      analysis.runId,
    );
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
  });

  it("discards an in-flight result after detection is cleared", async () => {
    let release!: () => void;
    test.extractionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    const processing = (await workspace()).documents[0]!.packingSlipAnalysis!;
    expect(processing.status).toBe("processing");
    const cleared = await clearSlipAnalysis(
      access,
      doc.documentId,
      processing.runId,
    );
    const transactions = test.transaction.mock.calls.length;
    release();
    for (
      let i = 0;
      i < 100 && test.transaction.mock.calls.length === transactions;
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    expect(test.transaction.mock.calls.length).toBeGreaterThan(transactions);
    await test.transaction.mock.results.at(-1)!.value;
    expect((await workspace()).documents[0]!.packingSlipAnalysis).toEqual(
      cleared,
    );
    expect(
      Number((await db.select().from(schema.orderItems))[0]!.receivedQuantity),
    ).toBe(2);
  });
  async function reviewAction(
    access: Awaited<ReturnType<typeof assertDocumentAccess>>,
    documentId: string,
    action: Record<string, unknown>,
  ) {
    const d = (await workspace()).documents.find((d) => d.id === documentId)!;
    return mutateReceiving(
      access,
      receivingInput.parse({
        jobId: job,
        documentId,
        revision: d.receivingReview?.revision ?? 1,
        requestId: randomUUID(),
        ...action,
      }),
    );
  }
  async function confirmedHeader() {
    const fixture = await ready();
    await reviewAction(fixture.access, fixture.doc.documentId, {
      action: "header",
      kind: "delivery",
      supplierId: null,
      supplierName: "",
      deliveryNumber: "",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    return fixture;
  }
  async function resolveAction(fixture: Awaited<ReturnType<typeof confirmedHeader>>, patch: Record<string, unknown> = {}, lineId = "0") {
    const l = (await workspace()).documents.find(d => d.id === fixture.doc.documentId)!.receivingReview!.lines.find(l => l.id === lineId)!;
    return reviewAction(fixture.access, fixture.doc.documentId, { action: "resolve", lineId, evidenceFingerprint: resolutionEvidenceFingerprint(l), ...patch });
  }
  const allResolved = { match: "confirmed", specification: "confirmed", quantity: "confirmed", delivery: "confirmed", remainder: "backordered", note: "Remainder confirmed backordered" };
  it("converts both ordered and shipped quantities when linking a previously unmatched slip", async () => {
    const f = await confirmedHeader();
    await db.update(schema.partDefinitions).set({ piecesPerPack: 100, bulkUnit: "box", individualUnit: "ea" }).where(eq(schema.partDefinitions.id, id(5)));
    const state = await workspace();
    const review = state.documents.find(d => d.id === f.doc.documentId)!.receivingReview!;
    Object.assign(review.lines[0]!, { orderItemId: null, description: "Valve", sku: "", quantity: 600, ordered: 1000, unit: "pcs", checked: false });
    await db.update(schema.jobDocumentWorkspaces).set({ state }).where(eq(schema.jobDocumentWorkspaces.jobId, job));
    await reviewAction(f.access, f.doc.documentId, { action: "link", orderId: order, confirmed: true });
    const saved = (await workspace()).documents.find(d => d.id === f.doc.documentId)!.receivingReview!.lines[0]!;
    expect(saved).toMatchObject({ orderItemId: id(6), quantity: 6, ordered: 10, unit: "box", checked: false });
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("linking or legacy checked flags cannot bypass unresolved specification, quantity or delivery", async () => {
    const f = await confirmedHeader();
    await resolveAction(f, {match:"confirmed"});
    const saved = (await workspace()).documents[0]!.receivingReview!.lines[0]!;
    await reviewAction(f.access,f.doc.documentId,{action:"line",lineId:"0",description:saved.description,sku:saved.sku,quantity:saved.quantity,ordered:saved.ordered,unit:saved.unit,unitPrice:saved.unitPrice,orderItemId:saved.orderItemId,checked:true});
    await expect(reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:["0"],fingerprint:await finger(f.access)})).rejects.toThrow("specification");
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("records paper, actual site count and accepted count separately and posts only the accepted count", async () => {
    const f = await confirmedHeader();
    await resolveAction(f, {...allResolved,delivery:"damaged",siteQuantity:5,acceptedQuantity:4,note:"One missing and one damaged; replacements backordered"});
    let saved = (await workspace()).documents[0]!.receivingReview!.lines[0]!;
    expect(saved.paper?.quantity).toBe(6); expect(saved.quantity).toBe(6); expect(saved.resolution?.siteQuantity).toBe(5);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    await reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:["0"],fingerprint:await finger(f.access)});
    saved = (await workspace()).documents[0]!.receivingReview!.lines[0]!;
    expect(saved.approved?.quantity).toBe(4); expect(Number((await item()).receivedQuantity)).toBe(6);
    expect(saved.paper?.quantity).toBe(6);
  });
  it("skipping high confidence evidence leaves it unresolved until explicitly resumed", async () => {
    const f = await confidentSavedSlip();
    await resolveAction(f,{...allResolved,skipped:true,note:"Need site check"});
    expect((await receivingQueue(f.access,f.doc.documentId)).review!.lines[0]!.autoConfirmed).toBe(false);
    await expect(reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:["0"],fingerprint:await finger(f.access)})).rejects.toThrow();
    await resolveAction(f,{skipped:false});
    await reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:["0"],fingerprint:await finger(f.access)});
    expect(Number((await item()).receivedQuantity)).toBe(8);
  });
  it("requires orders permission for accepting substitutions and receiving permission for every resolution", async () => {
    const f = await confirmedHeader(); test.send = false;
    await expect(resolveAction(f,{specification:"substitution-accepted",note:"Equivalent approved part"})).rejects.toMatchObject({code:"FORBIDDEN"});
    test.receive = false;
    await expect(resolveAction(f,{match:"confirmed"})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("rejects stale line evidence and invalid accepted counts without changing the draft", async () => {
    const f = await confirmedHeader(), before = await workspace();
    await expect(resolveAction(f,{evidenceFingerprint:"stale",match:"confirmed"})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(resolveAction(f,{siteQuantity:3,acceptedQuantity:4})).rejects.toThrow("exceed");
    expect(await workspace()).toEqual(before);
  });
  it("requires reconfirmation when the counterpart order changes after resolving, even with a fresh approval request",async()=>{
    const f=await confirmedHeader();
    await resolveAction(f,allResolved);
    await db.update(schema.orderItems).set({quantity:"11"}).where(eq(schema.orderItems.id,id(6)));
    await expect(reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:["0"],fingerprint:await finger(f.access)})).rejects.toThrow("order item or package changed");
    await resolveAction(f,{match:"confirmed"});
    const r=(await workspace()).documents[0]!.receivingReview!.lines[0]!.resolution!;
    expect(r.match).toBe("confirmed"); expect(r.specification).toBe("unresolved"); expect(r.quantity).toBe("unresolved");
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("rejects confirmation of counterpart facts that changed after the reviewer saw them",async()=>{
    const f=await confirmedHeader();
    const shown=(await orderSnapshot(db,f.access,order)).find(i=>i.id===id(6))!;
    const counterpartFingerprint=resolutionCounterpartFingerprint(shown);
    await resolveAction(f,{match:"confirmed",counterpartFingerprint});
    await db.update(schema.orderItems).set({quantity:"11"}).where(eq(schema.orderItems.id,id(6)));
    const before=await workspace();
    await expect(resolveAction(f,{specification:"confirmed",counterpartFingerprint})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(resolveAction(f,{specification:"confirmed",counterpartFingerprint:null})).rejects.toMatchObject({code:"CONFLICT"});
    expect(await workspace()).toEqual(before);
    const current=(await orderSnapshot(db,f.access,order)).find(i=>i.id===id(6))!;
    await resolveAction(f,{specification:"confirmed",counterpartFingerprint:resolutionCounterpartFingerprint(current)});
    const resolution=(await workspace()).documents[0]!.receivingReview!.lines[0]!.resolution!;
    expect(resolution.specification).toBe("confirmed");
    expect(resolution.match).toBe("unresolved");
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("counts checked lines as ready instead of checks still required", async () => {
    const f = await confirmedHeader();
    const original = (await workspace()).documents[0]!.receivingReview!.lines[0]!;
    await reviewAction(f.access,f.doc.documentId,{action:"line",lineId:original.id,description:original.description,sku:original.sku,quantity:6,ordered:10,unit:"ea",unitPrice:null,orderItemId:id(6),checked:true});
    for (let n = 0; n < 9; n++) {
      await reviewAction(f.access,f.doc.documentId,{action:"addLine",page:1,description:`Extra row ${n}`});
      const l = (await workspace()).documents[0]!.receivingReview!.lines.at(-1)!;
      await reviewAction(f.access,f.doc.documentId,{action:"line",lineId:l.id,description:l.description,sku:"",quantity:n===8?null:1,ordered:1,unit:"ea",unitPrice:null,orderItemId:id(6),checked:n!==8});
    }
    const queue = (await receivingQueue(f.access)).documents.find(d=>d.id===f.doc.documentId)!;
    expect(queue).toMatchObject({pending:10,toReview:1,ready:9,status:"review"});
    const detail = await receivingQueue(f.access, f.doc.documentId);
    expect(detail.documents.find(d=>d.id===f.doc.documentId)).toMatchObject({toReview:1,ready:9});
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("shows fully posted receipts as complete even when the document checkbox is cleared", async () => {
    const f = await confirmedHeader();
    await resolveAction(f, allResolved);
    await reviewAction(f.access, f.doc.documentId, { action:"approve", lineIds:["0"], fingerprint:await finger(f.access) });
    const review = (await workspace()).documents[0]!.receivingReview!;
    expect(review.documentChecked).not.toBe(true);
    expect((await receivingQueue(f.access)).documents.find(d => d.id === f.doc.documentId)?.status).toBe("complete");
    const received = Number((await item()).receivedQuantity);
    await reviewAction(f.access, f.doc.documentId, {action:"addLine", page:1, description:"Another unreviewed line"});
    expect((await receivingQueue(f.access)).documents.find(d => d.id === f.doc.documentId)?.status).toBe("review");
    expect(Number((await item()).receivedQuantity)).toBe(received);
  });
  it("splits a printed line without double receiving and requires each derived line to be reviewed", async () => {
    const f = await confirmedHeader();
    await reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:["0"],reason:"Two separately labelled batches",outputs:[{description:"Valve batch A",sku:"",quantity:2,unit:"ea",orderItemId:id(6)},{description:"Valve batch B",sku:"",quantity:4,unit:"ea",orderItemId:id(6)}]});
    let review = (await workspace()).documents[0]!.receivingReview!;
    expect(review.lines[0]!.ignored).toBeTruthy();
    await expect(reviewAction(f.access,f.doc.documentId,{action:"restoreLine",lineId:"0",reason:"Attempt to reuse allocated source"})).rejects.toThrow("cannot be received twice");
    const newIds = review.lines.slice(1).map(l => l.id);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    await expect(reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:newIds,fingerprint:await finger(f.access)})).rejects.toThrow();
    for(const lineId of newIds) await resolveAction(f,allResolved,lineId);
    await reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:newIds,fingerprint:await finger(f.access)});
    review = (await workspace()).documents[0]!.receivingReview!;
    expect(review.lines.filter(l => l.approved).reduce((n,l)=>n+l.approved!.quantity,0)).toBe(6);
    expect(Number((await item()).receivedQuantity)).toBe(8);
    await expect(reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:[newIds[0]],reason:"Cannot duplicate received rows",outputs:[{description:"Valve",sku:"",quantity:2,unit:"ea",orderItemId:id(6)}]})).rejects.toThrow("unapproved");
  });
  it.each(["inflated","foreign","unit"])("rejects %s allocations atomically",async mode=>{
    const f=await confirmedHeader(), before=await workspace();
    await expect(reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:["0"],reason:"Test reviewed allocation",outputs:[{description:"Valve",sku:"",quantity:mode==="inflated"?7:6,unit:mode==="unit"?"box":"ea",orderItemId:mode==="foreign"?id(999):id(6)}]})).rejects.toThrow();
    expect(await workspace()).toEqual(before);
  });
  it("prevents restoring ancestors while a nested allocation owns their quantity",async()=>{
    const f=await confirmedHeader();
    const output={description:"Valve",sku:"",quantity:6,unit:"ea",orderItemId:id(6)};
    await reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:["0"],reason:"Initial corrected line",outputs:[output]});
    const child=(await workspace()).documents[0]!.receivingReview!.lines.at(-1)!.id;
    await reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:[child],reason:"Refined corrected line",outputs:[output]});
    await expect(reviewAction(f.access,f.doc.documentId,{action:"restoreLine",lineId:"0",reason:"Try restoring ancestor"})).rejects.toThrow("cannot be received twice");
    await expect(reviewAction(f.access,f.doc.documentId,{action:"restoreLine",lineId:child,reason:"Try restoring parent"})).rejects.toThrow("cannot be received twice");
    expect((await workspace()).documents[0]!.receivingReview!.lines.filter(l=>!l.ignored)).toHaveLength(1);
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("does not revive retired allocation children after restoring or reallocating their source",async()=>{
    const f=await confirmedHeader(), output={description:"Valve",sku:"",quantity:6,unit:"ea",orderItemId:id(6)};
    await reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:["0"],reason:"Initial allocation",outputs:[output]});
    const child=(await workspace()).documents[0]!.receivingReview!.lines.at(-1)!.id;
    await reviewAction(f.access,f.doc.documentId,{action:"ignore",lineId:child,reason:"Reverting this allocation"});
    await reviewAction(f.access,f.doc.documentId,{action:"restoreLine",lineId:"0",reason:"Restore original evidence"});
    await expect(reviewAction(f.access,f.doc.documentId,{action:"restoreLine",lineId:child,reason:"Reusing previous allocation"})).rejects.toThrow("same source twice");
    await reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:["0"],reason:"New replacement allocation",outputs:[output]});
    await expect(reviewAction(f.access,f.doc.documentId,{action:"restoreLine",lineId:child,reason:"Reusing obsolete allocation"})).rejects.toThrow("same source twice");
    expect((await workspace()).documents[0]!.receivingReview!.lines.filter(l=>!l.ignored)).toHaveLength(1);
  });
  it("undoes the latest unapproved correction with an audit and refuses undo after later changes",async()=>{
    const f=await confirmedHeader(), before=structuredClone((await workspace()).documents[0]!.receivingReview!.lines), requestId=randomUUID();
    await resolveAction(f,{...allResolved,requestId});
    expect((await receivingQueue(f.access,f.doc.documentId)).correctionUndo?.requestId).toBe(requestId);
    await reviewAction(f.access,f.doc.documentId,{action:"undoCorrection",requestIdToUndo:requestId,reason:"Wrong evidence selected"});
    expect((await workspace()).documents[0]!.receivingReview!.lines).toEqual(before);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    await expect(reviewAction(f.access,f.doc.documentId,{action:"undoCorrection",requestIdToUndo:requestId,reason:"Cannot undo the same correction twice"})).rejects.toMatchObject({code:"CONFLICT"});
    const history=await db.select().from(schema.packingSlipReviewHistory);
    expect(history.find(h=>(h.data as {operation?:string}).operation==="undoCorrection")!.data).toMatchObject({reason:"Wrong evidence selected",undoesRequestId:requestId});
  });
  it("keeps a reviewer's note on the line without confirming, clearing or reopening any check",async()=>{
    const f=await confirmedHeader();
    await resolveAction(f,{match:"confirmed",specification:"confirmed"});
    const before=(await workspace()).documents[0]!.receivingReview!.lines[0]!;
    const requestId=randomUUID();
    await reviewAction(f.access,f.doc.documentId,{action:"note",lineId:"0",note:"Supplier to confirm the box size",requestId});
    const detail=await receivingQueue(f.access,f.doc.documentId);
    const saved=detail.review!.lines[0]!;
    expect(saved.note?.text).toBe("Supplier to confirm the box size");
    expect(typeof detail.noteAuthors?.[saved.note!.by]).toBe("string");
    expect(saved.resolution).toEqual(before.resolution);
    expect(saved.checked).toBe(before.checked);
    expect(detail.correctionUndo?.requestId).toBe(requestId);
    await reviewAction(f.access,f.doc.documentId,{action:"note",lineId:"0",note:""});
    expect((await workspace()).documents[0]!.receivingReview!.lines[0]!.note).toBeUndefined();
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("detects a selected row, links it without receiving, and rejects another run on the linked item", async () => {
    const f = await confirmedHeader();
    const doc = (await workspace()).documents[0]!;
    const original = doc.receivingReview!.lines[0]!;
    await reviewAction(f.access, f.doc.documentId, { action: "line", lineId: original.id, description: original.description, sku: original.sku, quantity: original.quantity, ordered: original.ordered, unit: original.unit, unitPrice: null, orderItemId: null, checked: false });
    test.selectedLine.mockResolvedValue({ band: {x:0,y:.7,width:1,height:.04}, line: { page:1, evidence:"Cap 2 1 1", description:"Cap", sku:"CAP", shipped:1, ordered:2, backordered:1, unit:"ea", issues:[], confidence:{part:.95,quantity:.96,match:.91,overall:.91,reason:"Printed row"} } });
    const action = {action:"detectLine", versionId:doc.currentVersionId, itemId:id(6), page:1, sourceBox:{x:.2,y:.7,width:.2,height:.04}};
    await reviewAction(f.access, f.doc.documentId, action);
    const line = (await workspace()).documents[0]!.receivingReview!.lines.at(-1)!;
    expect(line.orderItemId).toBe(id(6)); expect(line.quantity).toBe(1);
    expect(line.checked).toBe(false); expect(line.approved).toBeUndefined();
    expect(line.selectedReading?.backordered).toBe(1);
    expect(line.sourceBox?.width).toBe(1);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    await expect(reviewAction(f.access, f.doc.documentId, action)).rejects.toThrow("already has a linked line");
  });
  it("preserves source crop for manually recovered lines and leaves them unchecked",async()=>{
    const f=await confirmedHeader();
    const sourceBox={x:0.1,y:0.2,width:0.7,height:0.05};
    await reviewAction(f.access,f.doc.documentId,{action:"addLine",page:2,sourceBox,description:"Missed valve line"});
    const line=(await workspace()).documents[0]!.receivingReview!.lines.at(-1)!;
    expect(line.sourceBox).toEqual(sourceBox); expect(line.page).toBe(2); expect(line.checked).toBe(false); expect(line.approved).toBeUndefined();
  });
  it("posts a financial credit without recording a physical return or reducing received stock",async()=>{
    const f=await confirmedHeader();
    const line=(await workspace()).documents[0]!.receivingReview!.lines[0]!;
    await reviewAction(f.access,f.doc.documentId,{action:"line",lineId:line.id,kind:"credit-only",description:line.description,sku:line.sku,quantity:3,ordered:line.ordered,unit:"ea",unitPrice:null,orderItemId:id(6),checked:true});
    await reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:[line.id],fingerprint:await finger(f.access)});
    expect(Number((await item()).receivedQuantity)).toBe(2);
    expect(Number((await item()).returnedQuantity)).toBe(0);
    expect(Number((await item()).creditedQuantity)).toBe(3);
    expect((await workspace()).documents[0]!.packingSlipAnalysis!.applied!.quantities[id(6)]).toBe(0);
  });
  it("complete split allocations do not acquire a false partial-shipment blocker mid-approval",async()=>{
    const f=await confirmedHeader();
    await db.update(schema.orderItems).set({quantity:"8"}).where(eq(schema.orderItems.id,id(6)));
    await reviewAction(f.access,f.doc.documentId,{action:"allocate",lineIds:["0"],reason:"Two batches of same valve",outputs:[{description:"Valve A",sku:"",quantity:2,unit:"ea",orderItemId:id(6)},{description:"Valve B",sku:"",quantity:4,unit:"ea",orderItemId:id(6)}]});
    const ids=(await workspace()).documents[0]!.receivingReview!.lines.slice(1).map(l=>l.id);
    for(const lineId of ids) await resolveAction(f,{...allResolved,remainder:null},lineId);
    await reviewAction(f.access,f.doc.documentId,{action:"approve",lineIds:ids,fingerprint:await finger(f.access)});
    expect(Number((await item()).receivedQuantity)).toBe(8);
  });
  it("records and undoes absent-item dispositions without creating receipt rows or changing orders",async()=>{
    const f=await confirmedHeader();
    const state=await workspace(); state.documents[0]!.receivingReview!.lines[0]!.orderItemId=null;
    await db.update(schema.jobDocumentWorkspaces).set({state}).where(eq(schema.jobDocumentWorkspaces.jobId,job));
    const before=await item(), requestId=randomUUID();
    await reviewAction(f.access,f.doc.documentId,{action:"orderDisposition",itemId:id(6),disposition:"cancel-requested",note:"Supplier confirmed this was not sent",requestId});
    expect(await item()).toEqual(before);
    expect((await workspace()).documents[0]!.receivingReview!.orderResolutions?.[id(6)]?.disposition).toBe("cancel-requested");
    expect((await receivingQueue(f.access,f.doc.documentId)).documents[0]!.pending).toBe(2);
    expect((await receivingQueue(f.access,f.doc.documentId)).correctionUndo?.requestId).toBe(requestId);
    await reviewAction(f.access,f.doc.documentId,{action:"undoCorrection",requestIdToUndo:requestId,reason:"Found the missing line on another page"});
    expect((await workspace()).documents[0]!.receivingReview!.orderResolutions).toBeUndefined();
    expect(await item()).toEqual(before);
  });
  it("counting an absent item as backordered keeps its order due without adding a pending issue",async()=>{
    const f=await confirmedHeader(), state=await workspace();
    state.documents[0]!.receivingReview!.lines[0]!.orderItemId=null;
    await db.update(schema.jobDocumentWorkspaces).set({state}).where(eq(schema.jobDocumentWorkspaces.jobId,job));
    await reviewAction(f.access,f.doc.documentId,{action:"orderDisposition",itemId:id(6),disposition:"backordered",note:"Supplier will send the balance"});
    expect((await receivingQueue(f.access,f.doc.documentId)).documents[0]!.pending).toBe(1);
    expect(Number((await item()).quantity)).toBe(10);
  });
  it("removes an unreceived quoted order line without deleting its material-list entry", async () => {
    const { access, doc } = await confirmedHeader();
    await db.update(schema.orderItems).set({ receivedQuantity: "0" }).where(eq(schema.orderItems.id, id(6)));
    await db.insert(schema.quoteItems).values({
      id: id(820), quoteId: id(821), partDefinitionId: id(5),
      quantity: "10", sentOrderItemId: id(6),
    } as never);
    await conn.unsafe('ALTER TABLE kublai_quote_item ADD CONSTRAINT removal_test_fk FOREIGN KEY ("sentOrderItemId") REFERENCES kublai_order_item(id) ON DELETE RESTRICT');
    try {
      const state = await workspace();
      state.documents[0]!.receivingReview!.lines.forEach(line => { line.orderItemId = null; });
      await db.update(schema.jobDocumentWorkspaces).set({ state }).where(eq(schema.jobDocumentWorkspaces.jobId, job));
      await reviewAction(access, doc.documentId, {
        action: "removeOrderItem", itemId: id(6), confirmed: true,
        fingerprint: orderFingerprint(await orderSnapshot(db, access, order)),
      });
      expect(await db.select().from(schema.orderItems)).toHaveLength(0);
      expect(await db.select().from(schema.quoteItems)).toMatchObject([
        { id: id(820), partDefinitionId: id(5), quantity: "10.000000", sentOrderItemId: null },
      ]);
    } finally {
      await conn.unsafe('ALTER TABLE kublai_quote_item DROP CONSTRAINT removal_test_fk');
    }
  });
  it.each(["success", "received", "matched", "stale", "foreign"])("removing an absent order item: %s", async (mode) => {
    const {access, doc} = await confirmedHeader();
    await db.update(schema.orderItems).set({receivedQuantity: mode === "received" ? "2" : "0"}).where(eq(schema.orderItems.id, id(6)));
    const state = await workspace();
    const review = state.documents.find(d => d.id === doc.documentId)!.receivingReview!;
    if (mode !== "matched") review.lines.forEach(l => { l.orderItemId = null; });
    await db.update(schema.jobDocumentWorkspaces).set({state}).where(eq(schema.jobDocumentWorkspaces.jobId, job));
    const action = {action: "removeOrderItem", itemId: mode === "foreign" ? id(999) : id(6), fingerprint: mode === "stale" ? "stale" : orderFingerprint(await orderSnapshot(db, access, order)), confirmed: true};
    if (mode !== "success") {
      await expect(reviewAction(access, doc.documentId, action)).rejects.toThrow();
      expect(await db.select().from(schema.orderItems)).toHaveLength(1);
    } else {
      await reviewAction(access, doc.documentId, action);
      expect(await db.select().from(schema.orderItems)).toHaveLength(0);
      expect(await db.select().from(schema.partDefinitions)).toHaveLength(1);
      const history = await db.select().from(schema.packingSlipReviewHistory);
      expect(history.some(h => (h.data as {removedOrderItem?: {id:string}}).removedOrderItem?.id === id(6))).toBe(true);
    }
  });
  const finger = async (
    access: Awaited<ReturnType<typeof assertDocumentAccess>>,
  ) => orderFingerprint(await orderSnapshot(db, access, order));
  it.each(["header", "link"] as const)(
    "renames an imported PDF only when the order is confirmed through %s",
    async (action) => {
      const access = await assertDocumentAccess("receiver", job, db);
      const saved = await saveUnmatchedSlip(
        access,
        {
          name: "supplier-email.pdf",
          mimeType: "application/pdf",
          size: 100,
          sha256: "b".repeat(64),
        },
        async () => undefined,
      );
      const state = await workspace();
      state.documents[0]!.name = state.versions[0]!.name = "supplier-email.pdf";
      // A reader's suggested order is not yet a human confirmation.
      state.documents[0]!.packingSlip = {
        orderId: order,
        orderNumber: "PO-123",
        materialListId: list,
        materialListName: "Level 3",
      };
      await db
        .update(schema.jobDocumentWorkspaces)
        .set({ state })
        .where(eq(schema.jobDocumentWorkspaces.jobId, job));
      await reviewAction(access, saved.documentId, {
        action: "addLine",
        page: 1,
        description: "Valve",
      });
      expect((await workspace()).documents[0]?.name).toBe("supplier-email.pdf");
      expect(
        (await readableVersion(access, saved.versionId)).version.name,
      ).toBe("supplier-email.pdf");
      const confirmation =
        action === "link"
          ? { action, orderId: order, confirmed: true }
          : {
              action,
              kind: "delivery",
              supplierId: null,
              supplierName: "",
              deliveryNumber: "",
              supplierOrderNumber: "",
              deliveryDate: "",
              confirmed: true,
            };
      test.receive = false;
      await expect(
        reviewAction(access, saved.documentId, confirmation),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await workspace()).documents[0]?.name).toBe("supplier-email.pdf");
      test.receive = true;
      await reviewAction(access, saved.documentId, confirmation);
      const { document, version } = await readableVersion(
        access,
        saved.versionId,
      );
      expect(document.name).toBe("Packing slip - PO-123.pdf");
      expect(document.receivingReview?.orderConfirmed).toBe(true);
      expect(version).toMatchObject({
        id: saved.versionId,
        name: document.name,
        sha256: "b".repeat(64),
      });
      expect(Number((await item()).receivedQuantity)).toBe(2);
    },
  );
  it.each(["astra", "liquid"] as const)(
    "imports %s proposals without changing receipts, and rejects stale or foreign matches",
    async (reader) => {
      const { access, doc } = await ready();
      const document = (await workspace()).documents[0]!;
      const score = {
        value: 0.99,
        basis: "self_assessed",
        reason: "Fixture source",
      };
      const prediction = {
        schemaVersion: 1,
        caseId: "case-001",
        reader,
        model: "gpt-6-astra",
        status: "complete",
        sourceSha256: "a".repeat(64),
        documentKind: "delivery",
        orderId: order,
        lines: [
          {
            lineId: "one",
            page: 1,
            box: null,
            evidence: "Valve 4 ea",
            description: "Valve",
            sku: null,
            ordered: 10,
            shipped: 4,
            backordered: 6,
            unit: "ea",
            unitPrice: null,
            orderItemId: id(6),
            confidence: {
              part: score,
              quantity: score,
              match: score,
              overall: score,
            },
            issues: [],
          },
        ],
        warnings: [],
      };
      test.trial = {
        runId: "trial-testing-001",
        stale: false,
        entry: { versionId: document.currentVersionId },
        results: { [reader]: prediction },
      };
      await reviewAction(access, doc.documentId, {
        action: "trialDraft",
        runId: "trial-testing-001",
        reader,
      });
      let review = (await workspace()).documents[0]!.receivingReview!;
      expect(review.lines[0]!.quantity).toBe(4);
      expect(review.lines[0]!.approved).toBeUndefined();
      expect(review.lines[0]!.predictionSource?.reader).toBe(reader);
      expect(review.orderConfirmed).toBe(false);
      expect(Number((await item()).receivedQuantity)).toBe(2);
      test.trial = { ...(test.trial as object), stale: true };
      await expect(
        reviewAction(access, doc.documentId, {
          action: "trialDraft",
          runId: "trial-testing-001",
          reader,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      test.trial = {
        runId: "trial-testing-001",
        stale: false,
        results: {
          [reader]: {
            ...prediction,
            lines: [{ ...prediction.lines[0], orderItemId: id(99) }],
          },
        },
      };
      await reviewAction(access, doc.documentId, {
        action: "trialDraft",
        runId: "trial-testing-001",
        reader,
      });
      review = (await workspace()).documents[0]!.receivingReview!;
      expect(review.lines[0]!.orderItemId).toBeNull();
      expect(Number((await item()).receivedQuantity)).toBe(2);
      test.receive = false;
      await expect(
        reviewAction(access, doc.documentId, {
          action: "trialDraft",
          runId: "trial-testing-001",
          reader,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
  it("stages a development trial once without human labels, receipt changes or overwriting later edits", async () => {
    const { access, doc } = await ready();
    const score = { value: 0.9, basis: "self_assessed", reason: "Fixture" };
    const prediction = {
      status: "complete",
      documentKind: "delivery",
      orderId: order,
      warnings: [],
      lines: [
        {
          lineId: "one",
          page: 1,
          box: null,
          evidence: "Valve 4 ea",
          description: "Valve",
          sku: null,
          ordered: 10,
          shipped: 4,
          backordered: 6,
          unit: "ea",
          unitPrice: null,
          orderItemId: id(6),
          issues: [],
          confidence: {
            part: score,
            quantity: score,
            match: score,
            overall: score,
          },
        },
      ],
    };
    test.trial = {
      runId: "trial-testing-001",
      stale: false,
      results: { astra: prediction },
    };
    const input = {
      action: "trialDraft" as const,
      jobId: job,
      documentId: doc.documentId,
      revision: 1,
      requestId: randomUUID(),
      runId: "trial-testing-001",
      reader: "astra" as const,
    };
    await expect(importTrialReview(access, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    test.trial = {
      runId: input.runId,
      stale: false,
      results: Object.fromEntries(
        ["astra", "terra", "jev", "ocr"].map((reader) => [
          reader,
          { ...prediction, reader },
        ]),
      ),
    };
    await importTrialReview(access, input);
    const saved = (await workspace()).documents[0]!.receivingReview!;
    expect(saved.humanReviewed).not.toBe(true);
    expect(saved.documentChecked).toBe(false);
    expect(saved.lines[0]!.approved).toBeUndefined();
    expect(saved.lines[0]!.quantity).toBe(4);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    const imported = (
      await db.select().from(schema.packingSlipReviewHistory)
    ).find(
      (h) => (h.data as { operation?: string }).operation === "trial-import",
    );
    expect(imported?.kind).toBe("analysis");
    const second = await importTrialReview(access, {
      ...input,
      revision: saved.revision,
      requestId: randomUUID(),
    });
    expect(second.replayed).toBe(true);
    expect((await workspace()).documents[0]!.receivingReview!.revision).toBe(
      saved.revision,
    );
    await reviewAction(access, doc.documentId, {
      action: "header",
      kind: "delivery",
      supplierId: null,
      supplierName: "Human correction",
      deliveryNumber: "Checked",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    const before = (await workspace()).documents[0]!.receivingReview!;
    const skipped = await importTrialReview(access, {
      ...input,
      revision: before.revision,
      requestId: randomUUID(),
    });
    expect(skipped).toHaveProperty("skipped");
    expect((await workspace()).documents[0]!.receivingReview).toEqual(before);
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("preserves saved review decisions when cleared detection reuses an identical source", async () => {
    const { access } = await ready();
    const duplicate = await saveDocumentVersion(
      access,
      { ...file, name: "another scan.jpg" },
      async () => undefined,
    );
    await startSlipAnalysis(access, duplicate.documentId);
    await reviewAction(access, duplicate.documentId, {
      action: "header",
      kind: "delivery",
      supplierId: null,
      supplierName: "Checked supplier",
      deliveryNumber: "D-123",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    await reviewAction(access, duplicate.documentId, {
      action: "line",
      lineId: "0",
      description: "Checked valve",
      sku: "",
      quantity: 7,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    const before = (await workspace()).documents.find(
      (d) => d.id === duplicate.documentId,
    )!;
    await clearSlipAnalysis(
      access,
      duplicate.documentId,
      before.packingSlipAnalysis!.runId,
    );
    test.extractionStarted = false;
    await startSlipAnalysis(access, duplicate.documentId);
    const after = (await workspace()).documents.find(
      (d) => d.id === duplicate.documentId,
    )!;
    expect(test.extractionStarted).toBe(false);
    expect(after.packingSlipAnalysis!.usage?.calls).toBe(0);
    expect(after.receivingReview!.deliveryNumber).toBe("D-123");
    expect(after.receivingReview!.lines[0]).toMatchObject({
      description: "Checked valve",
      quantity: 7,
      checked: true,
    });
    expect(
      after
        .receivingReview!.lines.slice(1)
        .every(
          (l) =>
            !l.checked &&
            l.issues.some((issue) => issue.startsWith("New reading:")),
        ),
    ).toBe(true);
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  async function confidentSavedSlip() {
    const fixture = await confirmedHeader();
    const state = await workspace();
    const doc = state.documents[0]!;
    doc.packingSlipAnalysis!.lines[0]!.readings = [
      {
        reader: "ocr",
        shipped: null,
        unit: "ea",
        orderItemId: id(6),
        match: 0.95,
        quantity: 0,
      },
      {
        reader: "jev",
        shipped: 6,
        unit: "ea",
        orderItemId: id(6),
        match: 0.9,
        quantity: 0.9,
      },
      {
        reader: "terra",
        shipped: 6,
        unit: "ea",
        orderItemId: id(6),
        match: 0.99,
        quantity: 0.99,
      },
    ];
    doc.receivingReview!.lines[0]!.issues = [
      "Check shipped quantity against the slip.",
    ];
    doc.receivingReview!.lines[0]!.checked = false;
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    return fixture;
  }
  it("auto-confirms saved reader evidence on read, then posts only on explicit approval", async () => {
    const { access, doc } = await confidentSavedSlip();
    const before = await workspace();
    const detail = await receivingQueue(access, doc.documentId);
    expect(detail.review!.lines[0]).toMatchObject({
      autoConfirmed: true,
      checked: false,
      quantity: 6,
    });
    expect(await workspace()).toEqual(before);
    expect(Number((await item()).receivedQuantity)).toBe(2);
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    expect(Number((await item()).receivedQuantity)).toBe(8);
    expect(
      (await workspace()).documents[0]!.receivingReview!.lines[0]!.approved
        ?.quantity,
    ).toBe(6);
  });
  it("does not auto-confirm a human-edited quantity from the original high-confidence prediction", async () => {
    const { access, doc } = await confidentSavedSlip();
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 7,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: false,
    });
    const detail = await receivingQueue(access, doc.documentId);
    expect(detail.review!.lines[0]!.autoConfirmed).toBe(false);
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("Check the flagged lines");
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });

  it("recalculates confidence at approval instead of trusting a stale auto-confirmed flag", async () => {
    const { access, doc } = await confidentSavedSlip();
    expect(
      (await receivingQueue(access, doc.documentId)).review!.lines[0]!
        .autoConfirmed,
    ).toBe(true);
    const state = await workspace();
    const saved = state.documents[0]!;
    saved.receivingReview!.lines[0]!.autoConfirmed = true;
    for (const reading of saved.packingSlipAnalysis!.lines[0]!.readings!)
      reading.quantity = 0.89;
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    expect(
      (await receivingQueue(access, doc.documentId)).review!.lines[0]!
        .autoConfirmed,
    ).toBe(false);
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("Check the flagged lines");
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });

  it.each([false, true])(
    "normalizes saved ordered pieces only against current source evidence (stale=%s)",
    async (stale) => {
      const { access, doc } = await confirmedHeader();
      await db
        .update(schema.partDefinitions)
        .set({ piecesPerPack: 100, bulkUnit: "box", individualUnit: "pcs" })
        .where(eq(schema.partDefinitions.id, id(5)));
      await db
        .update(schema.orderItems)
        .set({ quantity: "3" })
        .where(eq(schema.orderItems.id, id(6)));
      const state = await workspace();
      const saved = state.documents[0]!;
      Object.assign(saved.packingSlipAnalysis!.lines[0]!, {
        ordered: 300,
        shipped: 200,
        proposed: null,
        unit: null,
      });
      Object.assign(saved.receivingReview!.lines[0]!, {
        ordered: 300,
        quantity: 2,
        unit: "box",
        checked: true,
        approved: {
          quantity: 2,
          itemId: id(6),
          kind: "delivery",
          by: "receiver",
          at: "now",
        },
      });
      if (stale) saved.receivingReview!.analysisRunId = "old-run";
      await db
        .update(schema.jobDocumentWorkspaces)
        .set({ state })
        .where(eq(schema.jobDocumentWorkspaces.jobId, job));
      const before = await workspace();
      const receivedBefore = (await item()).receivedQuantity;
      const detail = await receivingQueue(access, doc.documentId);
      expect(detail.review!.lines[0]).toMatchObject({
        ordered: stale ? 300 : 3,
        quantity: 2,
        unit: "box",
        approved: { quantity: 2 },
      });
      expect(await workspace()).toEqual(before);
      expect((await item()).receivedQuantity).toBe(receivedBefore);
    },
  );
  it("new queue approves once under concurrent requests and preserves unresolved lines", async () => {
    const { access, doc } = await confirmedHeader();
    const legacyState = await workspace();
    legacyState.documents[0]!.name = legacyState.versions[0]!.name =
      "old-upload.jpg";
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state: legacyState })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    await reviewAction(access, doc.documentId, {
      action: "addLine",
      page: 1,
      description: "Unknown valve",
    });
    const d = (await workspace()).documents[0]!;
    const input = receivingInput.parse({
      action: "approve",
      jobId: job,
      documentId: doc.documentId,
      revision: d.receivingReview!.revision,
      requestId: randomUUID(),
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    const result = await Promise.all([
      mutateReceiving(access, input),
      mutateReceiving(access, input),
    ]);
    expect(result.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect((await workspace()).documents[0]?.name).toBe(
      "Packing slip - PO-123.jpg",
    );
    expect((await readableVersion(access, doc.versionId)).version.name).toBe(
      "Packing slip - PO-123.jpg",
    );
    expect(Number((await item()).receivedQuantity)).toBe(8);
    const lines = (await workspace()).documents[0]!.receivingReview!.lines;
    expect(lines.filter((l) => l.approved)).toHaveLength(1);
    expect(lines.filter((l) => !l.approved)).toHaveLength(1);
    await expect(
      mutateReceiving(access, { ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("corrections apply only the difference and require a reason", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 7,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("why");
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
      reason: "Corrected printed quantity",
    });
    expect(Number((await item()).receivedQuantity)).toBe(9);
  });
  it("lets a slip take over a hand count of the same parts instead of adding to it", async () => {
    const { access, doc } = await confirmedHeader();
    // Marked received by hand on the order before the slip was reviewed.
    await db
      .update(schema.orderItems)
      .set({ receivedQuantity: "10", verificationStatus: "complete" })
      .where(eq(schema.orderItems.id, id(6)));
    const receipts = async () =>
      (await receivingQueue(access, doc.documentId)).receipts![id(6)];
    expect(await receipts()).toEqual({ slips: [], byHand: 10 });
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("exceeds the quantity due");
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
      fromHandCount: true,
    });
    expect(Number((await item()).receivedQuantity)).toBe(10);
    const line = (await workspace()).documents[0]!.receivingReview!.lines[0]!;
    expect(line.approved).toMatchObject({ quantity: 6, fromHand: 6 });
    expect(await receipts()).toEqual({
      slips: [expect.objectContaining({ quantity: 6, self: true })],
      byHand: 4,
    });
    // Correcting the slip to nothing gives the parts back to the hand count.
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 0,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
      reason: "Not on this delivery",
    });
    expect(Number((await item()).receivedQuantity)).toBe(10);
    expect(await receipts()).toEqual({ slips: [], byHand: 10 });
  });
  it("takes over only what was counted by hand, and adds the rest", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
      fromHandCount: true,
    });
    expect(Number((await item()).receivedQuantity)).toBe(6);
    expect(
      (await workspace()).documents[0]!.receivingReview!.lines[0]!.approved,
    ).toMatchObject({ quantity: 6, fromHand: 2 });
  });
  it("rejects duplicate files until a person explicitly permits an additional delivery", async () => {
    const { access, doc } = await confirmedHeader();
    await saveDocumentVersion(
      access,
      { ...file, name: "duplicate.jpg" },
      async () => undefined,
    );
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("duplicate");
    const other = (await workspace()).documents.find(
      (d) => d.id !== doc.documentId,
    )!;
    await reviewAction(access, doc.documentId, {
      action: "duplicate",
      decision: "additional",
      otherDocumentId: other.id,
      reason: "Confirmed a distinct physical delivery",
    });
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    expect(Number((await item()).receivedQuantity)).toBe(8);
  });
  it("credits a return without reopening its outstanding quantity", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "header",
      kind: "return-credit",
      supplierId: null,
      supplierName: "",
      deliveryNumber: "",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 1,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    expect(Number((await item()).receivedQuantity)).toBe(1);
    expect(Number((await item()).creditedQuantity)).toBe(1);
    expect(Number((await item()).returnedQuantity)).toBe(1);
    expect((await orderSnapshot(db, access, order))[0]!.ordered).toBe(9);
  });
  it("rejects excessive returns, stale totals, foreign order items and revoked permissions", async () => {
    const { access, doc } = await confirmedHeader();
    const old = await finger(access);
    await db
      .update(schema.orderItems)
      .set({ receivedQuantity: "3" })
      .where(eq(schema.orderItems.id, id(6)));
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: old,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      reviewAction(access, doc.documentId, {
        action: "line",
        lineId: "0",
        description: "Wrong item",
        sku: "",
        quantity: 1,
        ordered: 1,
        unit: "ea",
        unitPrice: null,
        orderItemId: id(99),
        checked: true,
      }),
    ).rejects.toThrow("this job");
    await reviewAction(access, doc.documentId, {
      action: "header",
      kind: "return-replacement",
      supplierId: null,
      supplierName: "",
      deliveryNumber: "",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("exceeds");
    test.receive = false;
    await expect(
      reviewAction(access, doc.documentId, {
        action: "addLine",
        page: 1,
        description: "Unallowed",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(Number((await item()).receivedQuantity)).toBe(3);
  });
  it("only job approvers can create shared suppliers", async () => {
    const { access, doc } = await confirmedHeader();
    const create = {
      action: "supplier",
      name: "New Supplier",
      email: "orders@example.test",
      phone: "555-555-5555",
    };
    await expect(
      reviewAction(access, doc.documentId, create),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db
      .update(schema.jobs)
      .set({ foremanUserId: "receiver" })
      .where(sql`"id"=${job}`);
    await reviewAction(access, doc.documentId, create);
    expect((await db.select().from(schema.suppliers))[0]!.name).toBe(
      "New Supplier",
    );
    await expect(
      reviewAction(access, doc.documentId, create),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("preserves a header confirmed while extraction is still running", async () => {
    let release!: () => void;
    test.extractionGate = new Promise<void>((r) => {
      release = r;
    });
    const access = await assertDocumentAccess("receiver", job, db);
    const doc = await saveDocumentVersion(access, file, async () => undefined);
    await startSlipAnalysis(access, doc.documentId);
    await reviewAction(access, doc.documentId, {
      action: "header",
      kind: "return-credit",
      supplierId: null,
      supplierName: "Confirmed name",
      deliveryNumber: "CREDIT-22",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    release();
    for (let n = 0; n < 100; n++) {
      if (
        (await workspace()).documents[0]!.packingSlipAnalysis?.status ===
        "ready"
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const review = (await workspace()).documents[0]!.receivingReview!;
    expect(review.deliveryNumber).toBe("CREDIT-22");
    expect(review.kind).toBe("return-credit");
    expect(review.lines).toHaveLength(1);
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("replaces a duplicate by transferring its baseline, then applies only the reviewed correction", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    const copy = await saveDocumentVersion(
      access,
      { ...file, name: "correction.jpg" },
      async () => undefined,
    );
    await startSlipAnalysis(access, copy.documentId);
    await reviewAction(access, copy.documentId, {
      action: "header",
      kind: "delivery",
      supplierId: null,
      supplierName: "",
      deliveryNumber: "",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    await reviewAction(access, copy.documentId, {
      action: "duplicate",
      decision: "replace",
      otherDocumentId: doc.documentId,
      reason: "Corrected copy of the same delivery",
    });
    expect(Number((await item()).receivedQuantity)).toBe(8);
    await reviewAction(access, copy.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 7,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await reviewAction(access, copy.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
      reason: "Seven delivered on corrected slip",
    });
    expect(Number((await item()).receivedQuantity)).toBe(9);
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
        reason: "repeat",
      }),
    ).rejects.toThrow("replaced");
    const transfer = (
      await db.select().from(schema.packingSlipReviewHistory)
    ).find(
      (h) => (h.data as { operation?: string }).operation === "duplicate",
    )!;
    expect(transfer.data).toMatchObject({
      replacedDocument: {
        id: doc.documentId,
        after: { retiredBy: copy.documentId },
      },
    });
  });
  it("can exclude a receipt corrected to zero, without leaving a phantom delivery", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 0,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
      reason: "This line was not delivered",
    });
    await reviewAction(access, doc.documentId, {
      action: "ignore",
      lineId: "0",
      reason: "Not delivered",
    });
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("blocks the old receiving controls after a slip has been approved", async () => {
    const { access, doc } = await confirmedHeader();
    await db.transaction((tx) =>
      assertManualReceiptEditable(tx, org, job, order, id(6)),
    );
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    await expect(
      db.transaction((tx) =>
        assertManualReceiptEditable(tx, org, job, order, id(6)),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      db.transaction((tx) => assertManualReceiptEditable(tx, org, job, order)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db.transaction((tx) =>
      assertManualReceiptEditable(tx, org, job, order, id(99)),
    );
  });
  it("reopens the outstanding quantity for a replacement return, without issuing a credit", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "header",
      kind: "return-replacement",
      supplierId: null,
      supplierName: "",
      deliveryNumber: "",
      supplierOrderNumber: "",
      deliveryDate: "",
      confirmed: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Valve",
      sku: "",
      quantity: 1,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    const row = await item();
    expect(Number(row.receivedQuantity)).toBe(1);
    expect(Number(row.creditedQuantity)).toBe(0);
    expect(Number(row.returnedQuantity)).toBe(1);
    const snap = (await orderSnapshot(db, access, order))[0]!;
    expect(snap.ordered - snap.received).toBe(9);
  });
  it("creates a new list before catalogue matching and keeps unmatched slip lines for review", async () => {
    const {access, doc} = await confirmedHeader();
    await db.update(schema.jobs).set({foremanUserId: "receiver"}).where(sql`"id"=${job}`);
    await db.insert(schema.suppliers).values({id: id(70), organizationId: org, name: "Selected Supplier", kind: "external"});
    const before = (await workspace()).documents[0]!.receivingReview!.lines;
    await reviewAction(access, doc.documentId, {
      action: "reconstruct", materialListId: null, listName: "New delivery list",
      orderNumber: "NEW-EMPTY", supplierId: id(70), lineIds: [], confirmed: true,
    });
    const saved = (await workspace()).documents[0]!;
    expect(saved.packingSlip!.orderId).not.toBe(order);
    expect(saved.packingSlip!.materialListName).toBe("New delivery list");
    expect(saved.receivingReview!.supplierId).toBe(id(70));
    expect(saved.receivingReview!.lines).toHaveLength(before.length);
    expect(saved.receivingReview!.lines.every(line => !line.orderItemId && !line.approved)).toBe(true);
    expect((await db.select().from(schema.orderItems)).filter(row => row.orderId === saved.packingSlip!.orderId)).toEqual([]);
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it.each([false, true])("reconstructs a job-local order without receiving or sending (already linked: %s)", async (alreadyLinked) => {
    const { access, doc } = await confirmedHeader();
    await db
      .update(schema.jobs)
      .set({ foremanUserId: "receiver" })
      .where(sql`"id"=${job}`);
    const state = await workspace();
    if (!alreadyLinked) delete state.documents[0]!.packingSlip;
    state.documents[0]!.receivingReview!.orderConfirmed = false;
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    await reviewAction(access, doc.documentId, {
      action: "supplier",
      name: "Slip Supplier",
      email: "hello@example.test",
      phone: "",
    });
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "New elbow",
      sku: "EL123",
      quantity: 6,
      ordered: 10,
      unit: "ea",
      unitPrice: 5,
      orderItemId: null,
      checked: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "part",
      lineId: "0",
      partId: null,
      name: "New elbow",
      description: "New elbow from slip",
      catalogId: id(50),
      unit: "ea",
      piecesPerPack: null,
      individualUnit: "ea",
      photoUrl: null,
    });
    await reviewAction(access, doc.documentId, {
      action: "reconstruct",
      materialListId: null,
      listName: "Reconstructed material",
      orderNumber: "SLIP-PO-9",
      lineIds: ["0"],
      confirmed: true,
    });
    const newDoc = (await workspace()).documents[0]!,
      newOrder = (await db.select().from(schema.orders)).find(
        (o) => o.id === newDoc.packingSlip!.orderId,
      )!;
    expect(newDoc.name).toBe(`Packing slip - ${newOrder.orderNumber}.jpg`);
    expect(newOrder.orderNumber).toMatch(/^1-/);
    expect(newOrder.previousOrderNumbers).toEqual(["SLIP-PO-9"]);
    expect((await readableVersion(access, doc.versionId)).version.name).toBe(
      newDoc.name,
    );
    expect(newOrder).toMatchObject({
      jobId: job,
      organizationId: org,
      sentVia: "packing-slip",
      status: "sent",
    });
    const row = (await db.select().from(schema.orderItems)).find(
      (i) => i.orderId === newOrder.id,
    )!;
    expect(row).toMatchObject({
      unitCostAtOrderTime: "5.0000",
      quantity: "10.000000",
      requestedQuantity: "10.000000",
      receivedQuantity: "0.000000",
    });
    const listing = (await db.select().from(schema.supplierParts))[0]!;
    expect(listing.lastKnownUnitCost).toBeNull();
    const quote = (await db.select().from(schema.quotes))[0]!;
    expect(Number(quote.subtotalMaterials)).toBe(50);
    const extra = (await db.select().from(schema.quoteItems))[0]!;
    expect(extra.sentOrderItemId).toBe(row.id);
    expect(Number(extra.extendedPrice)).toBe(50);
    const product = (await db.select().from(schema.partDefinitions)).find(
      (p) => p.id === row.partDefinitionId,
    )!;
    expect(product.organizationId).toBe(org);
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: orderFingerprint(
        await orderSnapshot(db, access, newOrder.id),
      ),
    });
    expect(
      Number(
        (await db.select().from(schema.orderItems)).find(
          (i) => i.id === row.id,
        )!.receivedQuantity,
      ),
    ).toBe(6);
    await expect(reviewAction(access, doc.documentId, {
      action: "reconstruct", materialListId: null, listName: "Duplicate list",
      orderNumber: "NO-SECOND-RECEIPT", lineIds: ["0"], confirmed: true,
    })).rejects.toThrow("Correct existing receipts");
  });
  it("rejects creating a material part in another organization or an asset catalogue", async () => {
    const { access, doc } = await confirmedHeader();
    await db
      .update(schema.jobs)
      .set({ foremanUserId: "receiver" })
      .where(sql`"id"=${job}`);
    await db.insert(schema.catalogs).values([
      {
        id: id(52),
        organizationId: id(99),
        name: "Foreign",
        kind: "materials",
      },
      { id: id(53), organizationId: org, name: "Tools", kind: "assets" },
    ]);
    const action = {
      action: "part",
      lineId: "0",
      partId: null,
      name: "New elbow",
      description: "",
      unit: "ea",
      piecesPerPack: null,
      individualUnit: "ea",
      photoUrl: null,
    };
    for (const catalogId of [id(52), id(53)])
      await expect(
        reviewAction(access, doc.documentId, { ...action, catalogId }),
      ).rejects.toThrow("catalogue");
  });
  it("accepts an explicitly checked return on a mixed slip without changing the other line type", async () => {
    const { access, doc } = await confirmedHeader();
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      kind: "return-credit",
      description: "Valve return",
      sku: "",
      quantity: 1,
      ordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    });
    await reviewAction(access, doc.documentId, {
      action: "approve",
      lineIds: ["0"],
      fingerprint: await finger(access),
    });
    expect(Number((await item()).receivedQuantity)).toBe(1);
    expect(Number((await item()).creditedQuantity)).toBe(1);
    expect((await workspace()).documents[0]!.receivingReview!.kind).toBe(
      "delivery",
    );
  });
  it("requires explicit adoption and reconfirmation after the source file changes", async () => {
    const { access, doc } = await confirmedHeader();
    const state = await workspace(),
      current = state.documents[0]!;
    current.currentVersionId = id(91);
    current.packingSlipAnalysis!.versionId = id(91);
    state.versions.push({
      ...state.versions[0]!,
      id: id(91),
      sha256: "b".repeat(64),
    });
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("source file changed");
    await reviewAction(access, doc.documentId, {
      action: "adoptSource",
      confirmed: true,
    });
    const review = (await workspace()).documents[0]!.receivingReview!;
    expect(review.versionId).toBe(id(91));
    expect(review.orderConfirmed).toBe(false);
    expect(review.documentChecked).toBe(false);
    expect(review.lines[0]!.sourceBox).toBeUndefined();
    await expect(
      reviewAction(access, doc.documentId, {
        action: "approve",
        lineIds: ["0"],
        fingerprint: await finger(access),
      }),
    ).rejects.toThrow("linked order");
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it("requires explicit pack conversion and lets a reviewer restore an excluded line", async () => {
    const { access, doc } = await confirmedHeader();
    await db
      .update(schema.partDefinitions)
      .set({ piecesPerPack: 50, bulkUnit: "box", individualUnit: "ea" })
      .where(eq(schema.partDefinitions.id, id(5)));
    await expect(
      reviewAction(access, doc.documentId, {
        action: "line",
        lineId: "0",
        description: "Valve",
        sku: "",
        quantity: 50,
        ordered: 10,
        unit: "ea",
        unitPrice: null,
        orderItemId: id(6),
        checked: true,
      }),
    ).rejects.toThrow("Convert packs");
    await reviewAction(access, doc.documentId, {
      action: "ignore",
      lineId: "0",
      reason: "Check this separately",
    });
    await reviewAction(access, doc.documentId, {
      action: "restoreLine",
      lineId: "0",
      reason: "Source is now readable",
    });
    expect(
      (await workspace()).documents[0]!.receivingReview!.lines[0]!.ignored,
    ).toBeUndefined();
    expect(Number((await item()).receivedQuantity)).toBe(2);
  });
  it.each([{packaged:false, conflict:false}, {packaged:true, conflict:false}, {packaged:false, conflict:true}])("adds a likely part with package and supplier-link confirmation (%j)", async ({packaged, conflict}) => {
    const { access, doc } = await confirmedHeader();
    if (packaged) await db.insert(schema.units).values({ id: id(90), code: "length", displayName: "Length", kind: "quantity" });
    await db
      .update(schema.jobs)
      .set({ foremanUserId: "receiver" })
      .where(sql`"id"=${job}`);
    await db.insert(schema.suppliers).values({
      id: id(70),
      organizationId: org,
      name: "Slip Supplier",
      kind: "external",
    });
    await db.insert(schema.quotes).values({
      id: id(71),
      organizationId: org,
      jobId: job,
      materialListId: list,
      createdByUserId: "receiver",
    });
    await db
      .update(schema.materialLists)
      .set({ quoteId: id(71) })
      .where(eq(schema.materialLists.id, list));
    await db
      .update(schema.orders)
      .set({ supplierId: id(70) })
      .where(eq(schema.orders.id, order));
    await db.insert(schema.partDefinitions).values(
      [
        [60, '1/2" Copper 90 Elbow C x C'],
        [61, '3/4" Copper 90 Elbow C x C'],
        [62, '1/2" Copper Coupling'],
      ].map(([n, displayName]) => ({
        id: id(n as number),
        organizationId: org,
        catalogId: id(50),
        displayName: displayName as string,
        bulkUnit: packaged ? "length" : "ea",
        piecesPerPack: packaged ? 12 : null,
        individualUnit: packaged ? "ft" : null,
      })),
    );
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "1/2 CXC 90 ELL WROT",
      sku: "W07002",
      quantity: 4,
      ordered: null,
      unit: packaged ? "EA" : "",
      unitPrice: null,
      orderItemId: null,
      checked: true,
    });
    const foreman = await assertDocumentAccess("receiver", job, db);
    const before = await receivingQueue(foreman, doc.documentId);
    // The 3/4" elbow is a different size, so it is not offered.
    expect(before.likely?.["0"]?.map((p) => p.id)).toEqual([id(60), id(62)]);
    const action = {
      action: "part",
      lineId: "0",
      partId: id(60),
      name: '1/2" Copper 90 Elbow C x C',
      description: "",
      catalogId: id(50),
      unit: packaged ? "length" : "ea",
      piecesPerPack: packaged ? 12 : null,
      individualUnit: packaged ? "ft" : "ea",
      photoUrl: null,
      addToOrder: true,
      packageUnitConfirmed: packaged,
    } as const;
    if (packaged) {
      await expect(reviewAction(access, doc.documentId, { ...action, packageUnitConfirmed: false })).rejects.toThrow(/Confirm whether/);
      await expect(reviewAction(access, doc.documentId, { ...action, piecesPerPack: 20 })).rejects.toThrow(/changed/);
    }
    if (conflict) {
      await db.insert(schema.supplierParts).values({id:id(72), organizationId:org, supplierId:id(70), supplierSku:"W07002", supplierName:"1/2 CXC 90 ELL WROT", partDefinitionId:id(61)});
      await expect(reviewAction(access, doc.documentId, action)).rejects.toMatchObject({
        linkConflict: {supplierPartId:id(72), previousPartId:id(61), replacementPartId:id(60), supplierCode:"W07002"},
      });
      expect((await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,id(72))))[0]!.partDefinitionId).toBe(id(61));
      const approval = {lineId:"0", supplierPartId:id(72), previousPartId:id(61), replacementPartId:id(60), replacementPartName:action.name};
      await expect(reviewAction(access, doc.documentId, {...action, supplierPartLinkApprovals:[{...approval, previousPartId:id(62)}]})).rejects.toMatchObject({code:"CONFLICT"});
      await reviewAction(access, doc.documentId, {...action, supplierPartLinkApprovals:[approval]});
      expect((await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,id(72))))[0]!.partDefinitionId).toBe(id(60));
    } else await reviewAction(access, doc.documentId, action);
    const added = (await db.select().from(schema.orderItems)).find(
      (i) => i.partDefinitionId === id(60),
    )!;
    expect(added).toMatchObject({
      orderId: order,
      quantity: "4.000000",
      requestedQuantity: "0.000000",
      uomId: packaged ? id(90) : id(51),
    });
    expect(
      (await db.select().from(schema.quoteItems)).map((q) => q.sentOrderItemId),
    ).toEqual([added.id]);
    const line = (await workspace()).documents[0]!.receivingReview!.lines[0]!;
    expect(line).toMatchObject({
      orderItemId: added.id,
      partId: id(60),
      unit: packaged ? "length" : "ea",
      ordered: 4,
      quantity: 4,
    });
    // The supplier's code and words now lead to the part on the next slip.
    expect(
      (await db.select().from(schema.supplierParts)).map((l) => [
        l.supplierSku,
        l.supplierName,
      ]),
    ).toEqual([["W07002", "1/2 CXC 90 ELL WROT"]]);
    const after = await receivingQueue(foreman, doc.documentId);
    expect(after.likely?.["0"]).toBeUndefined();
    expect(after.items?.map((i) => i.id)).toContain(added.id);
  });
  it.each([false, true])("adds a new catalogue part with an optional supplier-link conflict (%s)", async (conflict) => {
    const { access, doc } = await confirmedHeader();
    await db
      .update(schema.jobs)
      .set({ foremanUserId: "receiver" })
      .where(sql`"id"=${job}`);
    await db.insert(schema.suppliers).values({
      id: id(70),
      organizationId: org,
      name: "Slip Supplier",
      kind: "external",
    });
    await db.insert(schema.quotes).values({
      id: id(71),
      organizationId: org,
      jobId: job,
      materialListId: list,
      createdByUserId: "receiver",
    });
    await db
      .update(schema.materialLists)
      .set({ quoteId: id(71) })
      .where(eq(schema.materialLists.id, list));
    await db
      .update(schema.orders)
      .set({ supplierId: id(70) })
      .where(eq(schema.orders.id, order));
    await reviewAction(access, doc.documentId, {
      action: "line",
      lineId: "0",
      description: "Brass ball valve 3/4",
      sku: conflict ? "NEW-CODE" : "",
      quantity: 2,
      ordered: 3,
      unit: "ea",
      unitPrice: null,
      orderItemId: null,
      checked: true,
    });
    const action = {
      action: "part",
      lineId: "0",
      partId: null,
      name: 'Brass Ball Valve 3/4"',
      description: "",
      catalogId: id(50),
      unit: "ea",
      piecesPerPack: null,
      individualUnit: "ea",
      photoUrl: null,
      addToOrder: true,
    } as const;
    if (conflict) {
      const previous = (await db.select().from(schema.partDefinitions))[0]!;
      await db.insert(schema.supplierParts).values({id:id(72), organizationId:org, supplierId:id(70), supplierSku:"NEW-CODE", partDefinitionId:previous.id});
      await expect(reviewAction(access, doc.documentId, action)).rejects.toMatchObject({linkConflict:{replacementPartId:null}});
      expect((await db.select().from(schema.partDefinitions)).some(p => p.displayName === action.name)).toBe(false);
      await reviewAction(access, doc.documentId, {...action, supplierPartLinkApprovals:[{lineId:"0",supplierPartId:id(72),previousPartId:previous.id,replacementPartId:null,replacementPartName:action.name}]});
    } else await reviewAction(access, doc.documentId, action);
    const part = (await db.select().from(schema.partDefinitions)).find(
      (p) => p.displayName === 'Brass Ball Valve 3/4"',
    )!;
    expect(part.organizationId).toBe(org);
    const added = (await db.select().from(schema.orderItems)).find(
      (i) => i.partDefinitionId === part.id,
    )!;
    expect(added).toMatchObject({ orderId: order, quantity: "3.000000" });
    // The new part is offered straight away, not after the cache expires.
    const queue = await receivingQueue(access, doc.documentId, "ball valve");
    expect(queue.parts?.map((p) => p.id)).toContain(part.id);
  });
  it("adds nothing when the line already belongs to the order", async () => {
    const { access, doc } = await confirmedHeader();
    await db
      .update(schema.jobs)
      .set({ foremanUserId: "receiver" })
      .where(sql`"id"=${job}`);
    await expect(
      reviewAction(access, doc.documentId, {
        action: "part",
        lineId: "0",
        partId: null,
        name: "Another valve",
        description: "",
        catalogId: id(50),
        unit: "ea",
        piecesPerPack: null,
        individualUnit: "ea",
        photoUrl: null,
        addToOrder: true,
      }),
    ).rejects.toThrow("already belongs");
    expect(
      (await db.select().from(schema.partDefinitions)).map((p) => p.id),
    ).toEqual([id(5)]);
  });
  it("gives an order part the pack size and supplier listing a slip shows", async () => {
    await db.insert(schema.suppliers).values({
      id: id(80),
      organizationId: org,
      name: "Jev",
      kind: "external",
    });
    await db
      .update(schema.orders)
      .set({ supplierId: id(80) })
      .where(eq(schema.orders.id, order));
    await db.insert(schema.units).values({
      id: id(81),
      code: "box",
      displayName: "Box",
      kind: "quantity",
    });
    await db
      .update(schema.orderItems)
      .set({ uomId: id(81) })
      .where(eq(schema.orderItems.id, id(6)));
    const { access, doc } = await confirmedHeader();
    await db
      .update(schema.partDefinitions)
      .set({ imageUrl: "/valve.png" })
      .where(eq(schema.partDefinitions.id, id(5)));
    const facts = (await receivingQueue(access, doc.documentId)).orderParts;
    expect(facts?.[id(6)]).toEqual({
      partId: id(5),
      name: "Valve",
      imageUrl: "/valve.png",
      bulkUnit: null,
      supplierSku: null,
      supplierName: null,
      units: ["box"],
    });
    const line = {
      action: "line",
      lineId: "0",
      description: "HEX NUT GR2 ZC,3/8-16",
      sku: "HN38G2ZB",
      quantity: 1,
      ordered: null,
      unit: "box",
      unitPrice: null,
      orderItemId: id(6),
      checked: true,
    };
    const fit = {
      piecesPerPack: 2500,
      individualUnit: "ea",
      bulkUnit: "box",
      supplierSku: "HN38G2ZB",
      supplierName: "HEX NUT GR2 ZC,3/8-16",
    };
    // A list that counts the part in another unit keeps its pack size as is.
    await db
      .insert(schema.quoteItems)
      .values({ id: id(82), partDefinitionId: id(5), uomId: id(51) } as never);
    await expect(
      reviewAction(access, doc.documentId, { ...line, fit }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.select().from(schema.supplierParts)).length).toBe(0);
    await db.delete(schema.quoteItems).where(eq(schema.quoteItems.id, id(82)));
    // A code another part already uses stays with that part.
    await db.insert(schema.partDefinitions).values({
      id: id(83),
      organizationId: org,
      catalogId: id(50),
      displayName: "Other nut",
    });
    await db.insert(schema.supplierParts).values({
      id: id(84),
      organizationId: org,
      supplierId: id(80),
      partDefinitionId: id(83),
      supplierSku: "HN38G2ZB",
    });
    await expect(
      reviewAction(access, doc.documentId, { ...line, fit }),
    ).rejects.toThrow("already belongs to another part");
    await db
      .delete(schema.supplierParts)
      .where(eq(schema.supplierParts.id, id(84)));
    await reviewAction(access, doc.documentId, {
      ...line,
      fit: { ...fit, alias: "Hex nut 3/8" },
    });
    const part = (await db.select().from(schema.partDefinitions)).find(
      (p) => p.id === id(5),
    )!;
    expect(part).toMatchObject({
      piecesPerPack: 2500,
      individualUnit: "ea",
      bulkUnit: "box",
    });
    expect(await db.select().from(schema.supplierParts)).toMatchObject([
      {
        supplierId: id(80),
        partDefinitionId: id(5),
        supplierSku: "HN38G2ZB",
        supplierName: "HEX NUT GR2 ZC,3/8-16",
      },
    ]);
    expect(
      (await db.select().from(schema.partSynonyms)).map((s) => s.synonym),
    ).toEqual(["Hex nut 3/8"]);
    // The order still counts boxes, now of 2500 pieces.
    expect((await orderSnapshot(db, access, order))[0]).toMatchObject({
      unit: "box",
      piecesPerPack: 2500,
      individualUnit: "ea",
    });
    // Nothing set is overwritten.
    await expect(
      reviewAction(access, doc.documentId, {
        ...line,
        fit: { piecesPerPack: 100 },
      }),
    ).rejects.toThrow("already has a pack size");
    await reviewAction(access, doc.documentId, {
      ...line,
      fit: { supplierSku: "NEW", supplierName: "Other name" },
    });
    expect(await db.select().from(schema.supplierParts)).toMatchObject([
      { supplierSku: "HN38G2ZB", supplierName: "HEX NUT GR2 ZC,3/8-16" },
    ]);
  });

  describe("receiving a trusted supplier's slip without a check", () => {
    const supplier = id(60);
    const saveState = (state: Awaited<ReturnType<typeof workspace>>) =>
      db
        .update(schema.jobDocumentWorkspaces)
        .set({ state })
        .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    /** A slip read surely, nothing received on its order yet. */
    async function sureSlip() {
      await db
        .insert(schema.suppliers)
        .values({ id: supplier, organizationId: org, name: "Wolseley" });
      await db
        .update(schema.orders)
        .set({ supplierId: supplier })
        .where(eq(schema.orders.id, order));
      await db
        .update(schema.orderItems)
        .set({ receivedQuantity: "0", verificationStatus: "pending" })
        .where(eq(schema.orderItems.id, id(6)));
      const fixture = await ready();
      const state = await workspace();
      const doc = state.documents[0]!;
      Object.assign(doc.packingSlipAnalysis!, {
        totalsAgree: true,
        cascade: {
          policy: "test",
          status: "not-needed",
          reasons: [],
          lineIndexes: [],
        },
      });
      doc.packingSlipAnalysis!.lines[0]!.readings = [
        {
          reader: "jev",
          shipped: 6,
          unit: "ea",
          orderItemId: id(6),
          match: 0.97,
          quantity: 0.97,
        },
      ];
      doc.receivingReview!.sourceText = "Wolseley packing slip, order PO-123";
      await saveState(state);
      vi.stubEnv("PACKING_SLIP_AUTOPILOT_ORGANIZATIONS", `other, ${org}`);
      return fixture;
    }
    /** Earlier slips from the supplier, oldest first, received by a person
     * or without a check. */
    let earlier = 0;
    async function received(
      n: number,
      { clean = true, by = "human" }: { clean?: boolean; by?: string } = {},
    ) {
      for (let i = 0; i < n; i++) {
        earlier++;
        const line = {
          id: "0",
          sourceIndex: 0,
          orderItemId: id(6),
          quantity: 6,
          issues: [],
        };
        const quantity = clean ? 6 : 5;
        await db.insert(schema.packingSlipReviewHistory).values({
          organizationId: org,
          jobId: job,
          documentId: id(700 + earlier),
          versionId: id(800 + earlier),
          runId: randomUUID(),
          kind: "confirmation",
          userId: "receiver",
          release: "test",
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, earlier)),
          data: {
            operation: "approve",
            initiator: by,
            packingSlip: { orderId: order },
            before: { kind: "delivery", lines: [line] },
            after: {
              kind: "delivery",
              lines: [
                {
                  ...line,
                  quantity,
                  checked: true,
                  approved: {
                    itemId: id(6),
                    quantity,
                    kind: "delivery",
                    by: "receiver",
                    at: "t",
                  },
                },
              ],
            },
          },
        });
      }
    }
    beforeEach(() => {
      earlier = 0;
    });
    const review = async () =>
      (await workspace()).documents[0]!.receivingReview!;

    it("waits for enough clean slips a person checked", async () => {
      const { access, doc } = await sureSlip();
      await received(CLEAN_RUN, { clean: true });
      await received(1, { clean: false });
      await received(CLEAN_RUN - 1);
      expect(await receiveIfTrusted(access, doc.documentId)).toEqual({
        received: false,
        why: "not trusted yet",
      });
      expect(Number((await item()).receivedQuantity)).toBe(0);
      expect((await review()).humanReviewed).toBeFalsy();
    });

    it("receives every line once, tells the scanner, then undoes it exactly", async () => {
      const { access, doc } = await sureSlip();
      await received(CLEAN_RUN);
      await db.insert(chatPushSubscriptions).values({
        userId: "receiver",
        endpoint: "https://fcm.googleapis.com/fcm/send/test",
        p256dh: "key",
        auth: "auth",
        revokeTokenHash: "a".repeat(64),
      });
      test.push = {
        publicKey: "p",
        privateKey: "k",
        subject: "mailto:x@example.test",
      };
      const ranked = await receivingOrderCandidates(access, doc.documentId);
      expect(ranked[0]).toMatchObject({ orderId: order });
      expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
      expect(await receiveIfTrusted(access, doc.documentId)).toEqual({
        received: true,
      });
      expect(Number((await item()).receivedQuantity)).toBe(6);
      expect((await item()).verificationStatus).toBe("partial");
      const after = await review();
      expect(after.lines[0]!.approved).toMatchObject({
        quantity: 6,
        itemId: id(6),
      });
      expect(after).toMatchObject({
        orderConfirmed: true,
        documentChecked: true,
        supplierId: supplier,
        autopilot: {
          lines: 1,
          trustedAfter: CLEAN_RUN,
          revision: after.revision,
        },
      });
      expect(after.humanReviewed).toBeFalsy();
      // Not twice, even if the worker runs again.
      expect((await receiveIfTrusted(access, doc.documentId)).received).toBe(
        false,
      );
      expect(Number((await item()).receivedQuantity)).toBe(6);
      const confirmations = await db
        .select()
        .from(schema.packingSlipReviewHistory)
        .where(eq(schema.packingSlipReviewHistory.documentId, doc.documentId));
      expect(
        confirmations
          .filter((h) => h.kind === "confirmation")
          .map((h) => (h.data as { initiator: string }).initiator),
      ).toEqual(["autopilot"]);
      expect(test.sendPush).toHaveBeenCalledTimes(1);
      const payload: unknown = JSON.parse(
        test.sendPush.mock.calls[0]![2] as string,
      );
      expect(payload).toMatchObject({
        type: "slip-received",
        url: `/jobs/${job}/receiving?document=${doc.documentId}`,
        title: "PO-123 received from Wolseley",
        body: "1 line, received without a check. Open it to look or undo.",
      });
      const queue = await receivingQueue(access);
      expect(queue.documents[0]).toMatchObject({
        status: "complete",
        receivedAutomatically: true,
      });
      expect((await supplierOutcomes(org, supplier))[0]).toEqual({
        by: "autopilot",
        clean: true,
        undone: false,
      });

      await reviewAction(access, doc.documentId, { action: "undoAutopilot" });
      expect(Number((await item()).receivedQuantity)).toBe(0);
      expect((await item()).verificationStatus).toBe("pending");
      const undone = await review();
      expect(undone.lines[0]!.approved).toBeUndefined();
      expect(undone.lines[0]!.checked).toBe(false);
      expect(undone.orderConfirmed).toBeFalsy();
      expect(undone.documentChecked).toBeFalsy();
      expect(undone.autopilot!.undone).toMatchObject({ by: "receiver" });
      expect(undone.humanReviewed).toBe(true);
      expect(
        (await workspace()).documents[0]!.packingSlipAnalysis!.applied,
      ).toBeUndefined();
      expect((await receivingQueue(access)).documents[0]).toMatchObject({
        status: "review",
        receivedAutomatically: false,
      });
      await expect(
        reviewAction(access, doc.documentId, { action: "undoAutopilot" }),
      ).rejects.toThrow("not received automatically");
      // An undo breaks the supplier's run.
      expect((await supplierOutcomes(org, supplier))[0]).toMatchObject({
        undone: true,
        clean: false,
      });
    });

    it("cannot be undone once the slip has changed since", async () => {
      const { access, doc } = await sureSlip();
      await received(CLEAN_RUN);
      expect((await receiveIfTrusted(access, doc.documentId)).received).toBe(
        true,
      );
      await reviewAction(access, doc.documentId, {
        action: "note",
        lineId: "0",
        note: "Two boxes were wet",
      });
      await expect(
        reviewAction(access, doc.documentId, { action: "undoAutopilot" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(Number((await item()).receivedQuantity)).toBe(6);
    });

    it("leaves every tenth slip, an unsure line or a slip without receiving permission to a person", async () => {
      const { access, doc } = await sureSlip();
      await received(CLEAN_RUN);
      await received(ASK_EVERY - 1, { by: "autopilot" });
      expect(await receiveIfTrusted(access, doc.documentId)).toEqual({
        received: false,
        why: "one in ten is checked",
      });
      await received(1);
      const state = await workspace();
      state.documents[0]!.packingSlipAnalysis!.lines[0]!.readings![0]!.quantity = 0.8;
      await saveState(state);
      expect(await receiveIfTrusted(access, doc.documentId)).toEqual({
        received: false,
        why: "line 0 unsure",
      });
      state.documents[0]!.packingSlipAnalysis!.lines[0]!.readings![0]!.quantity = 0.97;
      await saveState(state);
      test.receive = false;
      expect(await receiveIfTrusted(access, doc.documentId)).toEqual({
        received: false,
        why: "no permission",
      });
      test.receive = true;
      vi.stubEnv("PACKING_SLIP_AUTOPILOT_ORGANIZATIONS", "");
      expect((await receiveIfTrusted(access, doc.documentId)).why).toBe("off");
      expect(Number((await item()).receivedQuantity)).toBe(0);
    });

    it("is tried by the reader after drafting, and says why not", async () => {
      vi.stubEnv("PACKING_SLIP_AUTOPILOT_ORGANIZATIONS", org);
      const info = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      try {
        await ready();
        expect(info).toHaveBeenCalledWith(
          expect.stringMatching(/^Slip not received automatically: /),
        );
      } finally {
        info.mockRestore();
      }
      expect(Number((await item()).receivedQuantity)).toBe(2);
    });
  });
});
