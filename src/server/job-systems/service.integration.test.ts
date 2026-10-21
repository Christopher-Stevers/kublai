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
import { getTableColumns, getTableName, eq } from "drizzle-orm";
import type * as AnalyzeModule from "./analyze";
import type { PgTable } from "drizzle-orm/pg-core";
const mocked = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  wait: null as Promise<void> | null,
  output: null as unknown,
  extract: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: new Proxy({}, { get: (_, key) => mocked.db[String(key)] }),
}));
vi.mock("~/server/auth/permissions", () => ({
  userCan: (u: { role?: string }, p: string) =>
    p === "drawings.view"
      ? u.role !== "no-drawings"
      : p === "documents.manage"
        ? u.role === "manager"
        : p === "lists.edit"
          ? u.role !== "readonly"
          : true,
  hasManagingSeat: (u: { role?: string }) => u.role === "manager",
}));
vi.mock("~/server/job-systems/extract", () => ({
  extractSpecification: mocked.extract,
}));
vi.mock("~/server/job-systems/analyze", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyzeModule>();
  return {
    ...actual,
    assessPassages: async () => {
      if (mocked.wait) await mocked.wait;
      return mocked.output;
    },
  };
});
vi.mock("~/server/job-systems/drawings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drawings")>()),
  extractDrawingSource: mocked.extract,
}));
import * as schema from "~/server/db/schema";
import {
  drawingWorkspaceEntities,
  drawingWorkspaceMetadata,
} from "~/server/db/drawing-workspace-schema";
import { defaultDrawingMetadata } from "../drawings/domain";
vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
import { pipeSpecsRouter } from "../api/routers/pipeSpecs";
import { emptyDocumentState } from "../documents/domain";
import { jobSystemRequirementsSchema } from "~/lib/job-systems";
import { defaultPipeSpec } from "~/lib/pipe-spec";
import {
  getSpecificationContext,
  selectedAssessmentSources,
  getAssessment,
  startAssessment,
  retainManualEdits,
  validateSpecEvidence,
  validateSpecReferences,
} from "./service";
const socket = process.env.SYSTEMS_TEST_SOCKET;
const sql = postgres({
  host: socket ?? "/tmp/no-systems-db",
  port: 55467,
  database: "systems_integration",
  max: 4,
});
const db = drizzle(sql, { schema });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1),
  job = id(2),
  folder = id(3),
  doc = id(4),
  version = id(5),
  material = id(6);
const tables = [
  schema.users,
  schema.jobs,
  schema.jobDocumentWorkspaces,
  schema.pipeSystemSpecs,
  schema.jobSystemAssessments,
  schema.materials,
  schema.categories,
  schema.catalogs,
  schema.partDefinitions,
  schema.jobDrawingSets,
  schema.jobDrawingSheets,
  drawingWorkspaceEntities,
  drawingWorkspaceMetadata,
] as PgTable[];
const req = () =>
  jobSystemRequirementsSchema.parse({
    systemName: "Heating",
    sourceVersions: [{ documentId: doc, versionId: version }],
    applicabilityEvidence: [
      {
        id: "source",
        documentId: doc,
        versionId: version,
        documentTitle: "spec.pdf",
        page: 1,
        section: "HEATING",
        quote: "Copper pipe.",
      },
    ],
    rules: [
      {
        id: "pipe",
        label: "Pipe",
        group: "pipe",
        evidence: [
          {
            id: "source",
            documentId: doc,
            versionId: version,
            documentTitle: "spec.pdf",
            page: 1,
            section: "HEATING",
            quote: "Copper pipe.",
          },
        ],
        alternatives: [
          { id: "copper", label: "copper", materialLabel: "copper" },
        ],
      },
    ],
  });
