// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const connection = postgres({
    host: process.env.PURCHASE_TEST_SOCKET ?? "/tmp/no-purchase-db",
    port: 55461,
    database: "purchase_integration",
    max: 2,
  });
  return { db: drizzle(connection, { schema }), __testConnection: connection };
});
vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
vi.mock("~/server/auth/permissions", () => ({
  assertCan: vi.fn(),
  userCan: () => true,
}));
vi.mock("~/server/material-list-events", () => ({
  publishMaterialListEvent: vi.fn(),
  publishOrganizationReplicachePoke: vi.fn(),
}));
vi.mock("~/server/orders/delivery-calendar", () => ({
  userDeliveryDate: async () => "2026-10-12",
}));
import { db } from "~/server/db";
import { prefabsRouter } from "~/server/api/routers/prefabs";
import { materialListRouter } from "~/server/api/routers/materialList";
import { supplierRouter } from "~/server/api/routers/supplier";
import { recalculatePurchaseTotals, orderMultipleInput } from "./purchasing";

const socket = process.env.PURCHASE_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-purchase-db",
  port: 55461,
  database: "purchase_integration",
  max: 1,
});
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1),
  job = id(2),
  supplier = id(3),
  part = id(4),
  sp = id(5),
  list = id(6),
  quote = id(7),
  item = id(8);
const context = {
  db,
  userId: "worker",
  user: { id: "worker", organizationId: org, name: "Worker" },
};
const material = materialListRouter.createCaller(context as never);
const suppliers = supplierRouter.createCaller(context as never);
const tables = [
  schema.organizations,
  schema.users,
  schema.locations,
  schema.jobs,
  schema.materialLists,
  schema.quotes,
  schema.quoteItems,
  schema.materials,
  schema.units,
  schema.partDefinitions,
  schema.supplierParts,
  schema.suppliers,
  schema.orders,
  schema.orderItems,
  schema.jobRooms,
  schema.materialPrefabs,
  schema.materialPrefabItems,
];

