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
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Sql } from "postgres";
import { organizations, jobs, users } from "~/server/db/schema";
import { bimActivity, bimModels } from "~/server/db/bim-schema";
import { toStoredConfig } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
import { issueSchema, viewStateSchema } from "~/lib/bim/types";

vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const socket = process.env.MODELS_TEST_SOCKET;
  if (socket && !socket.startsWith("/tmp/foremanhq-models-pg."))
    throw Error("Refusing a non-isolated model test database");
  const conn = postgres({
    host: socket ?? "/tmp/no-model-test-cluster",
    port: 55469,
    database: "models_integration",
    max: 4,
    onnotice: () => undefined,
  });
  return { db: drizzle(conn), __testConnection: conn };
});
vi.mock("./native-conversion", () => ({
  nativeConversionAvailable: vi.fn(async () => true),
  convertNativeRevit: vi.fn(),
}));
vi.mock("./storage", () => ({
  modelBlobPath: () => "/tmp/synthetic-model.rvt",
  storeConvertedModel: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: vi.fn(async () => ({ userId: "owner" })),
}));
import { db } from "~/server/db";
import { modelsRouter } from "~/server/api/routers/models";
import { GET } from "~/app/api/models/files/[modelId]/route";
import { modelAccess } from "./access";
import {
  modelWorkspace,
  readModel,
  registerModel,
  removeModel,
  saveModelIssue,
  saveModelView,
} from "./service";
import { convertRevitModel, dispatchModelConversions } from "./conversion";
import { convertNativeRevit } from "./native-conversion";
import { storeConvertedModel } from "./storage";

const org = randomUUID(),
  jobId = randomUUID(),
  otherJob = randomUUID(),
  foreignOrg = randomUUID(),
  foreignJob = randomUUID();
const permissions = (canDelete: boolean, canUpload = true) =>
  toStoredConfig({
    "tab.dashboard": true,
    "drawings.view": true,
    "drawings.upload": canUpload,
    "drawings.delete": canDelete,
  });
const user = {
  id: "owner",
  name: "Test owner",
  email: "owner@example.invalid",
  role: "user",
  organizationId: org,
  organizationAccessStatus: "approved",
  permissionConfig: permissions(true),
} as RequestUser;
const caller = () =>
  modelsRouter.createCaller({
    db,
    headers: new Headers(),
    userId: user.id,
    user,
    actorUser: user,
    simulation: null,
  });
const input = (format: "ifc" | "rvt" = "ifc") => ({
  metadata: {
    jobId,
    name: "Test model",
    discipline: "architecture" as const,
    filename: `test.${format}`,
    size: 100,
  },
  sha: "a".repeat(64),
  format,
});
const view = (id: string) =>
  viewStateSchema.parse({
    modelIds: [id],
    position: [10, 10, 10],
    target: [0, 0, 0],
    origin: [0, 0, 0],
  });
