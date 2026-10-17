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
import { saveDocumentVersion } from "./service";
import { assertDocumentAccess } from "./access";
import { emptyDocumentState } from "./domain";
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
] as PgTable[];
const file = {
  packingSlipOrderId: order,
  name: "image.jpg",
  mimeType: "image/jpeg",
  size: 100,
  sha256: "a".repeat(64),
};
describe.skipIf(!socket)("packing slip transactions", () => {
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
    await db
      .insert(schema.users)
      .values({
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
    await db
      .insert(schema.orders)
      .values({
        id: order,
        jobId: job,
        organizationId: org,
        materialListId: list,
        status: "sent",
        orderNumber: "PO-123",
      });
    await db
      .insert(schema.jobDocumentWorkspaces)
      .values({
        jobId: job,
        organizationId: org,
        revision: 1,
        state: emptyDocumentState(),
      });
  });
  afterAll(() => conn.end());
  const workspace = async () =>
    (await db.select().from(schema.jobDocumentWorkspaces))[0]!.state;
  it("lets a receiver attach only to their job order without granting general document edits", async () => {
    const access = await assertDocumentAccess("receiver", job, db);
    expect(access.canWrite).toBe(false);
    const persist = vi.fn(async () => {});
    await saveDocumentVersion(access, file, persist);
    expect((await workspace()).documents[0]?.packingSlip).toMatchObject({
      orderId: order,
      materialListId: list,
    });
    expect((await db.select().from(schema.orders))[0]!.status).toBe("sent");
    await expect(
      saveDocumentVersion(
        access,
        {
          name: "other.jpg",
          mimeType: "image/jpeg",
          size: 100,
          sha256: "b".repeat(64),
        },
        persist,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(persist).toHaveBeenCalledOnce();
  });
  it("rolls back folder and document when storage fails and allows a clean retry", async () => {
    const access = await assertDocumentAccess("receiver", job, db);
    await expect(
      saveDocumentVersion(access, file, async () => {
        throw Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect((await workspace()).folders).toHaveLength(0);
    expect((await workspace()).documents).toHaveLength(0);
    await saveDocumentVersion(access, file, async () => {});
    await saveDocumentVersion(access, file, async () => {});
    expect((await workspace()).documents).toHaveLength(1);
  });
  it("rejects foreign-job orders, cancelled orders, and revoked receiving permission", async () => {
    const access = await assertDocumentAccess("receiver", job, db),
      persist = vi.fn(async () => {});
    await db
      .update(schema.orders)
      .set({ jobId: id(10) })
      .where(eq(schema.orders.id, order));
    await expect(
      saveDocumentVersion(access, file, persist),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(schema.orders)
      .set({ jobId: job, status: "cancelled" })
      .where(eq(schema.orders.id, order));
    await expect(
      saveDocumentVersion(access, file, persist),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    test.receive = false;
    await expect(
      saveDocumentVersion(access, file, persist),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(persist).not.toHaveBeenCalled();
    expect((await workspace()).documents).toHaveLength(0);
  });
});
