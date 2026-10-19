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
import { saveDrawingEntity, archiveDrawingEntity } from "./service";
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
describe.skipIf(!socket)("equipment annotations on isolated PostgreSQL", () => {
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

  const request = () =>
    drawingSaveSchema.parse({
      expectedUserId: "reviewer",
      sheetId: old,
      id: id(50),
      kind: "markup",
      expectedRevision: 0,
      visibility: "private",
      data: {
        type: "link",
        equipmentTag: "HEX-2",
        sourceSheetId: old,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
        ],
        links: [
          {
            label: "M-102",
            url: equipmentDrawingDestination({
              jobId: job,
              setId: oldSet,
              sheetId: second,
              sourceSheetId: second,
              name: "M-102",
              tag: "HEX-2",
              box: {
                text: "HEX-2",
                left: 0.3,
                right: 0.4,
                top: 0.2,
                bottom: 0.25,
              },
            }).href,
          },
        ],
      },
    });
  it("saves private clickable tags atomically, updates without duplication and archives with origin", async () => {
    const first = await saveDrawingEntity(ctx, request());
    let rows = await db.select().from(entities);
    expect(rows).toHaveLength(2);
    const child = rows.find((r) => r.id !== first.id)!.entity;
    expect(child.visibility).toBe("private");
    expect(child.kind === "markup" && child.data.links).toHaveLength(2);
    await saveDrawingEntity(ctx, request()); // exact offline replay
    await saveDrawingEntity(ctx, {
      ...request(),
      expectedRevision: first.revision,
      visibility: "published",
    });
    rows = await db.select().from(entities);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.entity.visibility === "published")).toBe(true);
    await archiveDrawingEntity(ctx, {
      sheetId: old,
      id: first.id,
      expectedRevision: 2,
    });
    rows = await db.select().from(entities);
    expect(rows.every((r) => r.entity.visibility === "archived")).toBe(true);
  });
  it("rolls back the original when indexing a linked page fails", async () => {
    equipment.index.mockRejectedValueOnce(Error("index failed"));
    await expect(saveDrawingEntity(ctx, request())).rejects.toThrow(
      "index failed",
    );
    expect(await db.select().from(entities)).toHaveLength(0);
  });
  it("saves common fixture occurrences beyond the old fifty-tag limit atomically", async () => {
    equipment.index.mockResolvedValue({
      pages: [
        {
          page: 1,
          words: Array.from({ length: 80 }, (_, i) => ({
            text: "HEX-2",
            left: 0.1 + (i % 10) * 0.03,
            right: 0.12 + (i % 10) * 0.03,
            top: 0.1 + Math.floor(i / 10) * 0.03,
            bottom: 0.11 + Math.floor(i / 10) * 0.03,
          })),
        },
      ],
    });
    await saveDrawingEntity(ctx, request());
    const rows = await db.select().from(entities);
    expect(rows).toHaveLength(81);
    expect(rows.every((row) => row.entity.visibility === "private")).toBe(true);
    await saveDrawingEntity(ctx, request());
    expect(await db.select().from(entities)).toHaveLength(81);
  });
  it("archives removed destinations and can add them again without duplicating active tags", async () => {
    await saveDrawingEntity(ctx, request());
    const change = request();
    if (change.kind !== "markup") throw Error();
    await saveDrawingEntity(ctx, {
      ...change,
      expectedRevision: 1,
      data: {
        ...change.data,
        links: [{ label: "Jobs", url: "/dashboard/jobs" }],
      },
    });
    await saveDrawingEntity(ctx, { ...request(), expectedRevision: 2 });
    const rows = await db.select().from(entities);
    expect(rows.filter((r) => r.entity.visibility !== "archived")).toHaveLength(
      2,
    );
    expect(rows).toHaveLength(3);
  });
});