let conn: Sql;
describe.skipIf(!process.env.MODELS_TEST_SOCKET)(
  "model deletion against isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      conn = (
        (await import("~/server/db")) as unknown as { __testConnection: Sql }
      ).__testConnection;
      for (const table of [organizations, jobs, users]) {
        const columns = Object.values(getTableColumns(table as PgTable)).map(
          (c) => `"${c.name}" ${c.getSQLType()}`,
        );
        await conn.unsafe(
          `CREATE TABLE "${getTableName(table as PgTable)}" (${columns.join(",")}, PRIMARY KEY (id))`,
        );
      }
      await conn.unsafe(
        'ALTER TABLE kublai_job ADD UNIQUE (id,"organizationId")',
      );
      await conn.unsafe(
        await readFile("drizzle/0067_bim_workspace.sql", "utf8"),
      );
    });
    afterAll(async () => {
      await conn?.end();
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      delete process.env.BIM_WORKER_DISABLED;
      await db.execute(
        sql`TRUNCATE kublai_organization,kublai_job,kublai_user CASCADE`,
      );
      await conn`INSERT INTO kublai_organization (id,name) VALUES (${org},'Test'),(${foreignOrg},'Foreign')`;
      await conn`INSERT INTO kublai_job (id,"organizationId",name) VALUES (${jobId},${org},'A'),(${otherJob},${org},'B'),(${foreignJob},${foreignOrg},'Foreign')`;
      await conn`INSERT INTO kublai_user (id,name,email,role,"organizationId","organizationAccessStatus","permissionConfig") VALUES (${user.id},${user.name},${user.email},${user.role},${org},'approved',${JSON.stringify(permissions(true))})`;
    });
    it("deletes the selected revision, blocks downloads, and preserves related history and other models", async () => {
      const a = await modelAccess(user.id, jobId);
      const model = await registerModel(a, randomUUID(), input());
      const other = await registerModel(a, randomUUID(), input()); // Same shared blob.
      await saveModelView(a, "Historical view", view(model.id));
      await saveModelIssue(
        a,
        randomUUID(),
        0,
        issueSchema.parse({
          title: "Keep this issue",
          point: [0, 0, 0],
          view: view(model.id),
        }),
      );
      await caller().remove({ jobId, id: model.id });
      const workspace = await modelWorkspace(a);
      expect(workspace.models.map((m) => m.id)).toEqual([other.id]);
      expect(workspace.views).toHaveLength(1);
      expect(workspace.issues).toHaveLength(1);
      await expect(readModel(a, model.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        caller().publication({
          jobId,
          id: model.id,
          publication: "construction",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const response = await GET(
        new Request(
          `http://localhost/api/models/files/${model.id}?jobId=${jobId}&source=1`,
        ),
        { params: Promise.resolve({ modelId: model.id }) },
      );
      expect(response.status).toBe(404);
      await expect(
        saveModelView(a, "Invalid view", view(model.id)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await readModel(a, other.id)).sourceSha).toBe(input().sha);
    });
    it("rechecks delete permission independently of upload permission", async () => {
      const model = await registerModel(
        await modelAccess(user.id, jobId),
        randomUUID(),
        input(),
      );
      await conn`UPDATE kublai_user SET "permissionConfig"=${JSON.stringify(permissions(false))}`;
      await expect(
        caller().remove({ jobId, id: model.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await conn`UPDATE kublai_user SET "permissionConfig"=${JSON.stringify(permissions(true, false))}`;
      await expect(caller().remove({ jobId, id: model.id })).resolves.toEqual({
        ok: true,
      });
    });
    it("cannot delete another job's model or cross organization boundaries", async () => {
      const a = await modelAccess(user.id, jobId);
      const model = await registerModel(a, randomUUID(), input());
      await expect(
        caller().remove({ jobId: otherJob, id: model.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller().remove({ jobId: foreignJob, id: model.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await readModel(a, model.id)).id).toBe(model.id);
    });
    it("is idempotent, prevents upload replay resurrection, and never reuses revision numbers", async () => {
      const a = await modelAccess(user.id, jobId);
      const first = await registerModel(a, randomUUID(), input());
      const revisionInput = {
        ...input(),
        metadata: {
          ...input().metadata,
          seriesId: first.seriesId,
          expectedModelId: first.id,
        },
      };
      const second = await registerModel(a, randomUUID(), revisionInput);
      await removeModel(a, second.id);
      await removeModel(a, second.id);
      await expect(
        registerModel(a, second.id, revisionInput),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const third = await registerModel(a, randomUUID(), revisionInput);
      expect(third.version).toBe(3);
      const events = await db
        .select()
        .from(bimActivity)
        .where(eq(bimActivity.action, "model.deleted"));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: user.id,
        entityId: second.id,
        jobId,
        organizationId: org,
      });
    });
    it("cannot resurrect a model when an in-flight conversion completes", async () => {
      const a = await modelAccess(user.id, jobId);
      const model = await registerModel(a, randomUUID(), input("rvt"));
      await convertRevitModel(a, model.id);
      let complete!: (
        result: Awaited<ReturnType<typeof convertNativeRevit>>,
      ) => void;
      vi.mocked(convertNativeRevit).mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const running = dispatchModelConversions();
      await vi.waitFor(() => expect(convertNativeRevit).toHaveBeenCalledOnce());
      await removeModel(a, model.id);
      complete({
        status: "ready",
        bytes: Buffer.from("fixture"),
        report: {
          schemaVersion: 1,
          engine: "foreman-native-revit",
          engineVersion: "test",
          readerRevision: "a".repeat(40),
          revitVersion: 2024,
          outcome: "preview",
          coordinates: "revit-internal",
          measurementsAllowed: false,
          decodedElements: 1,
          displayedElements: 1,
          omittedBoxElements: 0,
          savedMeshElements: 1,
          levels: 1,
          categories: {},
          warnings: [],
        },
      });
      await running;
      await expect(readModel(a, model.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(storeConvertedModel).not.toHaveBeenCalled();
      await dispatchModelConversions();
      expect(convertNativeRevit).toHaveBeenCalledOnce();
      const [row] = await db
        .select()
        .from(bimModels)
        .where(eq(bimModels.id, model.id));
      expect(row?.data.deletedAt).toBeTruthy();
      expect(row?.conversionRequestedBy).toBeNull();
    });
  },
);
