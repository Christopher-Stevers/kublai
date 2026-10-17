import { readSupplierEmailPreference, saveSupplierEmailPreference } from "~/server/supplier-email-preferences";
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
const supplierAccess = vi.hoisted(() => ({ financial: true }));
vi.mock("~/server/auth/permissions", () => ({
  assertCan: vi.fn(),
  assertCanAccessTab: vi.fn(),
  assertCanManageAssets: vi.fn(),
  getUserPermissions: () => ({ canManageAssets: true }),
  userCan: (_user: unknown, permission: string) => permission !== "financial.view" || supplierAccess.financial,
}));
vi.mock("~/server/material-list-events", () => ({
  publishMaterialListEvent: vi.fn(),
  publishOrganizationReplicachePoke: vi.fn(),
  publishOrganizationCatalogueEvent: vi.fn(),
}));
vi.mock("~/server/orders/delivery-calendar", () => ({
  userDeliveryDate: async () => "2026-10-12",
}));
import { db } from "~/server/db";
import { prefabsRouter } from "~/server/api/routers/prefabs";
import { materialListRouter } from "~/server/api/routers/materialList";
import { assetsRouter } from "~/server/api/routers/assets";
import { jobPricingRouter } from "~/server/api/routers/jobPricing";
import { supplierRouter } from "~/server/api/routers/supplier";
import { catalogueRouter } from "~/server/api/routers/catalogue";
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
  schema.materialListSyncTombstones,
  schema.quotes,
  schema.quoteItems,
  schema.catalogs,
  schema.categories,
  schema.sizes,
  schema.partSynonyms,
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
      await conn`CREATE UNIQUE INDEX IF NOT EXISTS supplier_sku_unique ON kublai_supplier_part ("organizationId", "supplierId", "supplierSku")`;
      await conn`CREATE UNIQUE INDEX IF NOT EXISTS prefab_item_unique ON kublai_material_prefab_item ("prefabId", "partDefinitionId")`;
      await conn`CREATE UNIQUE INDEX tombstone_entity_unique ON kublai_material_list_sync_tombstone ("organizationId", "entityType", "entityId")`;
      const migration = await readFile(
        new URL(
          "../../drizzle/0065_order_requested_quantity.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await conn.unsafe(migration);
      await conn.unsafe(migration);
      await conn.unsafe(await readFile(new URL("../../drizzle/0074_job_pricing.sql",import.meta.url),"utf8"));
      await conn.unsafe(await readFile(new URL("../../drizzle/0077_supplier_email_preferences.sql",import.meta.url),"utf8"));
    });
    beforeEach(async () => {
      supplierAccess.financial = true;
      await conn.unsafe(
        `TRUNCATE kublai_supplier_email_preference, kublai_job_pricing_audit, kublai_job_order_approval, kublai_job_price_entry, kublai_job_price_list, ${tables.map((table) => `"${getTableName(table)}"`).join(",")}`,
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
    it("sends a tool list into the Asset Management queue without a supplier email", async () => {
      await db.update(schema.materialLists).set({ kind: "tools" }).where(eq(schema.materialLists.id, list));
      await db.update(schema.quoteItems).set({ supplierId: null, supplierPartId: null, quantity: "2", unitCost: null }).where(eq(schema.quoteItems.id, item));
      const preview = await material.previewOrders({ materialListId: list });
      expect(preview.listKind).toBe("tools");
      expect(preview.possible).toHaveLength(1);
      const supplierId = preview.possible[0]!.supplierId;
      expect(supplierId).toBeTruthy();
      const sent = await material.sendGeneratedOrder({ materialListId: list, supplierId, sentTo: "Tool room", notes: "Needed tomorrow" });
      expect(sent).toMatchObject({ kind: "tool_request", status: "sent", fulfillmentStatus: "open", sentVia: "tool_room", materialListId: list, createdByUserId: "worker" });
      const requests = await assetsRouter.createCaller(context as never).listRequests({ status: "open" });
      expect(requests).toEqual([expect.objectContaining({ id: sent.id, jobId: job, materialListId: list, totalQuantity: 2, notes: "Needed tomorrow" })]);
      const after = await material.previewOrders({ materialListId: list });
      expect(after.possible).toHaveLength(0);
      expect(after.sent).toEqual([expect.objectContaining({ id: sent.id })]);
      const [locked] = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.id, item));
      const [sentLine] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, sent.id));
      expect(locked!.sentOrderItemId).toBe(sentLine!.id);
      const copy = await material.duplicate({ materialListId: list });
      expect((await material.previewOrders({ materialListId: copy.id })).possible).toHaveLength(1);
      await db.insert(schema.quoteItems).values({ id: id(998), quoteId: quote, partDefinitionId: part, quantity: "1" });
      const added = await material.previewOrders({ materialListId: list });
      expect(Number(added.possible[0]!.items[0]!.quantity)).toBe(1);
      await material.sendGeneratedOrder({ materialListId: list, supplierId, sentTo: "Tool room" });
      expect((await material.previewOrders({ materialListId: list })).possible).toHaveLength(0);

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
      expect(preview.possible[0]?.email!.body).toContain(
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
    it("filters supplier wizard facets and searches supplier SKUs without leaking other suppliers", async () => {
      const catalogue = catalogueRouter.createCaller(context as never);
      await db.insert(schema.catalogs).values({id:id(9),organizationId:org,name:"Plumbing",kind:"materials",sortOrder:0});
      await db.update(schema.partDefinitions).set({isActive:true}).where(eq(schema.partDefinitions.id,part));
      await db.update(schema.supplierParts).set({supplierSku:"NX-CLIP",supplierName:"Vendor pipe bracket"}).where(eq(schema.supplierParts.id,sp));
      const otherPart=id(901), otherSupplier=id(902), otherOrg=id(903);
      await db.insert(schema.suppliers).values({id:otherSupplier,organizationId:org,name:"Other vendor"});
      await db.insert(schema.partDefinitions).values({id:otherPart,organizationId:org,catalogId:id(9),displayName:"Other pipe",isActive:true});
      await db.insert(schema.supplierParts).values({id:id(904),organizationId:org,supplierId:otherSupplier,partDefinitionId:otherPart,supplierSku:"NX-OTHER"});
      // Duplicate listings do not double-count a physical catalogue part.
      await db.insert(schema.supplierParts).values({id:id(905),organizationId:org,supplierId:supplier,partDefinitionId:part,supplierSku:"NX-CLIP-ALT"});
      // A foreign-organization listing cannot pull our part into this supplier.
      await db.insert(schema.supplierParts).values({id:id(906),organizationId:otherOrg,supplierId:supplier,partDefinitionId:otherPart,supplierSku:"NX-FOREIGN"});
      const summary=await catalogue.getPartWizardSummary({grouped:true,supplierId:supplier});
      expect(summary.partCount).toBe(1);
      expect((await catalogue.searchParts({supplierId:supplier})).map(p=>p.id)).toEqual([part]);
      expect((await catalogue.searchParts({supplierId:supplier,query:"NX-CLIP"})).map(p=>p.id)).toEqual([part]);
      expect((await catalogue.searchParts({supplierId:supplier,query:"Vendor pipe bracket"})).map(p=>p.id)).toEqual([part]);
      expect(await catalogue.searchParts({supplierId:supplier,query:"NX-OTHER"})).toEqual([]);
      expect((await catalogue.searchParts({})).map(p=>p.id).sort()).toEqual([part,otherPart].sort());
      expect((await catalogue.getPartWizardSummary({grouped:true,supplierId:otherSupplier})).partCount).toBe(1);
      expect((await suppliers.getById({id:supplier,partDefinitionIds:[part]})).supplierParts.map(p=>p.id).sort()).toEqual([sp,id(905)].sort());
      expect((await suppliers.getById({id:supplier,partDefinitionIds:[otherPart]})).supplierParts).toEqual([]);
      expect((await suppliers.getById({id:otherSupplier,partDefinitionIds:[otherPart]})).supplierParts.map(p=>p.id)).toEqual([id(904)]);
      await expect(suppliers.getById({id:supplier,partDefinitionIds:[]})).rejects.toMatchObject({code:"BAD_REQUEST"});
      await expect(suppliers.getById({id:supplier,partDefinitionIds:Array(202).fill(part)})).rejects.toMatchObject({code:"BAD_REQUEST"});
    });
    it("saves and clears supplier metadata without changing the shared part or another organization", async () => {
      const otherOrg=id(920), foreign=id(921);
      await db.insert(schema.suppliers).values({id:id(922),organizationId:otherOrg,name:"Private vendor"});
      await db.insert(schema.supplierParts).values({id:foreign,organizationId:otherOrg,supplierId:id(922),partDefinitionId:part,supplierSku:"PRIVATE",isPreferred:true});
      expect((await suppliers.list()).map(item=>item.id)).toEqual([supplier]);
      await suppliers.updateSupplierPart({id:sp,supplierSku:"NEW",supplierName:"New supplier description",lastKnownUnitCost:"12.3456",currency:"CAD",packUomId:null,notes:"Order by phone",isPreferred:true});
      const detail=await suppliers.getById({id:supplier});
      expect(detail.supplierParts[0]).toMatchObject({supplierSku:"NEW",supplierName:"New supplier description",lastKnownUnitCost:"12.3456",notes:"Order by phone"});
      const [core]=await db.select().from(schema.partDefinitions).where(eq(schema.partDefinitions.id,part));
      expect(core!.displayName).toBe('1/2" PEX pipe clip');
      expect((await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,foreign)))[0]!.isPreferred).toBe(true);
      await expect(suppliers.updateSupplierPart({id:foreign,supplierSku:"HACK"})).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(suppliers.updateSupplierPart({id:sp,lastKnownUnitCost:"-5"})).rejects.toMatchObject({code:"BAD_REQUEST"});
      await suppliers.updateSupplierPart({id:sp,supplierSku:"",lastKnownUnitCost:null,packUomId:null});
      expect((await suppliers.getById({id:supplier})).supplierParts[0]).toMatchObject({supplierSku:null,lastKnownUnitCost:null,packUomId:null});
    });
    it("keeps prices and currency unchanged without financial permission",async()=>{
      await db.update(schema.supplierParts).set({currency:"CAD"}).where(eq(schema.supplierParts.id,sp));
      supplierAccess.financial=false;
      await suppliers.updateSupplierPart({id:sp,supplierName:"Allowed description edit",lastKnownUnitCost:"999",currency:"USD"});
      const [row]=await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,sp));
      expect(row).toMatchObject({supplierName:"Allowed description edit",lastKnownUnitCost:"2.0000",currency:"CAD"});
    });
    it("rolls back preferred supplier changes when a SKU conflicts",async()=>{
      await db.update(schema.supplierParts).set({supplierSku:"TAKEN",isPreferred:true}).where(eq(schema.supplierParts.id,sp));
      await db.insert(schema.supplierParts).values({id:id(930),organizationId:org,supplierId:supplier,partDefinitionId:part,supplierSku:"OTHER",isPreferred:false});
      await expect(suppliers.updateSupplierPart({id:id(930),supplierSku:"TAKEN",isPreferred:true})).rejects.toMatchObject({code:"CONFLICT"});
      expect((await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,sp)))[0]!.isPreferred).toBe(true);
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
    it("marks every order line received without changing purchased quantities or other orders", async () => {
      const sent = await material.sendGeneratedOrder({ materialListId: list, supplierId: supplier, sentTo: "supplier@example.test" });
      const [first] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, sent.id));
      await db.update(schema.orderItems).set({ receivedQuantity: "20", verificationStatus: "partial" }).where(eq(schema.orderItems.id, first!.id));
      await db.insert(schema.orderItems).values({ ...first!, id: id(800), quantity: "3.5", receivedQuantity: "0", verificationStatus: "problem" });
      const copy = await material.duplicate({ materialListId: list });
      const another = await material.sendGeneratedOrder({ materialListId: copy.id, supplierId: supplier, sentTo: "supplier@example.test" });
      expect((await material.markAllOrderItemsReceived({ orderId: sent.id })).count).toBe(2);
      const received = await material.getOrderById({ orderId: sent.id });
      expect(received.items.every(line => line.receivedQuantity === line.quantity && line.verificationStatus === "complete")).toBe(true);
      expect(Number(received.items.find(line => line.id === first!.id)!.quantity)).toBe(50);
      expect(Number((await material.getOrderById({ orderId: another.id })).items[0]!.receivedQuantity)).toBe(0);
      await material.markAllOrderItemsReceived({ orderId: sent.id });
      await material.markAllOrderItemsReceived({ orderId: sent.id, allReceived: false });
      const cleared = await material.getOrderById({ orderId: sent.id });
      expect(cleared.items.every(line => Number(line.receivedQuantity) === 0 && line.verificationStatus === "pending")).toBe(true);
      expect(Number(cleared.items.find(line => line.id === first!.id)!.quantity)).toBe(50);
      const foreign = materialListRouter.createCaller({ ...context, user: { ...context.user, organizationId: id(999) } } as never);
      await expect(foreign.markAllOrderItemsReceived({ orderId: sent.id })).rejects.toThrow("Order not found");
      await db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, sent.id));
      await expect(material.markAllOrderItemsReceived({ orderId: sent.id })).rejects.toThrow("Cancelled orders");
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
    it("merges only unlocked rows and preserves both lists' sent links", async () => {
      const target = await material.duplicate({materialListId:list});
      const sourceOrder = await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"test@example.test"});
      await material.sendGeneratedOrder({materialListId:target.id,supplierId:supplier,sentTo:"test@example.test"});
      await db.insert(schema.quoteItems).values({id:id(91),quoteId:quote,partDefinitionId:part,supplierId:supplier,supplierPartId:sp,quantity:"3",unitCost:"2",notes:"Keep this note"});
      const merged = await material.merge({sourceId:list,targetId:target.id});
      expect(merged).toEqual({id:target.id,movedCount:1,sourceDeleted:false});
      const [targetList] = await db.select().from(schema.materialLists).where(eq(schema.materialLists.id,target.id));
      const sourceRows = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId,quote));
      const targetRows = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId,targetList!.quoteId!));
      expect(sourceRows).toHaveLength(1);
      expect(sourceRows[0]!.sentOrderItemId).toBeTruthy();
      expect(targetRows).toHaveLength(2);
      expect(targetRows.find(row => row.id === id(91))).toMatchObject({quantity:"3.000000",notes:"Keep this note",sentOrderItemId:null});
      expect((await material.getOrderById({orderId:sourceOrder.id})).items).toHaveLength(1);
      await expect(material.merge({sourceId:list,targetId:target.id})).rejects.toThrow("no unlocked items");
    });
    it("removes the emptied source and syncs its deletion without losing moved items", async () => {
      const target = await material.duplicate({materialListId:list});
      const result = await material.merge({sourceId:list,targetId:target.id});
      expect(result).toEqual({id:target.id,movedCount:1,sourceDeleted:true});
      expect(await db.select().from(schema.materialLists).where(eq(schema.materialLists.id,list))).toHaveLength(0);
      expect(await db.select().from(schema.quotes).where(eq(schema.quotes.id,quote))).toHaveLength(0);
      const [destination] = await db.select().from(schema.materialLists).where(eq(schema.materialLists.id,target.id));
      expect(await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId,destination!.quoteId!))).toHaveLength(2);
      const tombstones = await db.select().from(schema.materialListSyncTombstones).where(eq(schema.materialListSyncTombstones.entityId,list));
      expect(tombstones).toHaveLength(1);
      expect(tombstones[0]!.entityType).toBe("materialList");
    });
    it("rejects self-merges, foreign lists and another job", async () => {
      await expect(material.merge({sourceId:list,targetId:list})).rejects.toThrow("another material list");
      await expect(material.merge({sourceId:list,targetId:id(999)})).rejects.toThrow("not found");
      const target = await material.duplicate({materialListId:list});
      await db.insert(schema.jobs).values({id:id(92),organizationId:org,name:"Other job"});
      await db.update(schema.materialLists).set({jobId:id(92)}).where(eq(schema.materialLists.id,target.id));
      await expect(material.merge({sourceId:list,targetId:target.id})).rejects.toThrow("same job");
      await db.update(schema.materialLists).set({organizationId:id(999)}).where(eq(schema.materialLists.id,target.id));
      await expect(material.merge({sourceId:list,targetId:target.id})).rejects.toThrow("not found");
    });
    it("undoes an order completely, clears receipts and makes its original demand orderable", async () => {
      const sent = await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"test@example.test"});
      const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId,sent.id));
      await material.updateOrderItemVerification({orderItemId:line!.id,receivedQuantity:20,verificationStatus:"partial"});
      await material.undoOrder({orderId:sent.id});
      expect(await db.select().from(schema.orders)).toHaveLength(0);
      expect(await db.select().from(schema.orderItems)).toHaveLength(0);
      const [editable] = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.id,item));
      expect(editable).toMatchObject({sentOrderItemId:null,quantity:"37.000000"});
      const preview = await material.previewOrders({materialListId:list});
      expect(preview.sent).toHaveLength(0);
      expect(preview.possible[0]!.items).toHaveLength(1);
      expect(await material.listOrders()).toHaveLength(0);
      await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"test@example.test"});
      expect(await db.select().from(schema.orders)).toHaveLength(1);
    });
    it("undo only unlocks its own rows and does not reuse another order's number", async () => {
      const first = await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"test@example.test"});
      const copy = await material.duplicate({materialListId:list});
      const second = await material.sendGeneratedOrder({materialListId:copy.id,supplierId:supplier,sentTo:"test@example.test"});
      await material.undoOrder({orderId:first.id});
      expect((await material.previewOrders({materialListId:copy.id})).possible).toHaveLength(0);
      const third = await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"test@example.test"});
      expect(third.orderNumber).toBe("ORDER-003");
      expect((await material.getOrderById({orderId:second.id})).items).toHaveLength(1);
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
      expect(preview.possible[0]?.email!.body).toContain("2 boxes (100 pcs)");
      const sent = await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"});
      const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId,sent.id));
      expect(Number(line!.quantity)).toBe(2);
      expect(Number(line!.requestedQuantity)).toBe(1.4);
      expect(Number(line!.unitCostAtOrderTime)).toBe(25);
      expect((await material.getOrderEmailContent({orderId:sent.id})).body).toContain("2 boxes (100 pcs)");
      expect((await material.getQuoteEmailContent({quoteId:quote})).body).toContain("2 boxes (100 pcs)");
    });
    it("separates tool prefabs and rejects mixed contents", async () => {
      const caller = prefabsRouter.createCaller(context as never);
      const tool = id(901);
      await db.insert(schema.catalogs).values({id:id(902),organizationId:org,name:"Tools",kind:"assets"});
      await db.insert(schema.partDefinitions).values({id:tool,organizationId:org,catalogId:id(902),displayName:"Drill"});
      const tools = await caller.create({name:"Tool kit",kind:"tools",items:[{partDefinitionId:tool,quantity:2}]});
      const materials = await caller.create({name:"Material kit",kind:"materials",items:[{partDefinitionId:part,quantity:3}]});
      expect((await caller.list({kind:"tools"})).map(p=>p.id)).toEqual([tools.id]);
      expect((await caller.list({kind:"materials"})).map(p=>p.id)).toEqual([materials.id]);
      await expect(caller.addItems({prefabId:tools.id,items:[{partDefinitionId:part,quantity:1}]})).rejects.toThrow("only contain");
      await expect(caller.addItems({prefabId:materials.id,items:[{partDefinitionId:tool,quantity:1}]})).rejects.toThrow("only contain");
      await expect(caller.create({name:"Mixed",kind:"tools",items:[{partDefinitionId:tool,quantity:1},{partDefinitionId:part,quantity:1}]})).rejects.toThrow("only contain");
      expect(await caller.list()).toHaveLength(2);
      // Backfill an existing all-tool prefab without disturbing material kits.
      await db.update(schema.materialPrefabs).set({kind:"materials"}).where(eq(schema.materialPrefabs.id,tools.id));
      const migration = await readFile(new URL("../../drizzle/0078_prefab_kinds.sql",import.meta.url),"utf8");
      await conn.unsafe(migration);
      await conn.unsafe(migration);
      expect((await caller.list({kind:"tools"})).map(p=>p.id)).toEqual([tools.id]);
    });
    it("preserves single-piece requirements when merging saved prefabs", async () => {
      await db.update(schema.partDefinitions).set({piecesPerPack: 3000}).where(eq(schema.partDefinitions.id, part));
      const caller = prefabsRouter.createCaller(context as never);
      const prefab = await caller.create({name: "Test", items: [{partDefinitionId:part,quantity: .000333}]});
      await caller.addItems({prefabId:prefab.id,items:[{partDefinitionId:part,quantity:.000333}]});
      const [line] = await db.select().from(schema.materialPrefabItems).where(eq(schema.materialPrefabItems.prefabId,prefab.id));
      expect(Number(line!.quantity)).toBe(.000667);
    });
    describe("job supplier pricing and approvals",()=>{
      const pricing=jobPricingRouter.createCaller(context as never);
      const policyId=id(400);
      beforeEach(async()=>{
        await db.insert(schema.jobPriceLists).values({id:policyId,organizationId:org,jobId:job,name:"Job scope"});
      });
      it("withholds the email and rejects a direct send for unlisted parts",async()=>{
        const preview=await material.previewOrders({materialListId:list});
        expect(preview.possible[0]?.approval).toMatchObject({required:true,allowed:false,unlistedCount:1});
        expect(preview.possible[0]?.email).toBeUndefined();
        await expect(material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"})).rejects.toThrow("outside the job pricing list");
        expect(await db.select().from(schema.orders)).toHaveLength(0);
      });
      it("allows unlisted orders when approval is turned off without changing their prices", async()=>{
        await db.update(schema.jobPriceLists).set({requireApproval:false}).where(eq(schema.jobPriceLists.id,policyId));
        const preview=await material.previewOrders({materialListId:list});
        expect(preview.possible[0]?.approval).toMatchObject({required:false,allowed:true,unlistedCount:1,status:"not_required"});
        expect(preview.possible[0]?.email).toBeDefined();
        const sent=await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"});
        expect(sent.status).toBe("sent");
        expect(await db.select().from(schema.jobOrderApprovals)).toHaveLength(0);
        expect(Number((await db.select().from(schema.orderItems))[0]?.unitCostAtOrderTime)).toBe(2);
      });
      it("freezes an approval to the exact quantity and records its use",async()=>{
        const request=await pricing.requestApproval({materialListId:list,supplierId:supplier,note:"Unlisted part needed for this job"});
        await pricing.reviewApproval({approvalId:request.approvalId!,decision:"approved",note:"Reviewed requirement"});
        await db.update(schema.quoteItems).set({quantity:"38"}).where(eq(schema.quoteItems.id,item));
        await expect(material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"})).rejects.toThrow("outside the job pricing list");
        await db.update(schema.quoteItems).set({quantity:"37"}).where(eq(schema.quoteItems.id,item));
        const sent=await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"});
        expect(sent.status).toBe("sent");
        expect((await db.select().from(schema.jobOrderApprovals))[0]?.usedAt).toBeInstanceOf(Date);
      });
      it("uses a job-specific price and SKU without changing the generic supplier price",async()=>{
        const listing=id(401);
        await db.insert(schema.supplierParts).values({id:listing,organizationId:org,supplierId:supplier,partDefinitionId:part,supplierSku:"REAL-SKU",packSize:"25",lastKnownUnitCost:null});
        await db.insert(schema.jobPriceEntries).values({priceListId:policyId,supplierPartId:listing,unitCost:"3",priceStatus:"estimated",priceBasis:"each"});
        await recalculatePurchaseTotals(db,quote);
        const row=(await db.select().from(schema.quoteItems))[0]!;
        expect(row.supplierPartId).toBe(listing);expect(Number(row.unitCost)).toBe(3);expect(Number(row.extendedPrice)).toBe(150);
        expect(Number((await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,sp)))[0]?.lastKnownUnitCost)).toBe(2);
        const preview=await material.previewOrders({materialListId:list});
        expect(preview.possible[0]?.approval?.allowed).toBe(true);
        expect(preview.possible[0]?.email?.body).not.toContain("SKU:");
        expect(preview.possible[0]?.email?.supplierSkuLines.some(line=>line.withSku.includes("SKU: REAL-SKU"))).toBe(true);
        const sent=await material.sendGeneratedOrder({materialListId:list,supplierId:supplier,sentTo:"supplier@example.test"});
        await pricing.savePrices({jobId:job,revision:1,lines:[{entryId:(await db.select().from(schema.jobPriceEntries))[0]!.id,unitCost:4,priceStatus:"confirmed",priceSource:"Actual quote"}]});
        expect(Number((await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId,sent.id)))[0]?.unitCostAtOrderTime)).toBe(3);
      });
      it("rejects a cross-organization supplier listing at the database boundary",async()=>{
        const other=id(402);await db.insert(schema.organizations).values({id:other,name:"Other"});
        await db.insert(schema.suppliers).values({id:id(403),organizationId:other,name:"Other supplier"});
        await db.insert(schema.supplierParts).values({id:id(404),organizationId:other,supplierId:id(403),partDefinitionId:part});
        await expect(db.insert(schema.jobPriceEntries).values({priceListId:policyId,supplierPartId:id(404)})).rejects.toThrow();
      });
    });
    it("rejects zero, negatives, malformed and excessive precision rules", () => {
      for (const value of ["0", "-25", "25abc", "NaN", "1000000", "0.0000001"])
        expect(orderMultipleInput.safeParse(value).success).toBe(false);
      for (const value of ["1", "25", "50", "0.25"])
        expect(orderMultipleInput.safeParse(value).success).toBe(true);
    });

    it("remembers SKU email choices per user and supplier without changing catalogue SKUs", async () => {
      await db.update(schema.supplierParts).set({supplierSku:"NEXT123"}).where(eq(schema.supplierParts.id,sp));
      expect((await material.previewOrders({materialListId:list})).possible[0]?.email?.body).not.toContain("[SKU:");
      await saveSupplierEmailPreference(db,"worker",org,supplier,true);
      expect(await readSupplierEmailPreference(db,"worker",org,supplier)).toBe(true);
      expect(await readSupplierEmailPreference(db,"other",org,supplier)).toBe(false);
      expect(await readSupplierEmailPreference(db,"worker",id(999),supplier)).toBe(false);
      const preview=(await material.previewOrders({materialListId:list})).possible[0]!;
      expect(preview.email?.body).toContain("[SKU: NEXT123]");
      await saveSupplierEmailPreference(db,"worker",org,supplier,false);
      expect((await material.previewOrders({materialListId:list})).possible[0]?.email?.body).not.toContain("[SKU:");
      expect((await db.select().from(schema.supplierParts).where(eq(schema.supplierParts.id,sp)))[0]?.supplierSku).toBe("NEXT123");
      await expect(saveSupplierEmailPreference(db,"worker",id(999),supplier,true)).rejects.toMatchObject({code:"NOT_FOUND"});
    });
  },
);
