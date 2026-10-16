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
import { getTableColumns, getTableName, eq } from "drizzle-orm";
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
import {
  applyDrawingRevisionUpload,
  reviewDrawingRevisionUpload,
} from "./service";
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
describe.skipIf(!socket)(
  "atomic revision upload on isolated PostgreSQL",
  () => {
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
          setId: uploadSet,
          organizationId: org,
          jobId: job,
          name: "M-101",
          imageUrl: "/new",
          width: 1000,
          height: 800,
        },
        {
          id: second,
          setId: uploadSet,
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
    it("proposes matches without changing current drawings and confirms revisions/new sheets together", async () => {
      const review = await reviewDrawingRevisionUpload(ctx, uploadSet);
      expect(review.rows.map((r) => r.status)).toEqual(["matched", "new"]);
      expect(
        (await db.select().from(metadata).where(eq(metadata.sheetId, old)))[0]
          ?.data.currentSourceSheetId,
      ).toBe(old);
      const result = await applyDrawingRevisionUpload(ctx, {
        uploadedSetId: uploadSet,
        label: "Issued revision",
        rows: [
          {
            sourceId: incoming,
            sourceRevision: 1,
            targetId: old,
            expectedRevision: 1,
          },
          { sourceId: second, sourceRevision: 1, targetId: null },
        ],
      });
      expect(result.revised).toEqual(["M-101"]);
      expect(result.newSheets).toEqual(["M-102"]);
      expect(result.needsCalibration).toEqual(["M-101"]);
      const [current] = await db
        .select()
        .from(metadata)
        .where(eq(metadata.sheetId, old));
      expect(current?.data).toMatchObject({
        currentSourceSheetId: incoming,
        scale: null,
        status: "draft",
        revision: 2,
      });
      expect(await db.select().from(schema.jobDrawingSheets)).toHaveLength(3);
      expect((await db.select().from(entities))[0]?.entity).toMatchObject({
        kind: "version",
        data: { sourceSheetId: incoming, label: "Issued revision" },
      });
    });
    it("retains an existing calibration only when source scale and geometry agree", async () => {
      const scale = { unitsPerSheetWidth: 100, unit: "m" as const };
      const linework = {
        aspect: 0.8,
        truncated: false,
        labels: [],
        segments: Array.from({ length: 120 }, (_, i) => ({
          id: String(i),
          pathId: String(i),
          x1: 0.12 + (i % 12) * 0.045,
          y1: 0.12 + Math.floor(i / 12) * 0.055,
          x2: 0.15 + (i % 12) * 0.045,
          y2: 0.12 + Math.floor(i / 12) * 0.055,
          stroke: "#000000",
          width: 0.001,
          dash: [],
        })),
      };
      vi.mocked(revisionEvidence).mockResolvedValue({
        scale: { width: 1000, height: 800, scale, words: [] },
        linework,
      });
      const result = await applyDrawingRevisionUpload(ctx, {
        uploadedSetId: uploadSet,
        label: "R",
        rows: [
          {
            sourceId: incoming,
            sourceRevision: 1,
            targetId: old,
            expectedRevision: 1,
          },
        ],
      });
      expect(result.calibrationRetained).toEqual(["M-101"]);
      expect(result.needsCalibration).toEqual([]);
      expect(
        (await db.select().from(metadata).where(eq(metadata.sheetId, old)))[0]
          ?.data.scale,
      ).toEqual(scale);
    });
    it("flags possible impacts without altering saved markups or takeoff quantities", async () => {
      const markup = {
        id: id(80),
        sheetId: old,
        kind: "markup" as const,
        revision: 1,
        visibility: "published" as const,
        authorId: "reviewer",
        authorName: "Reviewer",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
        data: {
          sourceSheetId: old,
          type: "dimension" as const,
          points: [
            { x: 0.2, y: 0.3 },
            { x: 0.4, y: 0.3 },
          ],
          stroke: "#000000",
          width: 1,
          scale: 100,
          unit: "m" as const,
        },
      };
      await db.insert(entities).values({
        id: markup.id,
        sheetId: old,
        jobId: job,
        organizationId: org,
        revision: 1,
        entity: markup,
      });
      const privateMarkup = {
        ...markup,
        id: id(82),
        authorId: "another-user",
        visibility: "private" as const,
      };
      await db
        .insert(entities)
        .values({
          id: privateMarkup.id,
          sheetId: old,
          jobId: job,
          organizationId: org,
          revision: 1,
          entity: privateMarkup,
        });
      const { newEstimateDocument, newEstimateLine } =
        await import("~/lib/estimating/types");
      const document = {
        ...newEstimateDocument(),
        lines: [
          newEstimateLine({
            id: "takeoff",
            description: "Pipe run",
            quantity: 20,
            source: {
              kind: "drawing-measurement",
              sheetId: old,
              markupId: markup.id,
            },
          }),
        ],
      };
      await db.insert(estimates).values({
        id: id(81),
        jobId: job,
        organizationId: org,
        name: "Estimate",
        document,
        summary: {} as never,
        createdByUserId: "reviewer",
        createdByName: "Reviewer",
      });
      const result = await applyDrawingRevisionUpload(ctx, {
        uploadedSetId: uploadSet,
        label: "R",
        rows: [
          {
            sourceId: incoming,
            sourceRevision: 1,
            targetId: old,
            expectedRevision: 1,
          },
        ],
      });
      expect(result.impactCount).toBe(2);
      const records = await db.select().from(entities);
      expect(records.find((r) => r.id === markup.id)?.entity).toEqual(markup);
      const flags = records
        .map((r) => r.entity)
        .filter((e) => e.kind === "issue");
      expect(flags).toHaveLength(2);
      expect(
        flags.every(
          (e) =>
            e.kind === "issue" &&
            e.data.revisionImpact?.alignmentVerified === false,
        ),
      ).toBe(true);
      expect(
        flags.find(
          (e) =>
            e.kind === "issue" &&
            e.data.revisionImpact?.affectedKind === "takeoff",
        )?.visibility,
      ).toBe("private");
      expect(
        (await db.select().from(estimates))[0]?.document.lines[0]?.quantity,
      ).toBe(20);
    });
    it("rolls back earlier rows if a later confirmation is stale", async () => {
      await expect(
        applyDrawingRevisionUpload(ctx, {
          uploadedSetId: uploadSet,
          label: "R",
          rows: [
            {
              sourceId: incoming,
              sourceRevision: 1,
              targetId: old,
              expectedRevision: 1,
            },
            { sourceId: second, sourceRevision: 99, targetId: null },
          ],
        }),
      ).rejects.toThrow();
      expect(await db.select().from(entities)).toHaveLength(0);
      expect(
        (await db.select().from(metadata).where(eq(metadata.sheetId, old)))[0]
          ?.data.currentSourceSheetId,
      ).toBe(old);
    });
    it("enforces organization and drawing-management permission, and rejects duplicate targets", async () => {
      rights.upload = false;
      await expect(reviewDrawingRevisionUpload(ctx, uploadSet)).rejects.toThrow(
        "permission",
      );
      rights.upload = true;
      await conn`UPDATE kublai_user SET "organizationId"=${id(99)} WHERE id='reviewer'`;
      await expect(reviewDrawingRevisionUpload(ctx, uploadSet)).rejects.toThrow(
        "not found",
      );
      await conn`UPDATE kublai_user SET "organizationId"=${org} WHERE id='reviewer'`;
      await expect(
        applyDrawingRevisionUpload(ctx, {
          uploadedSetId: uploadSet,
          label: "R",
          rows: [
            {
              sourceId: incoming,
              sourceRevision: 1,
              targetId: old,
              expectedRevision: 1,
            },
            {
              sourceId: second,
              sourceRevision: 1,
              targetId: old,
              expectedRevision: 1,
            },
          ],
        }),
      ).rejects.toThrow("only once");
      expect(await db.select().from(entities)).toHaveLength(0);
    });
  },
);