describe.skipIf(!socket)(
  "required vs ordered quantities with isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      if (!socket?.startsWith("/tmp/foremanhq-purchase-pg."))
        throw Error("Refusing a non-isolated database");
      if (
        (await conn`select current_database() as name`)[0]?.name !==
        "purchase_integration"
      )
        throw Error("Unexpected database");
      for (const table of tables) {
        const columns = Object.values(getTableColumns(table as PgTable)).map(
          (column) => `"${column.name}" ${column.getSQLType()}`,
        );
        await conn.unsafe(
          `CREATE TABLE IF NOT EXISTS "${getTableName(table)}" (${columns.join(",")}, PRIMARY KEY ("id"))`,
        );
      }
      await conn`CREATE UNIQUE INDEX IF NOT EXISTS prefab_item_unique ON kublai_material_prefab_item ("prefabId", "partDefinitionId")`;
      const migration = await readFile(
        new URL(
          "../../drizzle/0065_order_requested_quantity.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await conn.unsafe(migration);
      await conn.unsafe(migration);
    });
    beforeEach(async () => {
      await conn.unsafe(
        `TRUNCATE ${tables.map((table) => `"${getTableName(table)}"`).join(",")}`,
      );
      await db
        .insert(schema.organizations)
        .values({ id: org, name: "Synthetic company" });
      await db.insert(schema.users).values({
        id: "worker",
        organizationId: org,
        name: "Worker",
        email: "worker@example.test",
      });
      await db.insert(schema.jobs).values({
        id: job,
        organizationId: org,
        name: "Synthetic job",
        poNumber: "PO-TEST",
      });
      await db.insert(schema.suppliers).values({
        id: supplier,
        organizationId: org,
        name: "Synthetic supplier",
        contactEmail: "supplier@example.test",
      });
      await db.insert(schema.partDefinitions).values({
        id: part,
        organizationId: org,
        displayName: '1/2" PEX pipe clip',
        catalogId: id(9),
      });
      await db.insert(schema.supplierParts).values({
        id: sp,
        organizationId: org,
        supplierId: supplier,
        partDefinitionId: part,
        packSize: "25",
        lastKnownUnitCost: "2",
      });
      await db.insert(schema.materialLists).values({
        id: list,
        organizationId: org,
        jobId: job,
        name: "Test list",
        quoteId: quote,
      });
      await db.insert(schema.quotes).values({
        id: quote,
        organizationId: org,
        materialListId: list,
        jobId: job,
        markupPercent: "30",
      });
      await db.insert(schema.quoteItems).values({
        id: item,
        quoteId: quote,
        partDefinitionId: part,
        supplierPartId: sp,
        supplierId: supplier,
        quantity: "37",
        unitCost: "2",
        extendedPrice: "74",
      });
    });
    afterAll(async () => {
      await conn.end();
      const databaseModule = (await import("~/server/db")) as unknown as {
        __testConnection: postgres.Sql;
      };
      await databaseModule.__testConnection.end();
    });
    it("shows 37 required but charges 50, including markup", async () => {
      await recalculatePurchaseTotals(db, quote);
      const detail = await material.getMaterialList({ materialListId: list });
      expect(detail.items[0]).toMatchObject({
        quantity: "37.000000",
        extendedPrice: "100",
        supplierPart: { packSize: "25.000000" },
      });
      expect(detail.materialTotal).toBe(100);
      const saved = await material.generateQuote({
        materialListId: list,
        markupPercent: 30,
      });
      expect(Number(saved!.total)).toBe(130);
      const email = await material.getQuoteEmailContent({ quoteId: quote });
      expect(email.body).toContain("37 (50)");
      expect(email.body).toContain("$130.00");
    });
    it("keeps material lists and supplier orders out of quote history", async () => {
      expect(await material.listQuotes()).toEqual([]);
      expect(
        await material.getQuotesForMaterialList({ materialListId: list }),
      ).toEqual([]);
      await material.previewOrders({ materialListId: list });
      await material.sendGeneratedOrder({
        materialListId: list,
        supplierId: supplier,
        sentTo: "supplier@example.test",
      });
      expect(await material.listQuotes()).toEqual([]);
      expect(
        await material.getQuotesForMaterialList({ materialListId: list }),
      ).toEqual([]);
      expect(
        (await material.getMaterialList({ materialListId: list })).items,
      ).toHaveLength(1);
    });
    it("preserves legacy history once and never restores cleared quotes on migration retry", async () => {
      await conn.unsafe('ALTER TABLE "kublai_quote" DROP COLUMN "generatedAt"');
      const migration = await readFile(
        new URL(
          "../../drizzle/0069_quote_document_history.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await conn.unsafe(migration);
      expect(await material.listQuotes()).toMatchObject([{ id: quote }]);
      await db
        .update(schema.quotes)
        .set({ generatedAt: null })
        .where(sql`${schema.quotes}."id" = ${quote}`);
      await conn.unsafe(migration);
      expect(await material.listQuotes()).toEqual([]);
    });
    it("saves only explicitly generated quotes and allows clearing history without losing items", async () => {
      await material.generateQuote({ materialListId: list, markupPercent: 30 });
      expect(await material.listQuotes()).toMatchObject([{ id: quote }]);
      expect(
        await material.getQuotesForMaterialList({ materialListId: list }),
      ).toMatchObject([{ id: quote }]);
      await db
        .update(schema.quotes)
        .set({ generatedAt: null })
        .where(sql`${schema.quotes}."id" = ${quote}`);
      expect(await material.listQuotes()).toEqual([]);
      expect(
        (await material.getMaterialList({ materialListId: list })).items,
      ).toHaveLength(1);
      await material.generateQuote({
        materialListId: list,
        quoteId: quote,
        markupPercent: 10,
      });
      expect(await material.listQuotes()).toMatchObject([{ id: quote }]);
    });
    it("uses 50 in the supplier email and persists both amounts on the sent order", async () => {
      const preview = await material.previewOrders({ materialListId: list });
      expect(preview.possible[0]?.items[0]).toMatchObject({
        quantity: "50",
        requestedQuantity: "37.000000",
      });
      expect(preview.possible[0]?.email.body).toContain(
        '50 - 1/2" PEX pipe clip',
      );
      const sent = await material.sendGeneratedOrder({
        materialListId: list,
        supplierId: supplier,
        sentTo: "supplier@example.test",
      });
      const [line] = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, sent.id));
      expect(Number(line!.quantity)).toBe(50);
      expect(Number(line!.requestedQuantity)).toBe(37);
      expect(Number(line!.orderMultipleSnapshot)).toBe(25);
      const required = (
        await db
          .select()
          .from(schema.quoteItems)
          .where(eq(schema.quoteItems.id, item))
      )[0];
      expect(Number(required!.quantity)).toBe(37);
      expect(
        (await material.getOrderEmailContent({ orderId: sent.id })).body,
      ).toContain('50 - 1/2" PEX pipe clip');
      expect(
        Number(
          (await material.getOrderById({ orderId: sent.id })).items[0]
            ?.quantity,
        ),
      ).toBe(50);
    });
    it("recalculates active lists after a rule edit but preserves historical orders", async () => {
      const sent = await material.sendGeneratedOrder({
        materialListId: list,
        supplierId: supplier,
        sentTo: "supplier@example.test",
      });
      await suppliers.updateSupplierPart({ id: sp, packSize: "20" });
      const detail = await material.getMaterialList({ materialListId: list });
      expect(detail.materialTotal).toBe(100);
      expect(Number(detail.items[0]?.quantity)).toBe(37);
      const [old] = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, sent.id));
      expect(Number(old!.quantity)).toBe(50);
      expect(Number(old!.orderMultipleSnapshot)).toBe(25);
      expect(
        (await material.previewOrders({ materialListId: list })).possible[0]
          ?.items[0]?.quantity,
      ).toBeUndefined();
    });
    it("links sent rows, excludes them from new orders and duplicates into editable rows", async () => {
      const sent = await material.sendGeneratedOrder({ materialListId: list, supplierId: supplier, sentTo: "supplier@example.test" });
      const [locked] = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.id, item));
      const [orderItem] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, sent.id));
      expect(locked!.sentOrderItemId).toBe(orderItem!.id);
      expect((await material.previewOrders({ materialListId: list })).possible).toEqual([]);
      await expect(material.sendGeneratedOrder({ materialListId: list, supplierId: supplier, sentTo: "supplier@example.test" })).rejects.toThrow("No unsent items");
      await material.updateOrderItemVerification({ orderItemId: orderItem!.id, receivedQuantity: 20, verificationStatus: "partial" });
      const copy = await material.duplicate({ materialListId: list });
      const [newList] = await db.select().from(schema.materialLists).where(eq(schema.materialLists.id, copy.id));
      const [newItem] = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId, newList!.quoteId!));
      expect(newItem!.sentOrderItemId).toBeNull();
      expect(newItem!.id).not.toBe(item);
      expect(Number(newItem!.quantity)).toBe(37);
      expect((await material.previewOrders({ materialListId: copy.id })).possible).toHaveLength(1);
      expect(Number((await material.getOrderById({orderId:sent.id})).items[0]!.receivedQuantity)).toBe(20);
    });
    it("links only unambiguous historical rows and preserves receipt history", async () => {
      const sent = await material.sendGeneratedOrder({ materialListId:list, supplierId:supplier, sentTo:"supplier@example.test" });
      await db.update(schema.quoteItems).set({sentOrderItemId:null, updatedAt:new Date("2020-01-01")}).where(eq(schema.quoteItems.id,item));
      const migration = await readFile(new URL("../../drizzle/0073_material_list_sent_links.sql", import.meta.url), "utf8");
      await conn.unsafe(migration);
      const [linked] = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.id,item));
      expect(linked!.sentOrderItemId).toBe((await material.getOrderById({orderId:sent.id})).items[0]!.id);
      await conn.unsafe(migration);
      expect((await material.previewOrders({materialListId:list})).possible).toEqual([]);
    });
    it("sends newly added rows without resending the already locked rows", async () => {
      await material.sendGeneratedOrder({ materialListId:list, supplierId:supplier, sentTo:"supplier@example.test" });
      await db.insert(schema.quoteItems).values({id:id(90),quoteId:quote,partDefinitionId:part,supplierPartId:sp,supplierId:supplier,quantity:"3",unitCost:"2"});
      const preview = await material.previewOrders({materialListId:list});
      expect(preview.possible[0]!.items).toHaveLength(1);
      expect(preview.possible[0]!.items[0]!.requestedQuantity).toBe("3.000000");
      const second = await material.sendGeneratedOrder({ materialListId:list, supplierId:supplier, sentTo:"supplier@example.test" });
      expect((await material.getOrderById({orderId:second.id})).items).toHaveLength(1);
      expect(await db.select().from(schema.orderItems)).toHaveLength(2);
    });
    it("serializes simultaneous sends so a row is ordered once", async () => {
      const results = await Promise.allSettled([1, 2].map(() => material.sendGeneratedOrder({ materialListId: list, supplierId: supplier, sentTo: "supplier@example.test" })));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(await db.select().from(schema.orderItems)).toHaveLength(1);
    });
    it("orders whole packs at pack prices while retaining the exact piece requirement", async () => {
      await db.update(schema.partDefinitions).set({ piecesPerPack: 50, bulkUnit:"box", individualUnit:"pcs" }).where(eq(schema.partDefinitions.id, part));
      await db.update(schema.supplierParts).set({ packSize: null, lastKnownUnitCost: "25" }).where(eq(schema.supplierParts.id, sp));
      await db.update(schema.quoteItems).set({ quantity: "1.4", unitCost: "25" }).where(eq(schema.quoteItems.id, item));
      await recalculatePurchaseTotals(db, quote);
      const detail = await material.getMaterialList({ materialListId: list });
      expect(detail.items[0]).toMatchObject({quantity: "1.400000", extendedPrice: "50", partDefinition: { piecesPerPack: 50 }});
      const preview = await material.previewOrders({materialListId: list});
      expect(preview.possible[0]?.items[0]).toMatchObject({quantity:"2",requestedQuantity:"1.400000"});
      expect(preview.possible[0]?.email.body).toContain("2 boxes (100 pcs)");
      const sent = await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"});
      const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId,sent.id));
      expect(Number(line!.quantity)).toBe(2);
      expect(Number(line!.requestedQuantity)).toBe(1.4);
      expect(Number(line!.unitCostAtOrderTime)).toBe(25);
      expect((await material.getOrderEmailContent({orderId:sent.id})).body).toContain("2 boxes (100 pcs)");
      expect((await material.getQuoteEmailContent({quoteId:quote})).body).toContain("2 boxes (100 pcs)");
    });
    it("preserves single-piece requirements when merging saved prefabs", async () => {
      await db.update(schema.partDefinitions).set({piecesPerPack: 3000}).where(eq(schema.partDefinitions.id, part));
      const caller = prefabsRouter.createCaller(context as never);
      const prefab = await caller.create({name: "Test", items: [{partDefinitionId:part,quantity: .000333}]});
      await caller.addItems({prefabId:prefab.id,items:[{partDefinitionId:part,quantity:.000333}]});
      const [line] = await db.select().from(schema.materialPrefabItems).where(eq(schema.materialPrefabItems.prefabId,prefab.id));
      expect(Number(line!.quantity)).toBe(.000667);
    });
    it("rejects zero, negatives, malformed and excessive precision rules", () => {
      for (const value of ["0", "-25", "25abc", "NaN", "1000000", "0.0000001"])
        expect(orderMultipleInput.safeParse(value).success).toBe(false);
      for (const value of ["1", "25", "50", "0.25"])
        expect(orderMultipleInput.safeParse(value).success).toBe(true);
    });
  },
);
