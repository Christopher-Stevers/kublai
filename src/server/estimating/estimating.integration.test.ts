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
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Sql } from "postgres";
import type { RequestUser } from "~/server/utils/get-request-identity";
import * as schema from "~/server/db/schema";
import {
  drawingWorkspaceEntities,
  drawingWorkspaceMetadata,
} from "~/server/db/drawing-workspace-schema";
import { drawingMarkupSchema } from "~/lib/drawing-workspace";
import {
  estimateRevisions,
  estimatingPricingRevisions,
} from "~/server/db/estimating-schema";
import {
  newEstimateDocument,
  newEstimateLine,
  pricingRowSchema,
} from "~/lib/estimating/types";

const isolation = vi.hoisted(() => ({
  schema: `estimating_test_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
}));

vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: vi.fn(),
}));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
  finishSimulationAction: vi.fn(),
}));
vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const conn = postgres({
    host:
      process.env.ESTIMATING_TEST_SOCKET ?? "/tmp/no-estimating-test-cluster",
    port: 55462,
    database: "estimating_integration",
    max: 8,
    connection: { search_path: isolation.schema },
    onnotice: () => undefined,
  });
  return { db: drizzle(conn, { schema }), __testConnection: conn };
});
import { db } from "~/server/db";
import { estimatingRouter } from "~/server/api/routers/estimating";

const org = randomUUID(),
  foreignOrg = randomUUID(),
  job = randomUUID(),
  otherJob = randomUUID(),
  foreignJob = randomUUID();
const catalog = randomUUID(),
  part = randomUUID(),
  part2 = randomUUID(),
  supplier = randomUUID(),
  supplierPart = randomUUID(),
  supplierPart2 = randomUUID();
const materialList = randomUUID(),
  quote = randomUUID(),
  prefab = randomUUID(),
  sheet = randomUUID(),
  foreignSheet = randomUUID(),
  set = randomUUID();
const worker = {
  id: "member",
  name: "Member",
  email: "member@example.invalid",
  role: "worker",
  organizationId: org,
  organizationAccessStatus: "approved",
  permissionConfig: {
    version: 2,
    permissions: {
      "tab.estimating": true,
      "estimating.edit": true,
      "estimating.approve": true,
      "financial.view": true,
      "drawings.view": true,
      "lists.edit": true,
    },
  },
} as RequestUser;
function caller(
  overrides: Partial<RequestUser> = {},
  identity: {
    actorUser?: RequestUser;
    simulation?: {
      id: string;
      actorId: string;
      employeeId: string;
      employeeName: string;
      employeeEmail: string;
      expiresAt: string;
    };
  } = {},
) {
  const user = { ...worker, ...overrides };
  return estimatingRouter.createCaller({
    db,
    headers: new Headers(),
    userId: user.id,
    user,
    actorUser: identity.actorUser ?? user,
    simulation: identity.simulation ?? null,
  });
}
const line = () =>
  newEstimateLine({
    description: "Manual material",
    quantity: 3,
    materialUnitCost: 0,
    priceSource: "manual",
    reviewStatus: "approved",
  });
const document = () => ({ ...newEstimateDocument(), lines: [line()] });
const create = (doc = document()) =>
  caller().create({ jobId: job, name: "Fixture estimate", document: doc });
let conn: Sql;
const socket = process.env.ESTIMATING_TEST_SOCKET;
describe.skipIf(!socket)("Estimating API against isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/foremanhq-estimating-pg."))
      throw Error("Refusing a non-isolated database");
    conn = (
      (await import("~/server/db")) as unknown as { __testConnection: Sql }
    ).__testConnection;
    await conn.unsafe(`CREATE SCHEMA ${isolation.schema}`);
    const tables = [
      schema.organizations,
      schema.users,
      schema.jobs,
      schema.catalogs,
      schema.partDefinitions,
      schema.suppliers,
      schema.supplierParts,
      schema.materialLists,
      schema.quotes,
      schema.quoteItems,
      schema.units,
      schema.materialPrefabs,
      schema.materialPrefabItems,
      schema.jobDrawingSets,
      schema.jobDrawingSheets,
      schema.jobFloors,
      drawingWorkspaceMetadata,
      drawingWorkspaceEntities,
    ];
    for (const table of tables) {
      const defs = Object.values(getTableColumns(table as PgTable)).map(
        (column) => `"${column.name}" ${column.getSQLType()}`,
      );
      const pk =
        getTableName(table as PgTable) === "kublai_drawing_workspace_metadata"
          ? "sheetId"
          : "id";
      await conn.unsafe(
        `CREATE TABLE IF NOT EXISTS "${getTableName(table as PgTable)}" (${defs.join(",")}, PRIMARY KEY ("${pk}"))`,
      );
    }
    await conn.unsafe(
      await readFile(
        new URL("../../../drizzle/0066_estimating.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE kublai_organization,kublai_user,kublai_job,kublai_catalog,kublai_part_definition,kublai_supplier,kublai_supplier_part,kublai_material_list,kublai_quote,kublai_quote_item,kublai_unit,kublai_material_prefab,kublai_material_prefab_item,kublai_job_drawing_set,kublai_job_drawing_sheet,kublai_job_floor,kublai_drawing_workspace_metadata,kublai_drawing_workspace_entity CASCADE`,
    );
    await db.insert(schema.organizations).values([
      { id: org, name: "Synthetic org" },
      { id: foreignOrg, name: "Foreign org" },
    ]);
    await db.insert(schema.users).values([
      {
        id: worker.id,
        email: worker.email,
        name: worker.name,
        organizationId: org,
      },
    ]);
    await db.insert(schema.jobs).values([
      { id: job, organizationId: org, name: "Job A" },
      { id: otherJob, organizationId: org, name: "Job B" },
      { id: foreignJob, organizationId: foreignOrg, name: "Foreign job" },
    ]);
    await conn`INSERT INTO kublai_catalog (id,"organizationId",name,kind) VALUES (${catalog},${org},'Plumbing','materials')`;
    await conn`INSERT INTO kublai_part_definition (id,"organizationId","catalogId","displayName","isActive") VALUES (${part},${org},${catalog},'Zero cost part',true),(${part2},${org},${catalog},'Simulated part',true)`;
    await conn`INSERT INTO kublai_supplier (id,"organizationId",name) VALUES (${supplier},${org},'Supplier')`;
    await conn`INSERT INTO kublai_supplier_part (id,"organizationId","supplierId","partDefinitionId","lastKnownUnitCost","packSize",notes,"isPreferred") VALUES (${supplierPart},${org},${supplier},${part},0,10,'Verified free sample',true),(${supplierPart2},${org},${supplier},${part2},12,5,'[foremanhq-estimate-v1-2026-10-11] SIMULATED ESTIMATE ONLY',true)`;
    await conn`INSERT INTO kublai_material_list (id,"organizationId","jobId",name,"quoteId",kind) VALUES (${materialList},${org},${job},'Fixture materials',${quote},'materials')`;
    await conn`INSERT INTO kublai_quote (id,"organizationId","jobId","materialListId") VALUES (${quote},${org},${job},${materialList})`;
    await conn`INSERT INTO kublai_quote_item (id,"quoteId","partDefinitionId","supplierPartId",quantity,"unitCost",notes,"updatedAt") VALUES (${randomUUID()},${quote},${part2},${supplierPart2},7,12,'SIMULATED ESTIMATE ONLY',now())`;
    await conn`INSERT INTO kublai_material_prefab (id,"organizationId",name) VALUES (${prefab},${org},'Fixture prefab')`;
    await conn`INSERT INTO kublai_material_prefab_item (id,"prefabId","partDefinitionId","supplierPartId",quantity) VALUES (${randomUUID()},${prefab},${part},${supplierPart},2)`;
    await conn`INSERT INTO kublai_job_drawing_sheet (id,"organizationId","jobId","setId",name,"sortOrder","imageUrl") VALUES (${sheet},${org},${job},${set},'Imported sheet',0,'/api/job-rooms/files/job/upload/floor-18.webp'),(${foreignSheet},${foreignOrg},${foreignJob},${set},'Foreign sheet',0,'/api/job-rooms/files/job/upload/floor-19.webp')`;
    await conn`INSERT INTO kublai_drawing_workspace_metadata ("sheetId",data,revision) VALUES (${sheet},${JSON.stringify({ number: "A204", title: "Level 1" })}::jsonb,7)`;
  });
  afterAll(async () => {
    await conn?.unsafe(`DROP SCHEMA ${isolation.schema} CASCADE`);
    await conn?.end();
  });

  it("creates durable documents with actor snapshots and lists/filter jobs safely", async () => {
    const saved = await create();
    expect(saved).toMatchObject({
      revision: 1,
      jobId: job,
      jobName: "Job A",
      companyName: "Synthetic org",
      status: "draft",
      createdByName: "Member",
    });
    expect(
      (await caller().get({ id: saved.id })).document.lines[0]
        ?.materialUnitCost,
    ).toBe(0);
    expect(
      (await caller().list({ search: "fixture", jobId: job })).items,
    ).toHaveLength(1);
    expect((await caller().list({ status: "approved" })).items).toHaveLength(0);
    expect((await caller().jobs()).map((row) => row.id).sort()).toEqual(
      [job, otherJob].sort(),
    );
    expect((await caller().history({ id: saved.id })).items[0]).toMatchObject({
      action: "created",
      actorName: "Member",
      effectiveUserId: worker.id,
    });
  });
  it("requires financial and estimating tab permission on every read and mutation", async () => {
    const saved = await create();
    for (const key of ["financial.view", "tab.estimating"] as const) {
      // Build a normal map so a permissive default cannot obscure the denied key.
      const user = caller({
        permissionConfig: {
          version: 2,
          permissions: {
            "financial.view": key !== "financial.view",
            "tab.estimating": key !== "tab.estimating",
            "estimating.edit": true,
            "estimating.approve": true,
          },
        },
      });
      const calls = [
        () => user.jobs(),
        () => user.list(),
        () => user.get({ id: saved.id }),
        () => user.history({ id: saved.id }),
        () => user.pricing(),
        () => user.resources({ jobId: job }),
        () => user.catalogue({ search: "" }),
        () => user.create({ jobId: job, name: "Denied" }),
        () =>
          user.save({
            id: saved.id,
            expectedRevision: 1,
            document: document(),
          }),
        () => user.duplicate({ id: saved.id }),
      ];
      for (const call of calls)
        await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("requires edit rights separately from approval rights", async () => {
    const saved = await create();
    const viewer = caller({
      permissionConfig: {
        version: 2,
        permissions: { "financial.view": true, "tab.estimating": true },
      },
    });
    await expect(
      viewer.save({ id: saved.id, expectedRevision: 1, document: document() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewer.setStatus({
        id: saved.id,
        expectedRevision: 1,
        status: "approved",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const approver = caller({
      permissionConfig: {
        version: 2,
        permissions: {
          "financial.view": true,
          "tab.estimating": true,
          "estimating.approve": true,
        },
      },
    });
    expect(
      (
        await approver.setStatus({
          id: saved.id,
          expectedRevision: 1,
          status: "approved",
        })
      ).status,
    ).toBe("approved");
  });
  it("scopes estimates, jobs, source sheets, material lists and history to organization/job", async () => {
    const saved = await create();
    const foreign = caller({ id: "foreign", organizationId: foreignOrg });
    await expect(foreign.get({ id: saved.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(foreign.history({ id: saved.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(foreign.duplicate({ id: saved.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller().create({ jobId: foreignJob, name: "Denied" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller().save({
        id: saved.id,
        expectedRevision: 1,
        document: { ...document(), selectedSheetIds: [foreignSheet] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const wrongJob = await caller().create({
      jobId: otherJob,
      name: "Other job",
    });
    await expect(
      caller().importMaterialList({
        id: wrongJob.id,
        expectedRevision: 1,
        materialListId: materialList,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await foreign.list()).items).toHaveLength(0);
    expect(await foreign.catalogue({ search: "" })).toHaveLength(0);
    expect((await caller().get({ id: saved.id })).revision).toBe(1);
  });
  it("serializes competing saves and writes exactly one audit per successful revision", async () => {
    const saved = await create();
    const results = await Promise.allSettled([
      caller().save({
        id: saved.id,
        expectedRevision: 1,
        name: "One",
        document: document(),
      }),
      caller().save({
        id: saved.id,
        expectedRevision: 1,
        name: "Two",
        document: document(),
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toMatchObject({
      code: "CONFLICT",
    });
    expect((await caller().get({ id: saved.id })).revision).toBe(2);
    expect((await caller().history({ id: saved.id })).items).toHaveLength(2);
  });
  it("blocks approval for missing, simulated and unreviewed evidence but preserves real zero prices", async () => {
    for (const values of [
      { materialUnitCost: null, priceSource: "missing" as const },
      { priceSource: "simulated" as const },
      {
        source: { kind: "catalogue" as const },
        reviewStatus: "unreviewed" as const,
      },
    ]) {
      const saved = await create({
        ...document(),
        lines: [{ ...line(), ...values }],
      });
      await expect(
        caller().setStatus({
          id: saved.id,
          expectedRevision: 1,
          status: "approved",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await caller().history({ id: saved.id })).items).toHaveLength(1);
    }
    const zero = await create();
    expect(
      (
        await caller().setStatus({
          id: zero.id,
          expectedRevision: 1,
          status: "approved",
        })
      ).status,
    ).toBe("approved");
  });
  it("locks approved/sent contents and restores new drafts without rewriting snapshots", async () => {
    const saved = await create(),
      original = (await caller().history({ id: saved.id })).items[0]!;
    const approved = await caller().setStatus({
      id: saved.id,
      expectedRevision: 1,
      status: "approved",
    });
    await expect(
      caller().save({
        id: saved.id,
        expectedRevision: approved.revision,
        document: document(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().setStatus({
        id: saved.id,
        expectedRevision: approved.revision,
        status: "draft",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const sent = await caller().setStatus({
      id: saved.id,
      expectedRevision: approved.revision,
      status: "sent",
    });
    const copy = await caller().duplicate({ id: saved.id });
    expect(copy).toMatchObject({
      status: "draft",
      revision: 1,
      document: saved.document,
    });
    const restored = await caller().restore({
      id: saved.id,
      expectedRevision: sent.revision,
      eventId: original.id,
    });
    expect(restored).toMatchObject({
      status: "draft",
      revision: 4,
      document: saved.document,
    });
    expect(
      (await db.select().from(estimateRevisions)).find(
        (event) => event.status === "approved",
      )?.document,
    ).toEqual(saved.document);
    await expect(
      db.execute(
        sql`update kublai_estimate_revision set name='tampered' where id=${original.id}::uuid`,
      ),
    ).rejects.toMatchObject({
      cause: { message: "Estimating revision snapshots cannot be updated" },
    });
  });
  it("records real actor and simulated effective employee transactionally", async () => {
    const actor = { ...worker, id: "manager", name: "Manager" },
      session = {
        id: randomUUID(),
        actorId: "manager",
        employeeId: worker.id,
        employeeName: "Member",
        employeeEmail: worker.email,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    const saved = await caller(
      {},
      { actorUser: actor, simulation: session },
    ).create({ jobId: job, name: "Simulated edit", document: document() });
    expect((await caller().history({ id: saved.id })).items[0]).toMatchObject({
      actorId: "manager",
      actorName: "Manager",
      effectiveUserId: worker.id,
      simulationId: session.id,
    });
    await expect(
      caller(
        {},
        { actorUser: actor, simulation: { ...session, employeeId: "someone" } },
      ).save({ id: saved.id, expectedRevision: 1, document: document() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller().get({ id: saved.id })).revision).toBe(1);
  });
  it("persists company pricebook with optimistic revision checks and exact unit matching", async () => {
    const initial = await caller().pricing();
    expect(initial).toEqual({ revision: 0, rows: [], assemblies: [] });
    const row = pricingRowSchema.parse({
      id: "row",
      description: "Manual material",
      materialUnitCost: 4,
      updatedAt: new Date().toISOString(),
    });
    const pricing = await caller().savePricing({
      expectedRevision: 0,
      rows: [row],
      assemblies: [
        {
          id: "assembly",
          name: "Fixture",
          description: "",
          unit: "ea",
          lines: [line()],
        },
      ],
    });
    expect(pricing.revision).toBe(1);
    await expect(
      caller().savePricing({ expectedRevision: 0, rows: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const estimate = await create(),
      applied = await caller().applyPricing({
        id: estimate.id,
        expectedRevision: 1,
      });
    expect(applied.document.lines[0]).toMatchObject({
      materialUnitCost: 4,
      priceSource: "imported",
    });
    expect(await db.select().from(estimatingPricingRevisions)).toHaveLength(1);
    expect(await db.select().from(estimateRevisions)).toHaveLength(2);
    expect(
      await caller({ id: "foreign", organizationId: foreignOrg }).pricing(),
    ).toEqual(initial);
  });
  it("imports material/prefab demand without editing source purchasing data and retains simulation labels", async () => {
    const saved = await create({ ...newEstimateDocument(), lines: [] });
    const imported = await caller().importMaterialList({
      id: saved.id,
      expectedRevision: 1,
      materialListId: materialList,
    });
    expect(imported.document.lines[0]).toMatchObject({
      quantity: 7,
      priceSource: "simulated",
      reviewStatus: "unreviewed",
      orderMultiple: 5,
    });
    const repeated = await caller().importMaterialList({
      id: saved.id,
      expectedRevision: imported.revision,
      materialListId: materialList,
    });
    expect(repeated.document.lines).toHaveLength(1);
    expect(repeated.document.assumptions).toBe(imported.document.assumptions);
    const withPrefab = await caller().importPrefab({
      id: saved.id,
      expectedRevision: repeated.revision,
      prefabId: prefab,
      quantity: 3,
    });
    expect(withPrefab.document.lines[1]).toMatchObject({
      quantity: 6,
      materialUnitCost: 0,
      priceSource: "supplier",
      orderMultiple: 10,
    });
    const [source] =
      await conn`select quantity,"unitCost" from kublai_quote_item where "quoteId"=${quote}`;
    expect(source).toMatchObject({ quantity: "7.000000", unitCost: "12.0000" });
  });
  it("rejects oversized combined pricebooks and foreign or mismatched assembly references atomically", async () => {
    const row = pricingRowSchema.parse({
      id: "row",
      description: "d".repeat(500),
      sku: "s".repeat(200),
      supplierName: "p".repeat(200),
      trade: "t".repeat(100),
      costCode: "c".repeat(100),
    });
    await expect(
      caller().savePricing({
        expectedRevision: 0,
        rows: Array.from({ length: 7000 }, (_, index) => ({
          ...row,
          id: `row-${index}`,
        })),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    const foreignPart = randomUUID(),
      foreignSupplierPart = randomUUID(),
      foreignSupplier = randomUUID(),
      foreignCatalog = randomUUID();
    await conn`insert into kublai_catalog (id,"organizationId",name,kind) values (${foreignCatalog},${foreignOrg},'Foreign catalogue','materials')`;
    await conn`insert into kublai_part_definition (id,"organizationId","catalogId","displayName","isActive") values (${foreignPart},${foreignOrg},${foreignCatalog},'Foreign part',true)`;
    await conn`insert into kublai_supplier (id,"organizationId",name) values (${foreignSupplier},${foreignOrg},'Foreign supplier')`;
    await conn`insert into kublai_supplier_part (id,"organizationId","supplierId","partDefinitionId") values (${foreignSupplierPart},${foreignOrg},${foreignSupplier},${foreignPart})`;
    for (const values of [
      { partDefinitionId: randomUUID() },
      { supplierPartId: randomUUID() },
      { partDefinitionId: foreignPart },
      { supplierPartId: foreignSupplierPart },
      { partDefinitionId: part, supplierPartId: supplierPart2 },
    ]) {
      await expect(
        caller().savePricing({
          expectedRevision: 0,
          assemblies: [
            {
              id: "assembly",
              name: "Rejected assembly",
              unit: "ea",
              description: "",
              lines: [{ ...line(), ...values }],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await caller().pricing()).toEqual({
      revision: 0,
      rows: [],
      assemblies: [],
    });
    expect(await db.select().from(estimatingPricingRevisions)).toHaveLength(0);
    const saved = await caller().savePricing({
      expectedRevision: 0,
      rows: Array.from({ length: 4000 }, (_, index) => ({
        ...row,
        id: `row-${index}`,
      })),
    });
    await expect(
      caller().savePricing({
        expectedRevision: saved.revision,
        assemblies: Array.from({ length: 5 }, (_, index) => ({
          id: `a-${index}`,
          name: "Large assembly",
          description: "",
          unit: "ea",
          lines: Array.from({ length: 300 }, () => ({
            ...line(),
            notes: "n".repeat(2000),
          })),
        })),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect((await caller().pricing()).revision).toBe(saved.revision);
    expect(await db.select().from(estimatingPricingRevisions)).toHaveLength(1);
  });
  it("stores source review readiness consistently with approval and history summaries", async () => {
    const saved = await create({
      ...document(),
      lines: [
        {
          ...line(),
          source: { kind: "catalogue" },
          reviewStatus: "unreviewed",
        },
      ],
    });
    const listed = (await caller().list()).items[0];
    expect(listed?.companyName).toBe("Synthetic org");
    expect(listed?.summary.readiness).toMatchObject({
      ready: false,
      unreviewed: 1,
      score: 0,
    });
    expect(
      (await caller().history({ id: saved.id })).items[0]?.summary,
    ).toEqual(listed?.summary);
    await expect(
      caller().setStatus({
        id: saved.id,
        expectedRevision: 1,
        status: "approved",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const reviewed = await caller().save({
      id: saved.id,
      expectedRevision: 1,
      document: {
        ...saved.document,
        lines: saved.document.lines.map((value) => ({
          ...value,
          reviewStatus: "approved",
        })),
      },
    });
    expect((await caller().list()).items[0]?.summary.readiness).toMatchObject({
      ready: true,
      unreviewed: 0,
      score: 100,
    });
    expect(
      (
        await caller().setStatus({
          id: saved.id,
          expectedRevision: reviewed.revision,
          status: "approved",
        })
      ).status,
    ).toBe("approved");
  });
  it("returns exact sheet metadata/page source and labels simulated catalogue prices", async () => {
    const resources = await caller().resources({ jobId: job });
    expect(resources.sheets).toEqual([
      {
        id: sheet,
        setId: set,
        number: "A204",
        title: "Level 1",
        pageNumber: 18,
        revision: "7",
      },
    ]);
    const parts = await caller().catalogue({ search: "" });
    expect(parts.find((row) => row.partDefinitionId === part)).toMatchObject({
      materialUnitCost: 0,
      priceSource: "supplier",
    });
    expect(parts.find((row) => row.partDefinitionId === part2)).toMatchObject({
      materialUnitCost: 12,
      priceSource: "simulated",
    });
    expect(new Set(parts.map((row) => row.id)).size).toBe(parts.length);
  });
  it("prepares material demand once per approved snapshot without touching existing list records", async () => {
    const linked = newEstimateLine({
      description: "Linked material",
      quantity: 3,
      wastePercent: 10,
      materialUnitCost: 1.25,
      priceSource: "manual",
      reviewStatus: "approved",
      partDefinitionId: part,
      supplierPartId: supplierPart,
      orderMultiple: 10,
    });
    const saved = await create({
      ...document(),
      lines: [linked, { ...linked, id: randomUUID() }, line()],
    });
    await expect(
      caller().handoffMaterialList({ id: saved.id, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const approved = await caller().setStatus({
      id: saved.id,
      expectedRevision: 1,
      status: "approved",
    });
    await expect(
      caller().handoffMaterialList({ id: saved.id, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [first, second] = await Promise.all([
      caller().handoffMaterialList({
        id: saved.id,
        expectedRevision: approved.revision,
      }),
      caller().handoffMaterialList({
        id: saved.id,
        expectedRevision: approved.revision,
      }),
    ]);
    expect(first.materialListId).toBe(second.materialListId);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(first.estimate.document).toEqual(approved.document);
    const result = first.created ? first : second;
    expect(result.warnings[0]).toContain("without catalogue part links");
    const [createdList] = await conn<
      { quoteId: string }[]
    >`select "quoteId" from kublai_material_list where id=${result.materialListId}`;
    const rows =
      await conn`select * from kublai_quote_item where "quoteId"=${createdList!.quoteId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: "6.600000",
      unitCost: "1.2500",
      extendedPrice: "12.50",
    });
    expect(
      (
        await conn`select quantity,"unitCost" from kublai_quote_item where "quoteId"=${quote}`
      )[0],
    ).toMatchObject({ quantity: "7.000000", unitCost: "12.0000" });
    expect((await caller().history({ id: saved.id })).items[0]?.action).toBe(
      `material-list-prepared:${result.materialListId}`,
    );
  });
  it("requires list edit rights and supported CAD costs before material handoff", async () => {
    const linked = newEstimateLine({
      description: "Linked material",
      quantity: 1,
      materialUnitCost: 1,
      priceSource: "manual",
      reviewStatus: "approved",
      partDefinitionId: part,
    });
    const saved = await create({ ...document(), lines: [linked] });
    const approved = await caller().setStatus({
      id: saved.id,
      expectedRevision: 1,
      status: "approved",
    });
    const denied = caller({
      permissionConfig: {
        version: 2,
        permissions: {
          "financial.view": true,
          "tab.estimating": true,
          "estimating.edit": true,
          "lists.edit": false,
        },
      },
    });
    await expect(
      denied.handoffMaterialList({
        id: saved.id,
        expectedRevision: approved.revision,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreignCurrency = document();
    foreignCurrency.settings.currency = "USD";
    foreignCurrency.lines = [linked];
    const usd = await create(foreignCurrency),
      usdApproved = await caller().setStatus({
        id: usd.id,
        expectedRevision: 1,
        status: "approved",
      });
    await expect(
      caller().handoffMaterialList({
        id: usd.id,
        expectedRevision: usdApproved.revision,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("drawings analysis imports saved published evidence once with visible extraction limits", async () => {
    const entity = {
      id: randomUUID(),
      sheetId: sheet,
      revision: 3,
      kind: "markup",
      visibility: "published",
      authorId: worker.id,
      authorName: worker.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
      data: drawingMarkupSchema.parse({
        sourceSheetId: sheet,
        type: "count",
        text: "Valves",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.4 },
        ],
      }),
    };
    await conn`insert into kublai_drawing_workspace_entity (id,"sheetId","jobId","organizationId",entity,revision) values (${entity.id},${sheet},${job},${org},${JSON.stringify(entity)}::jsonb,3)`;
    const saved = await create({ ...newEstimateDocument(), lines: [] });
    const analyzed = await caller().analyzeDrawings({
      id: saved.id,
      expectedRevision: 1,
      sheetIds: [sheet],
    });
    expect(analyzed.document.lines[0]).toMatchObject({
      quantity: 2,
      unit: "ea",
      source: {
        kind: "drawing-measurement",
        sheetId: sheet,
        markupId: entity.id,
      },
      reviewStatus: "unreviewed",
    });
    expect(analyzed.document.selectedSheetIds).toEqual([sheet]);
    const repeated = await caller().analyzeDrawings({
      id: saved.id,
      expectedRevision: analyzed.revision,
      sheetIds: [sheet],
    });
    expect(repeated.document.lines).toHaveLength(1);
    expect(repeated.document.assumptions).toContain(
      "No new supported drawing quantities",
    );
    await expect(
      caller().analyzeDrawings({
        id: saved.id,
        expectedRevision: repeated.revision,
        sheetIds: [foreignSheet],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().analyzeDrawings({
        id: saved.id,
        expectedRevision: repeated.revision,
        sheetIds: Array.from({ length: 6 }, () => sheet),
      }),
    ).rejects.toThrow();
  });
  it("paginates summaries and revision metadata with exact database timestamp boundaries", async () => {
    const saved = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        caller().create({
          jobId: job,
          name: `Page ${index}`,
          document: document(),
        }),
      ),
    );
    for (const [index, row] of saved.entries())
      await conn`update kublai_estimate set "updatedAt"=${`2026-10-11T01:01:01.12300${Math.floor(index / 3) + 1}Z`}::timestamptz where id=${row.id}`;
    const ids: string[] = [];
    let cursor: { updatedAt: string; id: string } | undefined;
    do {
      const page = await caller().list({ limit: 2, cursor });
      expect(
        page.items.every(
          (row) =>
            !Object.hasOwn(row, "document") && row.summary.lineCount === 1,
        ),
      ).toBe(true);
      expect(page.items).toHaveLength(Math.min(2, 7 - ids.length));
      ids.push(...page.items.map((row) => row.id));
      if (page.nextCursor)
        expect(page.nextCursor.updatedAt).toMatch(/\.12300[1-3]Z$/);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(7);
    const estimate = saved[0]!;
    let revision = estimate.revision;
    for (let i = 0; i < 5; i++)
      revision = (
        await caller().save({
          id: estimate.id,
          expectedRevision: revision,
          name: `Revision ${i}`,
          document: document(),
        })
      ).revision;
    const events: number[] = [];
    let beforeRevision: number | undefined;
    do {
      const history = await caller().history({
        id: estimate.id,
        limit: 2,
        beforeRevision,
      });
      expect(
        history.items.every(
          (event) =>
            !Object.hasOwn(event, "document") &&
            event.summary.currency === "CAD",
        ),
      ).toBe(true);
      events.push(...history.items.map((event) => event.revision));
      beforeRevision = history.nextBeforeRevision ?? undefined;
    } while (beforeRevision);
    expect(events).toEqual([6, 5, 4, 3, 2, 1]);
  });
  it("blocks sent status and material preparation after authoritative drawing evidence changes", async () => {
    const entity = {
      id: randomUUID(),
      sheetId: sheet,
      revision: 3,
      kind: "markup",
      visibility: "published",
      authorId: worker.id,
      authorName: worker.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
      data: drawingMarkupSchema.parse({
        sourceSheetId: sheet,
        type: "count",
        text: "Valves",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.4 },
        ],
      }),
    };
    await conn`insert into kublai_drawing_workspace_entity (id,"sheetId","jobId","organizationId",entity,revision) values (${entity.id},${sheet},${job},${org},${JSON.stringify(entity)}::jsonb,3)`;
    const saved = await create({ ...newEstimateDocument(), lines: [] }),
      analyzed = await caller().analyzeDrawings({
        id: saved.id,
        expectedRevision: 1,
        sheetIds: [sheet],
      });
    const reviewed = await caller().save({
      id: saved.id,
      expectedRevision: analyzed.revision,
      document: {
        ...analyzed.document,
        lines: analyzed.document.lines.map((line) => ({
          ...line,
          partDefinitionId: part,
          materialUnitCost: 1,
          priceSource: "manual",
          reviewStatus: "approved",
        })),
      },
    });
    const approved = await caller().setStatus({
      id: saved.id,
      expectedRevision: reviewed.revision,
      status: "approved",
    });
    await conn`update kublai_drawing_workspace_entity set revision=4,entity=jsonb_set(jsonb_set(entity,'{revision}','4'::jsonb),'{data,text}','"Changed valves"'::jsonb) where id=${entity.id}`;
    await expect(
      caller().setStatus({
        id: saved.id,
        expectedRevision: approved.revision,
        status: "sent",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().handoffMaterialList({
        id: saved.id,
        expectedRevision: approved.revision,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller().get({ id: saved.id })).document).toEqual(
      approved.document,
    );
    expect((await caller().history({ id: saved.id })).items[0]?.revision).toBe(
      approved.revision,
    );
  });
  it("does not overwrite an estimate saved while expensive drawing analysis is in progress", async () => {
    const analysis = await import("./drawing-analysis");
    let started!: () => void, release!: () => void;
    const notified = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<
      Awaited<ReturnType<typeof analysis.analyzeJobDrawings>>
    >((resolve) => {
      release = () => resolve({ lines: [], warnings: [], sheetIds: [sheet] });
    });
    const spy = vi
      .spyOn(analysis, "analyzeJobDrawings")
      .mockImplementationOnce(async () => {
        started();
        return gate;
      });
    const saved = await create();
    const pending = caller().analyzeDrawings({
      id: saved.id,
      expectedRevision: 1,
      sheetIds: [sheet],
    });
    try {
      await notified;
      const changed = await caller().save({
        id: saved.id,
        expectedRevision: 1,
        name: "Saved during analysis",
        document: document(),
      });
      release();
      await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await caller().get({ id: saved.id })).name).toBe(changed.name);
      expect((await caller().history({ id: saved.id })).items).toHaveLength(2);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it("protects historical rows directly while permitting legitimate job and organization cascades", async () => {
    const saved = await create();
    const event = (await caller().history({ id: saved.id })).items[0]!;
    await expect(
      conn`delete from kublai_estimate_revision where id=${event.id}`,
    ).rejects.toThrow("cannot be deleted");
    await caller().savePricing({ expectedRevision: 0, rows: [] });
    await expect(
      conn`delete from kublai_estimating_pricing_revision where "organizationId"=${org}`,
    ).rejects.toThrow("cannot be deleted");
    await conn`delete from kublai_job where id=${job}`;
    expect(
      await conn`select id from kublai_estimate where id=${saved.id}`,
    ).toHaveLength(0);
    expect(
      await conn`select id from kublai_estimate_revision where "estimateId"=${saved.id}`,
    ).toHaveLength(0);
    await conn`delete from kublai_organization where id=${org}`;
    expect(
      await conn`select id from kublai_estimating_pricing_revision where "organizationId"=${org}`,
    ).toHaveLength(0);
  });
  it("rejects document limits, duplicate IDs and unknown alternates before persistence", async () => {
    await expect(
      create({
        ...document(),
        lines: Array.from({ length: 2001 }, () => line()),
      }),
    ).rejects.toThrow();
    const duplicated = line();
    await expect(
      create({ ...document(), lines: [duplicated, duplicated] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      create({ ...document(), lines: [{ ...line(), alternateId: "missing" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller().list()).items).toHaveLength(0);
    await expect(
      conn`insert into kublai_estimate ("organizationId","jobId",name,document,summary,"createdByUserId","createdByName") values (${org},${foreignJob},'Foreign job',${JSON.stringify(document())}::jsonb,'{}'::jsonb,'member','Member')`,
    ).rejects.toMatchObject({ code: "23503" });
  });
});