async function done() {
  for (let n = 0; n < 100; n++) {
    const rows = await db.select().from(schema.jobSystemAssessments);
    if (rows[0]?.status !== "processing") return rows[0];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Assessment did not finish");
}
describe.skipIf(!socket)("job system assessment transactions", () => {
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/foremanhq-systems-pg."))
      throw Error("Refusing non-isolated database");
    for (const table of tables) {
      const columns = Object.values(getTableColumns(table)).map(
        (c) =>
          `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`,
      );
      await sql.unsafe(
        `CREATE TABLE "${getTableName(table)}" (${columns.join(",")})`,
      );
    }
    await sql`create unique index test_assessment_job on kublai_job_system_assessment ("jobId")`;
    await sql`create unique index test_pipe_job on kublai_pipe_system_spec ("jobId",system)`;
    await sql`alter table kublai_pipe_system_spec alter revision set default 1`;
    for (const method of [
      "select",
      "insert",
      "update",
      "delete",
      "transaction",
    ] as const)
      mocked.db[method] = db[method].bind(db);
  });
  beforeEach(async () => {
    process.env.TYPESAFE_API_KEY = "synthetic-provider-not-used";
    mocked.wait = null;
    mocked.extract.mockReset().mockResolvedValue({
      pages: [{ page: 1, text: "HEATING WATER PIPING\nCopper pipe." }],
      warnings: [],
    });
    mocked.output = {
      systems: [{ code: "HTG", requirements: req() }],
      warnings: [],
      model: "simulated",
    };
    for (const table of [...tables].reverse())
      await sql.unsafe(`TRUNCATE "${getTableName(table)}"`);
    await db.insert(schema.users).values([
      {
        id: "editor",
        email: "editor@example.test",
        organizationId: org,
        organizationAccessStatus: "approved",
      },
      {
        id: "reader",
        email: "reader@example.test",
        role: "readonly",
        organizationId: org,
        organizationAccessStatus: "approved",
      },
      {
        id: "other",
        email: "other@example.test",
        organizationId: id(99),
        organizationAccessStatus: "approved",
      },
    ]);
    await db
      .insert(schema.jobs)
      .values({ id: job, organizationId: org, name: "Test", poNumber: "T" });
    await db
      .insert(schema.materials)
      .values({ id: material, organizationId: org, name: "copper" });
    const now = new Date().toISOString(),
      state = emptyDocumentState();
    state.folders = [
      {
        id: folder,
        name: "Specifications",
        parentId: null,
        permissions: [],
        createdBy: "editor",
        createdAt: now,
        updatedAt: now,
      },
    ];
    state.documents = [
      {
        id: doc,
        jobId: job,
        folderId: folder,
        name: "spec.pdf",
        description: "",
        tags: [],
        status: "approved",
        currentVersionId: version,
        officeWebUrl: null,
        lockedBy: null,
        deletedAt: null,
        createdBy: "editor",
        createdAt: now,
        updatedAt: now,
      },
    ];
    state.versions = [
      {
        id: version,
        documentId: doc,
        number: 1,
        name: "spec.pdf",
        size: 1,
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
        createdBy: "editor",
        createdAt: now,
        restoredFromVersionId: null,
      },
    ];
    await db
      .insert(schema.jobDocumentWorkspaces)
      .values({ jobId: job, organizationId: org, state, revision: 1 });
  });
  afterAll(async () => {
    delete process.env.TYPESAFE_API_KEY;
    await sql.end();
  });
  it("enforces organization, existence, edit permission and missing provider before queueing", async () => {
    await expect(getSpecificationContext("other", job)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      getSpecificationContext("editor", id(88)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startAssessment("reader", job)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    delete process.env.TYPESAFE_API_KEY;
    await expect(startAssessment("editor", job)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocked.extract).not.toHaveBeenCalled();
  });
  it("persists complete evidence-backed systems with real tenant catalog IDs", async () => {
    await startAssessment("editor", job);
    expect((await done())?.status).toBe("ready");
    const [row] = await db.select().from(schema.pipeSystemSpecs);
    expect(row?.data.requirements?.rules[0]?.alternatives[0]?.materialId).toBe(
      material,
    );
    expect(row?.data.requirements?.applicabilityEvidence[0]?.versionId).toBe(
      version,
    );
    expect((await getAssessment("editor", job)).stale).toBe(false);
  });
  it("reuses an active lease and merges corrections made while assessment is running", async () => {
    let release!: () => void;
    mocked.wait = new Promise<void>((r) => {
      release = r;
    });
    const first = await startAssessment("editor", job),
      second = await startAssessment("editor", job);
    expect(first).toEqual(second);
    const edited = req();
    edited.systemName = "User heating";
    edited.manualName = true;
    edited.rules[0]!.manualOverride = true;
    edited.rules[0]!.label = "My correction";
    edited.rules[0]!.reviewStatus = "approved";
    await db.insert(schema.pipeSystemSpecs).values({
      organizationId: org,
      jobId: job,
      system: "HTG",
      data: { ...defaultPipeSpec(), requirements: edited },
      revision: 4,
      updatedBy: "editor",
    });
    release();
    await done();
    const [row] = await db.select().from(schema.pipeSystemSpecs);
    expect(row?.revision).toBe(5);
    expect(row?.data.requirements).toMatchObject({
      systemName: "User heating",
      rules: [{ label: "My correction", manualOverride: true }],
    });
  });
  it("does not publish if source version changes while analysis is in flight", async () => {
    let release!: () => void;
    mocked.wait = new Promise<void>((r) => {
      release = r;
    });
    await startAssessment("editor", job);
    for (let n = 0; n < 20 && !mocked.extract.mock.calls.length; n++)
      await new Promise((r) => setTimeout(r, 10));
    const [row] = await db.select().from(schema.jobDocumentWorkspaces);
    row!.state.documents[0]!.currentVersionId = id(22);
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state: row!.state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    release();
    expect((await done())?.status).toBe("failed");
    expect(await db.select().from(schema.pipeSystemSpecs)).toHaveLength(0);
  });
  it("redacts restricted source names and passages across APIs; forbids editing inaccessible evidence", async () => {
    await startAssessment("editor", job);
    await done();
    const [workspace] = await db.select().from(schema.jobDocumentWorkspaces);
    workspace!.state.folders[0]!.permissions = [
      { userId: "editor", role: "viewer" },
    ];
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state: workspace!.state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    const overview = await getAssessment("reader", job);
    expect(overview.documents).toEqual([]);
    expect(overview.assessment?.sources).toEqual([]);
    expect(overview.assessment?.stage).toBe("Source access restricted");
    const spec = { ...defaultPipeSpec(), requirements: req() };
    await expect(
      validateSpecEvidence("reader", job, spec, spec),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects cross-organization catalog IDs and fabricated source quotes", async () => {
    const spec = { ...defaultPipeSpec(), requirements: req() };
    spec.pipe.materialId = id(66);
    await expect(validateSpecReferences(db, org, spec)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    spec.pipe.materialId = null;
    const old = structuredClone(spec);
    spec.requirements.applicabilityEvidence[0]!.quote =
      "Fabricated requirement";
    await expect(
      validateSpecEvidence("editor", job, spec, old),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("enforces optimistic revisions through the public save endpoint", async () => {
    const caller = pipeSpecsRouter.createCaller({
      db,
      user: { id: "editor", organizationId: org },
    } as never);
    const created = await caller.save({
      jobId: job,
      system: "HTG",
      spec: defaultPipeSpec(),
      revision: 0,
    });
    expect(created.revision).toBe(1);
    await expect(
      caller.save({
        jobId: job,
        system: "HTG",
        spec: defaultPipeSpec(),
        revision: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const changed = {
      ...defaultPipeSpec(),
      pipe: { ...defaultPipeSpec().pipe, materialId: material },
    };
    await caller.save({
      jobId: job,
      system: "HTG",
      spec: changed,
      revision: 1,
    });
    const listed = await caller.list({ jobId: job });
    expect(listed.currentSources).toEqual([
      { documentId: doc, versionId: version },
    ]);
    expect(listed.job[0]?.revision).toBe(2);
  });
  it("shows expired processing leases as retryable and keeps previous system data", async () => {
    const assessment = {
      runId: id(50),
      status: "processing",
      startedAt: new Date(Date.now() - 21 * 60_000).toISOString(),
      stage: "Queued",
      warnings: [],
      sources: [],
      sourceFingerprint: "old",
    };
    await db.insert(schema.jobSystemAssessments).values({
      id: id(50),
      organizationId: org,
      jobId: job,
      requestedBy: "editor",
      status: "processing",
      data: assessment,
    });
    expect((await getAssessment("editor", job)).assessment?.status).toBe(
      "failed",
    );
    await startAssessment("editor", job);
    expect((await done())?.status).toBe("ready");
  });
  it("refuses a partial-access assessment that would replace an existing restricted system", async () => {
    await startAssessment("editor", job);
    await done();
    await db.insert(schema.users).values({
      id: "partial",
      email: "partial@example.test",
      organizationId: org,
      organizationAccessStatus: "approved",
    });
    const [workspace] = await db.select().from(schema.jobDocumentWorkspaces);
    const state = workspace!.state;
    state.folders[0]!.permissions = [{ userId: "editor", role: "viewer" }];
    state.folders.push({
      ...state.folders[0]!,
      id: id(80),
      parentId: folder,
      name: "Shared",
      permissions: [{ userId: "partial", role: "viewer" }],
    });
    state.documents.push({
      ...state.documents[0]!,
      id: id(81),
      folderId: id(80),
      currentVersionId: id(82),
    });
    state.versions.push({
      ...state.versions[0]!,
      id: id(82),
      documentId: id(81),
    });
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    expect(
      (await getSpecificationContext("partial", job)).sources,
    ).toHaveLength(1);
    const before = await db.select().from(schema.pipeSystemSpecs);
    mocked.extract.mockClear();
    await expect(startAssessment("partial", job)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocked.extract).not.toHaveBeenCalled();
    expect(await db.select().from(schema.pipeSystemSpecs)).toEqual(before);
  });
  it("allows a document manager to reassess after a source is deleted and replaced", async () => {
    await startAssessment("editor", job);
    await done();
    await db.insert(schema.users).values({
      id: "manager",
      email: "manager@example.test",
      role: "manager",
      organizationId: org,
      organizationAccessStatus: "approved",
    });
    const [workspace] = await db.select().from(schema.jobDocumentWorkspaces);
    const state = workspace!.state;
    state.documents[0]!.deletedAt = new Date().toISOString();
    state.documents.push({
      ...state.documents[0]!,
      id: id(83),
      currentVersionId: id(84),
      deletedAt: null,
    });
    state.versions.push({
      ...state.versions[0]!,
      id: id(84),
      documentId: id(83),
    });
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    const replacement = req();
    replacement.sourceVersions = [{ documentId: id(83), versionId: id(84) }];
    for (const evidence of [
      ...replacement.applicabilityEvidence,
      ...replacement.rules.flatMap((r) => r.evidence),
    ]) {
      evidence.documentId = id(83);
      evidence.versionId = id(84);
    }
    mocked.output = {
      systems: [{ code: "HTG", requirements: replacement }],
      warnings: [],
      model: "simulated",
    };
    await startAssessment("manager", job);
    expect((await done())?.status).toBe("ready");
    const [system] = await db.select().from(schema.pipeSystemSpecs);
    expect(system?.data.requirements?.sourceVersions).toEqual([
      { documentId: id(83), versionId: id(84) },
    ]);
  });
  it("keeps concurrent admission bounded across different jobs", async () => {
    const [workspace] = await db.select().from(schema.jobDocumentWorkspaces);
    const jobs = [job, ...Array.from({ length: 5 }, (_, n) => id(90 + n))];
    for (const otherJob of jobs.slice(1)) {
      await db.insert(schema.jobs).values({
        id: otherJob,
        organizationId: org,
        name: "Other",
        poNumber: "T",
      });
      const state = structuredClone(workspace!.state);
      for (const d of state.documents) d.jobId = otherJob;
      await db
        .insert(schema.jobDocumentWorkspaces)
        .values({ jobId: otherJob, organizationId: org, state, revision: 1 });
    }
    let release!: () => void;
    mocked.wait = new Promise<void>((r) => {
      release = r;
    });
    const results = await Promise.allSettled(
      jobs.map((j) => startAssessment("editor", j)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    release();
    for (let n = 0; n < 100; n++) {
      const rows = await db.select().from(schema.jobSystemAssessments);
      if (rows.every((r) => r.status !== "processing")) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("Queued assessments did not finish");
  });
  it("marks manual changes and deletions durable without discarding requirements on legacy saves", () => {
    const previous = { ...defaultPipeSpec(), requirements: req() },
      next = structuredClone(previous);
    next.requirements.rules[0]!.label = "Corrected";
    expect(
      retainManualEdits(previous, next).requirements?.rules[0]?.manualOverride,
    ).toBe(true);
    next.requirements.rules = [];
    expect(
      retainManualEdits(previous, next).requirements?.suppressedRuleIds,
    ).toContain("pipe");
    expect(retainManualEdits(previous, defaultPipeSpec()).requirements).toEqual(
      previous.requirements,
    );
  });
  it("selects only requested documents and current drawing revisions, with tenant/access isolation", async () => {
    await db.insert(schema.jobDrawingSets).values([
      { id: id(40), jobId: job, organizationId: org, name: "Mechanical" },
      {
        id: id(41),
        jobId: id(91),
        organizationId: id(99),
        name: "Private other job",
      },
    ]);
    await db.insert(schema.jobDrawingSheets).values([
      {
        id: id(42),
        setId: id(40),
        jobId: job,
        organizationId: org,
        name: "M-001",
        imageUrl: `/api/job-rooms/files/${job}/${id(70)}/floor-1.webp`,
        width: 100,
        height: 100,
      },
      {
        id: id(43),
        setId: id(40),
        jobId: job,
        organizationId: org,
        name: "M-001 revision",
        imageUrl: `/api/job-rooms/files/${job}/${id(71)}/floor-1.webp`,
        width: 100,
        height: 100,
      },
    ]);
    await db.insert(drawingWorkspaceMetadata).values({
      sheetId: id(42),
      revision: 1,
      data: {
        ...defaultDrawingMetadata(id(42)),
        currentSourceSheetId: id(43),
      },
    });
    const context = await getSpecificationContext("editor", job);
    const selected = selectedAssessmentSources(context, {
      documentIds: [],
      drawingSetIds: [id(40)],
    });
    expect(selected.find((s) => s.documentId === id(42))).toMatchObject({
      versionId: id(43),
      drawing: { sheetId: id(42), sourceSheetId: id(43) },
    });
    expect(selected.every((s) => s.drawing)).toBe(true);
    expect(selected).toHaveLength(1);
    expect(() =>
      selectedAssessmentSources(context, {
        documentIds: [],
        drawingSetIds: [id(41)],
      }),
    ).toThrow(/unavailable/);
    expect(() =>
      selectedAssessmentSources(context, {
        documentIds: [id(999)],
        drawingSetIds: [],
      }),
    ).toThrow(/unavailable/);
    const status = await getAssessment("editor", job);
    expect(status.drawingSets.map((s) => s.id)).toEqual([id(40)]);
    expect(
      selectedAssessmentSources(context, {
        documentIds: [doc],
        drawingSetIds: [],
      }).map((s) => s.documentId),
    ).toEqual([doc]);
  });
  it("ignores unselected documents and aborts when a selected drawing changes during assessment", async () => {
    const [workspace] = await db.select().from(schema.jobDocumentWorkspaces);
    const state = workspace!.state;
    state!.documents[0]!.folderId = null;
    await db
      .update(schema.jobDocumentWorkspaces)
      .set({ state })
      .where(eq(schema.jobDocumentWorkspaces.jobId, job));
    let context = await getSpecificationContext("editor", job);
    expect(context.sources).toHaveLength(0);
    expect(
      selectedAssessmentSources(context, {
        documentIds: [doc],
        drawingSetIds: [],
      }),
    ).toHaveLength(1);
    await db.insert(schema.jobDrawingSets).values({
      id: id(50),
      jobId: job,
      organizationId: org,
      name: "Mechanical",
    });
    await db.insert(schema.jobDrawingSheets).values({
      id: id(51),
      setId: id(50),
      jobId: job,
      organizationId: org,
      name: "M-001",
      imageUrl: `/api/job-rooms/files/${job}/${id(70)}/floor-1.webp`,
      width: 100,
      height: 100,
    });
    context = await getSpecificationContext("editor", job);
    expect(
      selectedAssessmentSources(context, {
        documentIds: [],
        drawingSetIds: [id(50)],
      }).map((s) => s.documentId),
    ).toEqual([id(51)]);
    let release!: () => void;
    mocked.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startAssessment("editor", job, {
      documentIds: [],
      drawingSetIds: [id(50)],
    });
    await vi.waitFor(() => expect(mocked.extract).toHaveBeenCalled());
    await db
      .update(schema.jobDrawingSheets)
      .set({ imageUrl: `/api/job-rooms/files/${job}/${id(71)}/floor-1.webp` })
      .where(eq(schema.jobDrawingSheets.id, id(51)));
    release();
    await vi.waitFor(async () =>
      expect((await getAssessment("editor", job)).assessment?.status).toBe(
        "failed",
      ),
    );
    expect(await db.select().from(schema.pipeSystemSpecs)).toHaveLength(0);
    await db
      .update(schema.users)
      .set({ role: "no-drawings" })
      .where(eq(schema.users.id, "editor"));
    expect(
      (await getSpecificationContext("editor", job)).drawingSets,
    ).toHaveLength(0);
  });
});
