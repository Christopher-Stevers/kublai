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
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "~/server/db/schema";
import {
  drawingWorkspaceEntities as entities,
  drawingWorkspaceMetadata as metadata,
  drawingWorkspaceActivity as activity,
} from "~/server/db/drawing-workspace-schema";
import { estimates } from "~/server/db/estimating-schema";
vi.mock("~/server/db", () => ({ db: {} }));
const equipment = vi.hoisted(() => ({ index: vi.fn() }));
vi.mock("./equipment-index", () => ({
  equipmentIndex: equipment.index,
  drawingPdfLocation: () => ({ file: "test.pdf", page: 1 }),
}));
import { equipmentDrawingDestination } from "~/lib/equipment-tags";
import { drawingSaveSchema } from "~/lib/drawing-workspace";
const rights = vi.hoisted(() => ({ upload: true }));
vi.mock("~/server/auth/permissions", () => ({
  userCan: (_: unknown, key: string) =>
    key !== "drawings.upload" || rights.upload,
}));
vi.mock("~/server/drawings/notifications", () => ({
  enqueueDrawingNotifications: vi.fn(async () => undefined),
}));
vi.mock("~/server/drawings/revision-evidence", () => ({
  prepareRevisionEvidence: vi.fn(async () => undefined),
  revisionEvidence: vi.fn(async () => ({ scale: null, linework: null })),
}));
import { superLabelSettings,saveSuperLabelBoxes,applySuperLabel } from "./service";
const reader=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("./super-label",()=>({readLabelBox:reader.read}));
import { defaultDrawingMetadata } from "./domain";
import { revisionEvidence } from "./revision-evidence";
const socket = process.env.PURCHASE_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-revisions-db",
  port: 55461,
  database: "purchase_integration",
  max: 1,
});
const { drizzle } = await import("drizzle-orm/postgres-js");
const db = drizzle(conn, { schema });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1),
  job = id(2),
  oldSet = id(3),
  uploadSet = id(4),
  old = id(5),
  incoming = id(6),
  second = id(7);
const ctx = { db, userId: "reviewer" };
const tables = [
  schema.organizations,
  schema.users,
  schema.jobs,
  schema.jobDrawingSets,
  schema.jobDrawingSheets,
  entities,
  metadata,
  activity,
  estimates,
] as unknown as PgTable[];
describe.skipIf(!socket)("Super Label set isolation on isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/foremanhq-purchase-pg."))
      throw Error("Refusing non-isolated database");
    for (const table of tables) {
      const columns = Object.values(getTableColumns(table)).map(
        (c) => `"${c.name}" ${c.getSQLType()}`,
      );
      const pk = table === metadata ? "sheetId" : "id";
      await conn.unsafe(
        `CREATE TABLE IF NOT EXISTS "${getTableName(table)}" (${columns.join(",")}, PRIMARY KEY ("${pk}"))`,
      );
    }
  });
  beforeEach(async () => {
    rights.upload = true;
    equipment.index.mockResolvedValue({
      pages: [
        {
          page: 1,
          words: [
            { text: "HEX-2", left: 0.3, right: 0.4, top: 0.2, bottom: 0.25 },
          ],
        },
      ],
    });
    vi.mocked(revisionEvidence).mockResolvedValue({
      scale: null,
      linework: null,
    });
    for (const table of [...tables].reverse())
      await conn.unsafe(`TRUNCATE "${getTableName(table)}"`);
    await db
      .insert(schema.organizations)
      .values({ id: org, name: "Synthetic" });
    await db.insert(schema.users).values({
      id: "reviewer",
      organizationId: org,
      organizationAccessStatus: "approved",
      name: "Reviewer",
      email: "reviewer@example.test",
    });
    await db.insert(schema.jobs).values({
      id: job,
      organizationId: org,
      name: "Test job",
      poNumber: "P",
    });
    await db.insert(schema.jobDrawingSets).values([
      { id: oldSet, organizationId: org, jobId: job, name: "Original" },
      { id: uploadSet, organizationId: org, jobId: job, name: "Revisions" },
    ]);
    await db.insert(schema.jobDrawingSheets).values([
      {
        id: old,
        setId: oldSet,
        organizationId: org,
        jobId: job,
        name: "M-101",
        imageUrl: "/old",
        width: 1000,
        height: 800,
      },
      {
        id: incoming,
        setId: oldSet,
        organizationId: org,
        jobId: job,
        name: "M-101",
        imageUrl: "/new",
        width: 1000,
        height: 800,
      },
      {
        id: second,
        setId: oldSet,
        organizationId: org,
        jobId: job,
        name: "M-102",
        imageUrl: "/second",
        width: 1000,
        height: 800,
      },
    ]);
    await db.insert(metadata).values(
      [old, incoming, second].map((sheetId) => ({
        sheetId,
        revision: 1,
        data: {
          ...defaultDrawingMetadata(sheetId),
          revision: 1,
          number: sheetId === second ? "M-102" : "M-101",
          scale:
            sheetId === old
              ? { unitsPerSheetWidth: 100, unit: "m" as const }
              : null,
        },
      })),
    );
  });
  afterAll(async () => {
    await conn.end();
  });

  const boxes={title:{left:0.1,top:0.1,right:0.5,bottom:0.2},number:{left:0.6,top:0.1,right:0.9,bottom:0.2}};
  it("stores boxes only on the selected set",async()=>{
    await saveSuperLabelBoxes(ctx,{sheetId:old,boxes});
    expect((await superLabelSettings(ctx,old)).boxes).toEqual(boxes);
    const sets=await db.select().from(schema.jobDrawingSets);
    expect(sets.find(s=>s.id===uploadSet)?.labelBoxes).toBeNull();
  });
  it("reads target text and preserves its scale",async()=>{
    await saveSuperLabelBoxes(ctx,{sheetId:old,boxes});
    reader.read.mockResolvedValueOnce("LEVEL ONE").mockResolvedValueOnce("A-101");
    const result=await applySuperLabel(ctx,{sheetId:old,targetId:old,boxes});
    expect(result.title).toBe("LEVEL ONE");
    const rows=await db.select().from(metadata);
    expect(rows.find(r=>r.sheetId===old)?.data.scale?.unitsPerSheetWidth).toBe(100);
    expect(rows.find(r=>r.sheetId===incoming)?.data.number).toBe("M-101");
  });
  it("rejects another set and denied management",async()=>{
    await db.update(schema.jobDrawingSheets).set({setId:uploadSet});
    await db.insert(schema.jobDrawingSheets).values({id:id(99),setId:oldSet,organizationId:org,jobId:job,name:"Other",imageUrl:"/other",width:100,height:100});
    await expect(applySuperLabel(ctx,{sheetId:old,targetId:id(99),boxes})).rejects.toThrow("this set");
    rights.upload=false;
    await expect(saveSuperLabelBoxes(ctx,{sheetId:old,boxes})).rejects.toThrow("permission");
  });
});
