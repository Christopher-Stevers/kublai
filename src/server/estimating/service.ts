import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { calculateEstimate } from "~/lib/estimating/calculator";
import { matchEstimatePricing } from "~/lib/estimating/pricing";
import { add, decimal, numeric } from "~/lib/estimating/decimal";
import { normalizeUnit } from "~/lib/estimating/units";
import { purchaseLineTotal } from "~/lib/purchase-quantity";
import {
  assemblySchema,
  estimateDocumentSchema,
  estimateLineSchema,
  newEstimateDocument,
  pricingRowSchema,
  type EstimateAssembly,
  type EstimateDocument,
  type EstimateLine,
  type EstimateRecord,
  type EstimateSummary,
  type EstimateListRecord,
  type EstimateHistoryEntry,
  type EstimateStatus,
  type PricingRow,
} from "~/lib/estimating/types";
import type { EmployeeSimulation } from "~/lib/employee-simulation";
import { assertCan } from "~/server/auth/permissions";
import type { db as database } from "~/server/db";
import {
  estimateRevisions,
  estimates,
  estimatingPricing,
  estimatingPricingRevisions,
} from "~/server/db/estimating-schema";
import type { RequestUser } from "~/server/utils/get-request-identity";

type Database = Pick<
  typeof database,
  "select" | "insert" | "update" | "execute" | "transaction"
>;
type Reader = Pick<Database, "select" | "execute">;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type EstimateRow = typeof estimates.$inferSelect;
export type EstimateContext = {
  db: Database;
  user: RequestUser;
  userId: string;
  actorUser?: RequestUser | null;
  simulation?: EmployeeSimulation | null;
};
const nameSchema = z.string().trim().min(1).max(255);
const revisionSchema = z.number().int().min(1).max(2_147_483_646);
const uuid = z.string().uuid();
const MAX_DOCUMENT_BYTES = 8_000_000;
const mutable = new Set<EstimateStatus>(["draft", "in_review"]);
function estimateSummary(document: EstimateDocument): EstimateSummary {
  try {
    const result = calculateEstimate(document);
    const unreviewedSources = includedLines(document).filter(
      (line) =>
        line.source.kind !== "manual" && line.reviewStatus !== "approved",
    );
    const active = result.lines.filter((line) => line.included),
      activeIds = new Set(active.map((line) => line.id)),
      affected = new Set(
        result.issues.flatMap((issue) =>
          issue.lineId &&
          (activeIds.has(issue.lineId) || issue.severity === "error")
            ? [issue.lineId]
            : [],
        ),
      );
    for (const line of unreviewedSources) affected.add(line.id);
    const readiness = {
      ...result.readiness,
      ready: result.readiness.ready && unreviewedSources.length === 0,
      unreviewed: Math.max(
        result.readiness.unreviewed,
        unreviewedSources.length,
      ),
      score: active.some((line) => line.demand > 0)
        ? Math.max(
            0,
            Math.round(
              100 *
                (1 - affected.size / Math.max(active.length, affected.size)),
            ),
          )
        : 0,
    };
    return {
      currency: document.settings.currency,
      total: result.total.total,
      directCost: result.total.directCost,
      materialTotal: result.total.materialTotal,
      laborTotal: result.total.laborTotal,
      laborHours: result.total.laborHours,
      lineCount: document.lines.length,
      readiness,
    };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Estimate amounts exceed the supported calculation range.",
    });
  }
}
function usableText(text: string | null | undefined, fallback: string) {
  const trimmed = text?.trim();
  return trimmed?.length ? trimmed : fallback;
}
function includedLines(document: EstimateDocument) {
  const alternates = new Set(
    document.alternates
      .filter((alternate) => alternate.included)
      .map((alternate) => alternate.id),
  );
  return document.lines.filter(
    (line) =>
      line.reviewStatus !== "excluded" &&
      line.quantity * line.multiplier > 0 &&
      (!line.alternateId || alternates.has(line.alternateId)),
  );
}
async function lockEvidenceJob(tx: Transaction, estimate: EstimateRow) {
  // Room mutations take the detection lock first. Drawings take the job lock
  // before writing source metadata; keep the same order before the estimate row.
  if (
    includedLines(estimate.document).some((line) => line.source.kind === "room")
  )
    await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${estimate.jobId},4151))`,
  );
}
async function validateCurrentEvidence(tx: Transaction, estimate: EstimateRow) {
  await validateReferences(
    tx,
    estimate.organizationId,
    estimate.jobId,
    estimate.document,
  );
  const lines = includedLines(estimate.document);
  if (
    !lines.some((line) =>
      ["drawing-measurement", "drawing-schedule", "room"].includes(
        line.source.kind,
      ),
    )
  )
    return;
  const { validateDrawingEvidence } = await import("./drawing-analysis");
  const warnings = await validateDrawingEvidence({
    db: tx as unknown as typeof database,
    organizationId: estimate.organizationId,
    jobId: estimate.jobId,
    lines,
    lock: true,
  });
  if (warnings.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Drawing evidence changed. Regenerate and review the source before approval: ${warnings.slice(0, 3).join(" ")}`,
    });
}

/** The service boundary also protects HTTP exports outside tRPC. */
export function assertEstimateAccess(ctx: EstimateContext, edit = false) {
  if (!ctx.userId || ctx.user.id !== ctx.userId)
    throw new TRPCError({ code: "UNAUTHORIZED" });
  if (
    !ctx.user.organizationId ||
    (ctx.user.organizationAccessStatus &&
      ctx.user.organizationAccessStatus !== "approved")
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Approved organization access is required.",
    });
  }
  assertCan(ctx.user, "tab.estimating");
  assertCan(
    ctx.user,
    "financial.view",
    "Dollar values are hidden for your account.",
  );
  if (edit) assertCan(ctx.user, "estimating.edit");
  return ctx.user.organizationId;
}
function auditIdentity(ctx: EstimateContext) {
  const actor = ctx.actorUser ?? ctx.user;
  if (
    ctx.simulation &&
    (ctx.simulation.actorId !== actor.id ||
      ctx.simulation.employeeId !== ctx.userId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The simulation identity changed. Reload this estimate.",
    });
  }
  return {
    actorId: actor.id,
    actorName: actor.name ?? actor.email,
    effectiveUserId: ctx.userId,
    effectiveUserName: ctx.user.name ?? ctx.user.email,
    simulationId: ctx.simulation?.id ?? null,
  };
}
function assertRevision(row: { revision: number }, expected: number) {
  revisionSchema.parse(expected);
  if (row.revision !== expected)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This estimate changed. Reload it before saving.",
    });
}
function assertMutable(row: { status: EstimateStatus }) {
  if (!mutable.has(row.status))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This estimate is locked. Duplicate it or restore a revision to create a draft.",
    });
}
function parseDocument(document: EstimateDocument): EstimateDocument {
  const parsed = estimateDocumentSchema.parse(document);
  if (Buffer.byteLength(JSON.stringify(parsed)) > MAX_DOCUMENT_BYTES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "The estimate document is too large.",
    });
  for (const values of [
    parsed.lines.map((line) => line.id),
    parsed.alternates.map((a) => a.id),
  ]) {
    if (new Set(values).size !== values.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Estimate lines and alternates must have unique IDs.",
      });
  }
  const alternates = new Set(parsed.alternates.map((a) => a.id));
  if (
    parsed.lines.some(
      (line) => line.alternateId && !alternates.has(line.alternateId),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An estimate line references an unknown alternate.",
    });
  return parsed;
}
async function requireJob(
  reader: Reader,
  organizationId: string,
  jobId: string,
) {
  uuid.parse(jobId);
  const [job] = await reader.execute<{
    id: string;
    name: string;
    companyName: string | null;
  }>(
    sql`select j.id,j.name,o.name as "companyName" from kublai_job j join kublai_organization o on o.id=j."organizationId" where j.id=${jobId}::uuid and j."organizationId"=${organizationId}::uuid limit 1`,
  );
  if (!job)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  return job;
}
async function requireEstimate(
  reader: Reader,
  organizationId: string,
  id: string,
  lock = false,
) {
  uuid.parse(id);
  const query = reader
    .select()
    .from(estimates)
    .where(
      and(eq(estimates.id, id), eq(estimates.organizationId, organizationId)),
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found." });
  return row;
}
async function record(
  reader: Reader,
  row: EstimateRow,
): Promise<EstimateRecord> {
  const job = await requireJob(reader, row.organizationId, row.jobId);
  return {
    id: row.id,
    jobId: row.jobId,
    jobName: job.name,
    companyName: job.companyName,
    name: row.name,
    status: row.status,
    revision: row.revision,
    document: estimateDocumentSchema.parse(row.document),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByName: row.createdByName,
  };
}
async function appendAudit(
  tx: Transaction,
  ctx: EstimateContext,
  row: EstimateRow,
  action: string,
) {
  await tx.insert(estimateRevisions).values({
    estimateId: row.id,
    organizationId: row.organizationId,
    revision: row.revision,
    name: row.name,
    status: row.status,
    document: row.document,
    summary: row.summary,
    action,
    ...auditIdentity(ctx),
  });
}

async function validateReferences(
  reader: Reader,
  organizationId: string,
  jobId: string,
  document: EstimateDocument,
) {
  const sheets = [
    ...new Set([
      ...document.selectedSheetIds,
      ...document.lines.flatMap((line) =>
        line.source.sheetId ? [line.source.sheetId] : [],
      ),
    ]),
  ];
  const floors = [
    ...new Set(
      document.lines.flatMap((line) =>
        line.source.floorId ? [line.source.floorId] : [],
      ),
    ),
  ];
  const partIds = [
    ...new Set(
      document.lines.flatMap((line) =>
        line.partDefinitionId ? [line.partDefinitionId] : [],
      ),
    ),
  ];
  const supplierIds = [
    ...new Set(
      document.lines.flatMap((line) =>
        line.supplierPartId ? [line.supplierPartId] : [],
      ),
    ),
  ];
  for (const ids of [sheets, floors, partIds, supplierIds])
    z.array(uuid).parse(ids);
  const checks = await Promise.all([
    sheets.length
      ? reader.execute<{ id: string }>(
          sql`select id from kublai_job_drawing_sheet where id in (${sql.join(
            sheets.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}) and "organizationId"=${organizationId}::uuid and "jobId"=${jobId}::uuid`,
        )
      : [],
    floors.length
      ? reader.execute<{ id: string }>(
          sql`select id from kublai_job_floor where id in (${sql.join(
            floors.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}) and "jobId"=${jobId}::uuid and "organizationId"=${organizationId}::uuid`,
        )
      : [],
    partIds.length
      ? reader.execute<{ id: string }>(
          sql`select id from kublai_part_definition where id in (${sql.join(
            partIds.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}) and "organizationId"=${organizationId}::uuid`,
        )
      : [],
    supplierIds.length
      ? reader.execute<{ id: string; partDefinitionId: string }>(
          sql`select sp.id,sp."partDefinitionId" from kublai_supplier_part sp join kublai_supplier s on s.id=sp."supplierId" and s."organizationId"=sp."organizationId" join kublai_part_definition p on p.id=sp."partDefinitionId" and p."organizationId"=sp."organizationId" where sp.id in (${sql.join(
            supplierIds.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}) and sp."organizationId"=${organizationId}::uuid`,
        )
      : [],
  ]);
  if (
    checks.some(
      (rows, i) =>
        rows.length !== [sheets, floors, partIds, supplierIds][i]!.length,
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Estimate references must belong to this organization and job.",
    });
  }
  const suppliers = checks[3] as { id: string; partDefinitionId: string }[];
  if (
    document.lines.some(
      (line) =>
        line.supplierPartId &&
        line.partDefinitionId &&
        suppliers.find((sp) => sp.id === line.supplierPartId)
          ?.partDefinitionId !== line.partDefinitionId,
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A supplier price references a different part.",
    });
  }
}

export async function listEstimateJobs(ctx: EstimateContext) {
  const org = assertEstimateAccess(ctx);
  return Array.from(
    await ctx.db.execute<{ id: string; name: string }>(
      sql`select id,name from kublai_job where "organizationId"=${org}::uuid order by lower(name),id`,
    ),
  );
}
export async function listEstimates(
  ctx: EstimateContext,
  input: {
    jobId?: string;
    status?: EstimateStatus;
    search?: string;
    limit?: number;
    cursor?: { updatedAt: string; id: string };
  } = {},
): Promise<{
  items: EstimateListRecord[];
  nextCursor: { updatedAt: string; id: string } | null;
}> {
  const org = assertEstimateAccess(ctx);
  if (input.jobId) await requireJob(ctx.db, org, input.jobId);
  const search = z.string().max(300).optional().parse(input.search)?.trim();
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 50);
  const cursor = input.cursor
    ? z
        .object({ updatedAt: z.string().datetime(), id: uuid })
        .parse(input.cursor)
    : null;
  const rows = await ctx.db.execute<
    EstimateListRecord & { cursorTime: string }
  >(sql`select e.id,e."jobId",j.name as "jobName",o.name as "companyName",e.name,e.status,e.revision,e.summary,e."createdAt",e."updatedAt",e."createdByName",
    to_char(e."updatedAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorTime"
    from kublai_estimate e join kublai_job j on j.id=e."jobId" and j."organizationId"=e."organizationId"
    join kublai_organization o on o.id=e."organizationId"
    where e."organizationId"=${org}::uuid ${input.jobId ? sql`and e."jobId"=${input.jobId}::uuid` : sql``}
    ${input.status ? sql`and e.status=${input.status}` : sql``} ${search ? sql`and (position(lower(${search}) in lower(e.name))>0 or position(lower(${search}) in lower(j.name))>0)` : sql``}
    ${cursor ? sql`and (e."updatedAt",e.id)<(${cursor.updatedAt}::timestamptz,${cursor.id}::uuid)` : sql``}
    order by e."updatedAt" desc,e.id desc limit ${limit + 1}`);
  const selected = Array.from(rows).slice(0, limit),
    last = selected.at(-1);
  return {
    items: selected.map(({ cursorTime: _cursorTime, ...row }) => row),
    nextCursor:
      rows.length > limit && last
        ? { updatedAt: last.cursorTime, id: last.id }
        : null,
  };
}
export async function getEstimate(
  ctx: EstimateContext,
  id: string,
): Promise<EstimateRecord> {
  return record(
    ctx.db,
    await requireEstimate(ctx.db, assertEstimateAccess(ctx), id),
  );
}
export async function createEstimate(
  ctx: EstimateContext,
  input: { jobId: string; name: string; document?: EstimateDocument },
) {
  const org = assertEstimateAccess(ctx, true);
  const name = nameSchema.parse(input.name),
    document = parseDocument(input.document ?? newEstimateDocument());
  return ctx.db.transaction(async (tx) => {
    await requireJob(tx, org, input.jobId);
    await validateReferences(tx, org, input.jobId, document);
    const [row] = await tx
      .insert(estimates)
      .values({
        organizationId: org,
        jobId: input.jobId,
        name,
        document,
        summary: estimateSummary(document),
        createdByUserId: ctx.userId,
        createdByName: ctx.user.name ?? ctx.user.email,
      })
      .returning();
    await appendAudit(tx, ctx, row!, "created");
    return record(tx, row!);
  });
}
async function changeEstimate(
  ctx: EstimateContext,
  input: { id: string; expectedRevision: number },
  action: string,
  change: (
    tx: Transaction,
    current: EstimateRow,
  ) => Promise<{
    name?: string;
    document?: EstimateDocument;
    status?: EstimateStatus;
  }>,
  options: { immutable?: boolean; approval?: boolean } = {},
) {
  const org = assertEstimateAccess(ctx, !options.approval);
  if (options.approval) assertCan(ctx.user, "estimating.approve");
  const evidenceSnapshot = options.approval
    ? await requireEstimate(ctx.db, org, input.id)
    : null;
  return ctx.db.transaction(async (tx) => {
    if (evidenceSnapshot) await lockEvidenceJob(tx, evidenceSnapshot);
    const row = await requireEstimate(tx, org, input.id, true);
    assertRevision(row, input.expectedRevision);
    if (!options.immutable) assertMutable(row);
    const changes = await change(tx, row);
    if (changes.document) {
      changes.document = parseDocument(changes.document);
      await validateReferences(tx, org, row.jobId, changes.document);
    }
    const [updated] = await tx
      .update(estimates)
      .set({
        ...changes,
        summary: estimateSummary(changes.document ?? row.document),
        revision: row.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(estimates.id, row.id),
          eq(estimates.organizationId, org),
          eq(estimates.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This estimate changed. Reload it before saving.",
      });
    await appendAudit(tx, ctx, updated, action);
    return record(tx, updated);
  });
}
export function saveEstimate(
  ctx: EstimateContext,
  input: {
    id: string;
    expectedRevision: number;
    name?: string;
    document: EstimateDocument;
  },
) {
  return changeEstimate(ctx, input, "saved", async () => ({
    document: input.document,
    ...(input.name === undefined ? {} : { name: nameSchema.parse(input.name) }),
  }));
}
export function setEstimateStatus(
  ctx: EstimateContext,
  input: { id: string; expectedRevision: number; status: EstimateStatus },
) {
  const approval = input.status === "approved" || input.status === "sent";
  const transitions: Record<EstimateStatus, EstimateStatus[]> = {
    draft: ["in_review", "approved", "archived"],
    in_review: ["draft", "approved", "archived"],
    approved: ["sent", "archived"],
    sent: ["won", "lost", "archived"],
    won: ["archived"],
    lost: ["archived"],
    archived: [],
  };
  return changeEstimate(
    ctx,
    input,
    `status:${input.status}`,
    async (tx, row) => {
      if (!transitions[row.status].includes(input.status))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This status transition is unavailable. Restore a revision to create a draft.",
        });
      if (approval) {
        await validateCurrentEvidence(tx, row);
        if (!estimateSummary(row.document).readiness.ready)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Review all included source evidence, replace simulated or missing costs, and resolve estimate warnings before approval or sending.",
          });
      }
      return { status: input.status };
    },
    { immutable: true, approval },
  );
}
export async function estimateHistory(
  ctx: EstimateContext,
  input: { id: string; limit?: number; beforeRevision?: number },
): Promise<{
  items: EstimateHistoryEntry[];
  nextBeforeRevision: number | null;
}> {
  const org = assertEstimateAccess(ctx);
  uuid.parse(input.id);
  const [estimate] = await ctx.db
    .select({ id: estimates.id })
    .from(estimates)
    .where(and(eq(estimates.id, input.id), eq(estimates.organizationId, org)))
    .limit(1);
  if (!estimate)
    throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found." });
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 50);
  const before =
    input.beforeRevision === undefined
      ? undefined
      : z.number().int().positive().parse(input.beforeRevision);
  const rows = await ctx.db
    .execute<EstimateHistoryEntry>(sql`select id,revision,name,status,summary,"actorName","actorId","effectiveUserId","effectiveUserName","simulationId","createdAt",action
    from kublai_estimate_revision where "estimateId"=${input.id}::uuid and "organizationId"=${org}::uuid
      ${before === undefined ? sql`` : sql`and revision<${before}`} order by revision desc limit ${limit + 1}`);
  const items = Array.from(rows).slice(0, limit);
  return {
    items,
    nextBeforeRevision:
      rows.length > limit ? (items.at(-1)?.revision ?? null) : null,
  };
}
export function restoreEstimate(
  ctx: EstimateContext,
  input: { id: string; expectedRevision: number; eventId: string },
) {
  uuid.parse(input.eventId);
  return changeEstimate(
    ctx,
    input,
    "restored",
    async (tx, row) => {
      const [event] = await tx
        .select()
        .from(estimateRevisions)
        .where(
          and(
            eq(estimateRevisions.id, input.eventId),
            eq(estimateRevisions.estimateId, row.id),
            eq(estimateRevisions.organizationId, row.organizationId),
          ),
        )
        .limit(1);
      if (!event)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Estimate revision not found.",
        });
      return { name: event.name, document: event.document, status: "draft" };
    },
    { immutable: true },
  );
}
export async function duplicateEstimate(
  ctx: EstimateContext,
  input: { id: string; name?: string },
) {
  const org = assertEstimateAccess(ctx, true);
  return ctx.db.transaction(async (tx) => {
    const source = await requireEstimate(tx, org, input.id, true);
    const [row] = await tx
      .insert(estimates)
      .values({
        organizationId: org,
        jobId: source.jobId,
        name: nameSchema.parse(
          input.name ?? `${source.name.slice(0, 248)} (copy)`,
        ),
        status: "draft",
        document: source.document,
        summary: estimateSummary(source.document),
        createdByUserId: ctx.userId,
        createdByName: ctx.user.name ?? ctx.user.email,
      })
      .returning();
    await appendAudit(tx, ctx, row!, `duplicated:${source.id}`);
    return record(tx, row!);
  });
}

export async function getEstimatingPricing(ctx: EstimateContext) {
  const org = assertEstimateAccess(ctx);
  const [row] = await ctx.db
    .select()
    .from(estimatingPricing)
    .where(eq(estimatingPricing.organizationId, org))
    .limit(1);
  return {
    revision: row?.revision ?? 0,
    rows: row?.rows ?? [],
    assemblies: row?.assemblies ?? [],
  };
}
export async function saveEstimatingPricing(
  ctx: EstimateContext,
  input: {
    expectedRevision: number;
    rows?: PricingRow[];
    assemblies?: EstimateAssembly[];
  },
) {
  const org = assertEstimateAccess(ctx, true);
  z.number().int().min(0).max(2_147_483_646).parse(input.expectedRevision);
  const rows =
    input.rows === undefined
      ? undefined
      : z.array(pricingRowSchema).max(10000).parse(input.rows);
  const assemblies =
    input.assemblies === undefined
      ? undefined
      : z.array(assemblySchema).max(500).parse(input.assemblies);
  for (const values of [
    rows?.map((row) => row.id),
    assemblies?.map((assembly) => assembly.id),
  ]) {
    if (values && new Set(values).size !== values.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Pricing rows and assemblies must have unique IDs.",
      });
  }
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${org}, 4661))`,
    );
    const [current] = await tx
      .select()
      .from(estimatingPricing)
      .where(eq(estimatingPricing.organizationId, org))
      .limit(1)
      .for("update");
    if ((current?.revision ?? 0) !== input.expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Company pricing changed. Reload it before saving.",
      });
    const combinedRows = rows ?? current?.rows ?? [],
      combinedAssemblies = assemblies ?? current?.assemblies ?? [];
    let pricingBytes = Buffer.byteLength('{"rows":[],"assemblies":[]}');
    for (const value of [...combinedRows, ...combinedAssemblies]) {
      pricingBytes += Buffer.byteLength(JSON.stringify(value)) + 1;
      if (pricingBytes > MAX_DOCUMENT_BYTES)
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message:
            "Company pricing and assemblies exceed the 8 MB storage limit. Split or reduce this library before saving.",
        });
    }
    const lines = combinedAssemblies.flatMap((assembly) => assembly.lines);
    const partIds = [
        ...new Set(
          lines.flatMap((line) =>
            line.partDefinitionId ? [line.partDefinitionId] : [],
          ),
        ),
      ],
      supplierIds = [
        ...new Set(
          lines.flatMap((line) =>
            line.supplierPartId ? [line.supplierPartId] : [],
          ),
        ),
      ];
    for (const ids of [partIds, supplierIds]) z.array(uuid).parse(ids);
    const [parts, supplierRows] = await Promise.all([
      partIds.length
        ? tx.execute<{ id: string }>(
            sql`select id from kublai_part_definition where "organizationId"=${org}::uuid and id in (${sql.join(
              partIds.map((id) => sql`${id}::uuid`),
              sql`,`,
            )})`,
          )
        : [],
      supplierIds.length
        ? tx.execute<{ id: string; partDefinitionId: string }>(
            sql`select sp.id,sp."partDefinitionId" from kublai_supplier_part sp join kublai_part_definition p on p.id=sp."partDefinitionId" and p."organizationId"=sp."organizationId" join kublai_supplier s on s.id=sp."supplierId" and s."organizationId"=sp."organizationId" where sp."organizationId"=${org}::uuid and sp.id in (${sql.join(
              supplierIds.map((id) => sql`${id}::uuid`),
              sql`,`,
            )})`,
          )
        : [],
    ]);
    const suppliersById = new Map(supplierRows.map((row) => [row.id, row]));
    if (
      parts.length !== partIds.length ||
      supplierRows.length !== supplierIds.length ||
      lines.some(
        (line) =>
          line.supplierPartId &&
          line.partDefinitionId &&
          suppliersById.get(line.supplierPartId)?.partDefinitionId !==
            line.partDefinitionId,
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Assembly catalogue and supplier references must belong to this organization and the same part.",
      });
    const next = {
      organizationId: org,
      revision: input.expectedRevision + 1,
      rows: combinedRows,
      assemblies: combinedAssemblies,
      updatedAt: new Date(),
    };
    const [saved] = await tx
      .insert(estimatingPricing)
      .values(next)
      .onConflictDoUpdate({
        target: estimatingPricing.organizationId,
        set: next,
      })
      .returning();
    await tx.insert(estimatingPricingRevisions).values({
      organizationId: org,
      revision: next.revision,
      rows: next.rows,
      assemblies: next.assemblies,
      ...auditIdentity(ctx),
    });
    return {
      revision: saved!.revision,
      rows: saved!.rows,
      assemblies: saved!.assemblies,
    };
  });
}
function withWarnings(document: EstimateDocument, warnings: string[]) {
  const additions = [...new Set(warnings)].filter(
    (warning) => !document.assumptions.includes(warning),
  );
  if (!additions.length) return document;
  const assumptions = [
    document.assumptions,
    ...additions.map((warning) => `Estimating review: ${warning}`),
  ]
    .filter(Boolean)
    .join("\n");
  if (assumptions.length > 20000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message:
        "Review notes are full. Shorten the assumptions before importing more evidence.",
    });
  return { ...document, assumptions };
}
export function applyEstimatePricing(
  ctx: EstimateContext,
  input: { id: string; expectedRevision: number },
) {
  return changeEstimate(ctx, input, "pricing-applied", async (tx, row) => {
    const [pricing] = await tx
      .select()
      .from(estimatingPricing)
      .where(eq(estimatingPricing.organizationId, row.organizationId))
      .limit(1);
    const matched = matchEstimatePricing(
      row.document.lines,
      pricing?.rows ?? [],
      { currency: row.document.settings.currency },
    );
    return {
      document: withWarnings(
        { ...row.document, lines: matched.lines },
        matched.warnings,
      ),
    };
  });
}

export async function estimateResources(ctx: EstimateContext, jobId: string) {
  const org = assertEstimateAccess(ctx);
  await requireJob(ctx.db, org, jobId);
  const [sheets, materialLists, prefabs] = await Promise.all([
    ctx.db.execute<{
      id: string;
      name: string;
      setId: string;
      sortOrder: number;
      imageUrl: string;
      metadata: { number?: string; title?: string } | null;
      workspaceRevision: number | null;
    }>(
      sql`select s.id,s.name,s."setId",s."sortOrder",s."imageUrl",m.data as metadata,m.revision as "workspaceRevision" from kublai_job_drawing_sheet s left join kublai_drawing_workspace_metadata m on m."sheetId"=s.id where s."organizationId"=${org}::uuid and s."jobId"=${jobId}::uuid order by s."sortOrder",s."createdAt"`,
    ),
    ctx.db.execute<{ id: string; name: string }>(
      sql`select id,name from kublai_material_list where "organizationId"=${org}::uuid and "jobId"=${jobId}::uuid and kind='materials' order by lower(name),id`,
    ),
    ctx.db.execute<{ id: string; name: string }>(
      sql`select id,name from kublai_material_prefab where "organizationId"=${org}::uuid order by lower(name),id`,
    ),
  ]);
  return {
    sheets: Array.from(sheets, (sheet) => ({
      id: sheet.id,
      setId: sheet.setId,
      number: usableText(sheet.metadata?.number, sheet.name),
      title: usableText(sheet.metadata?.title, sheet.name),
      pageNumber: Number(
        /floor-(\d+)\.(?:webp|png|jpe?g)(?:$|[?#])/.exec(sheet.imageUrl)?.[1] ??
          sheet.sortOrder + 1,
      ),
      revision: String(sheet.workspaceRevision ?? 0),
    })),
    materialLists: Array.from(materialLists),
    prefabs: Array.from(prefabs),
  };
}

type PriceRow = {
  partDefinitionId: string | null;
  supplierPartId: string | null;
  description: string;
  unit: string | null;
  supplierName: string | null;
  quantity?: string;
  unitCost: string | null;
  packSize: string | null;
  priceNotes: string | null;
  itemNotes?: string | null;
  catalogName?: string | null;
  evidenceDate?: Date | string | null;
  currency?: string | null;
};
export function storedPriceIsSimulated(
  ...notes: (string | null | undefined)[]
) {
  return notes.some((note) =>
    /\[foremanhq-estimate-v\d[^\]]*\]|SIMULATED ESTIMATE ONLY/i.test(
      note ?? "",
    ),
  );
}
function amountOrMissing(value: string | null) {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100_000_000
    ? number
    : null;
}
function priceLine(
  row: PriceRow,
  source: EstimateLine["source"],
  quantity = 1,
): EstimateLine {
  const currency = z
    .enum(["CAD", "USD", "GBP", "EUR"])
    .safeParse(row.currency ?? "CAD");
  const materialUnitCost = currency.success
    ? amountOrMissing(row.unitCost)
    : null;
  const simulated = storedPriceIsSimulated(row.priceNotes, row.itemNotes);
  const notes = [
    row.itemNotes,
    row.priceNotes,
    currency.success
      ? ""
      : `Unsupported supplier currency: ${row.currency}. Enter pricing in the estimate currency.`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
  return estimateLineSchema.parse({
    id: randomUUID(),
    description: usableText(row.description, "Unnamed material"),
    quantity,
    unit: usableText(row.unit, "ea"),
    priceCurrency: currency.success ? currency.data : undefined,
    materialUnitCost,
    supplierName: row.supplierName ?? "",
    partDefinitionId: row.partDefinitionId ?? undefined,
    supplierPartId: row.supplierPartId ?? undefined,
    orderMultiple: amountOrMissing(row.packSize),
    priceSource:
      materialUnitCost === null
        ? "missing"
        : simulated
          ? "simulated"
          : source.kind === "catalogue" || source.kind === "assembly"
            ? "supplier"
            : "imported",
    priceUpdatedAt: row.evidenceDate
      ? new Date(row.evidenceDate).toISOString()
      : undefined,
    reviewStatus: "unreviewed",
    source,
    notes,
  });
}
export async function estimateCatalogue(
  ctx: EstimateContext,
  input: { search: string; limit?: number },
) {
  const org = assertEstimateAccess(ctx);
  const limit = z
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(input.limit ?? 50),
    search = z.string().max(300).parse(input.search).trim();
  const rows = await ctx.db
    .execute<PriceRow>(sql`select p.id as "partDefinitionId",sp.id as "supplierPartId",p."displayName" as description,
    'ea' as unit,s.name as "supplierName",sp."lastKnownUnitCost" as "unitCost",sp."packSize",sp.notes as "priceNotes",c.name as "catalogName",sp.currency
    from kublai_part_definition p join kublai_catalog c on c.id=p."catalogId" and c."organizationId"=p."organizationId" and c.kind='materials'
    left join kublai_supplier_part sp on sp."partDefinitionId"=p.id and sp."organizationId"=p."organizationId"
    left join kublai_supplier s on s.id=sp."supplierId" and s."organizationId"=p."organizationId"
    where p."organizationId"=${org}::uuid and p."isActive" and (sp.id is null or s.id is not null)
      ${search ? sql`and (position(lower(${search}) in lower(p."displayName"))>0 or position(lower(${search}) in lower(coalesce(sp."supplierSku",'')))>0)` : sql``}
    order by p."displayName",sp."isPreferred" desc nulls last,sp.id limit ${limit}`);
  return Array.from(rows, (row) =>
    priceLine(row, {
      kind: "catalogue",
      label: row.catalogName ?? undefined,
      evidence: storedPriceIsSimulated(row.priceNotes)
        ? "SIMULATED ESTIMATE ONLY. Replace this allowance with verified supplier pricing."
        : "Stored supplier price. Verify its unit and quotation date before approval.",
    }),
  );
}
export function importEstimateMaterialList(
  ctx: EstimateContext,
  input: { id: string; expectedRevision: number; materialListId: string },
) {
  uuid.parse(input.materialListId);
  return changeEstimate(
    ctx,
    input,
    "material-list-imported",
    async (tx, estimate) => {
      const [list] = await tx.execute<{
        id: string;
        name: string;
        quoteId: string | null;
      }>(
        sql`select id,name,"quoteId" from kublai_material_list where id=${input.materialListId}::uuid and "organizationId"=${estimate.organizationId}::uuid and "jobId"=${estimate.jobId}::uuid and kind='materials' limit 1`,
      );
      if (!list)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found in this job.",
        });
      const rows = list.quoteId
        ? await tx.execute<
            PriceRow & { itemId: string }
          >(sql`select qi.id as "itemId",p.id as "partDefinitionId",sp.id as "supplierPartId",
      coalesce(qi."descriptionSnapshot",p."displayName",qi."oneOffDisplayName",'Unnamed material') as description,u.code as unit,
      s.name as "supplierName",qi.quantity,qi."unitCost",sp."packSize",sp.notes as "priceNotes",qi.notes as "itemNotes",qi."updatedAt" as "evidenceDate",sp.currency
      from kublai_quote_item qi join kublai_quote q on q.id=qi."quoteId" and q."organizationId"=${estimate.organizationId}::uuid and q."jobId"=${estimate.jobId}::uuid
      left join kublai_part_definition p on p.id=qi."partDefinitionId" and p."organizationId"=${estimate.organizationId}::uuid
      left join kublai_supplier_part sp on sp.id=qi."supplierPartId" and sp."organizationId"=${estimate.organizationId}::uuid and sp."partDefinitionId"=p.id
      left join kublai_supplier s on s.id=sp."supplierId" and s."organizationId"=${estimate.organizationId}::uuid
      left join kublai_unit u on u.id=qi."uomId" where qi."quoteId"=${list.quoteId}::uuid order by qi."createdAt",qi.id limit 2001`)
        : [];
      const lines = rows
        .filter(
          (row) =>
            !estimate.document.lines.some(
              (line) =>
                line.source.kind === "material-list" &&
                line.source.markupId === row.itemId &&
                line.source.label === list.id,
            ),
        )
        .map((row) =>
          priceLine(
            row,
            {
              kind: "material-list",
              label: list.id,
              markupId: row.itemId,
              evidence: `Material list: ${list.name}. Quantities and cost evidence require review.`,
            },
            Number(row.quantity),
          ),
        );
      return {
        document: withWarnings(
          {
            ...estimate.document,
            lines: [...estimate.document.lines, ...lines],
          },
          lines.some((line) => line.priceSource === "simulated")
            ? [
                "Imported material list includes simulated price allowances. Replace them before approval.",
              ]
            : [],
        ),
      };
    },
  );
}
export function importEstimatePrefab(
  ctx: EstimateContext,
  input: {
    id: string;
    expectedRevision: number;
    prefabId: string;
    quantity: number;
  },
) {
  uuid.parse(input.prefabId);
  z.number().finite().positive().max(1000000).parse(input.quantity);
  return changeEstimate(ctx, input, "prefab-imported", async (tx, estimate) => {
    const [prefab] = await tx.execute<{ name: string }>(
      sql`select name from kublai_material_prefab where id=${input.prefabId}::uuid and "organizationId"=${estimate.organizationId}::uuid limit 1`,
    );
    if (!prefab)
      throw new TRPCError({ code: "NOT_FOUND", message: "Prefab not found." });
    const rows =
      await tx.execute<PriceRow>(sql`select p.id as "partDefinitionId",sp.id as "supplierPartId",p."displayName" as description,'ea' as unit,s.name as "supplierName",
      i.quantity,sp."lastKnownUnitCost" as "unitCost",sp."packSize",sp.notes as "priceNotes",sp.currency from kublai_material_prefab_item i
      join kublai_part_definition p on p.id=i."partDefinitionId" and p."organizationId"=${estimate.organizationId}::uuid
      left join kublai_supplier_part sp on sp.id=i."supplierPartId" and sp."partDefinitionId"=p.id and sp."organizationId"=p."organizationId"
      left join kublai_supplier s on s.id=sp."supplierId" and s."organizationId"=p."organizationId"
      where i."prefabId"=${input.prefabId}::uuid and (sp.id is null or s.id is not null) order by p."displayName",i.id limit 2001`);
    const lines = Array.from(rows, (row) =>
      priceLine(
        row,
        {
          kind: "assembly",
          label: prefab.name,
          evidence: `Prefab ${input.prefabId}; multiplied by ${input.quantity}. Review quantities and costs.`,
        },
        Number(row.quantity) * input.quantity,
      ),
    );
    return {
      document: withWarnings(
        { ...estimate.document, lines: [...estimate.document.lines, ...lines] },
        lines.some((line) => line.priceSource === "simulated")
          ? [
              "Imported prefab includes simulated price allowances. Replace them before approval.",
            ]
          : [],
      ),
    };
  });
}
/** Prepare an ordinary editable job materials list; this never creates or sends an order. */
export async function handoffEstimateMaterialList(
  ctx: EstimateContext,
  input: { id: string; expectedRevision: number },
) {
  const org = assertEstimateAccess(ctx, true);
  assertCan(ctx.user, "lists.edit");
  const evidenceSnapshot = await requireEstimate(ctx.db, org, input.id);
  return ctx.db.transaction(async (tx) => {
    await lockEvidenceJob(tx, evidenceSnapshot);
    const estimate = await requireEstimate(tx, org, input.id, true);
    if (estimate.status !== "approved" && estimate.status !== "won")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Approve or win this estimate before preparing its materials.",
      });
    const [prior] = await tx.execute<{
      action: string;
    }>(sql`select action from kublai_estimate_revision
      where "estimateId"=${estimate.id}::uuid and "organizationId"=${org}::uuid and action like 'material-list-prepared:%'
        and revision >= coalesce((select max(revision) from kublai_estimate_revision where "estimateId"=${estimate.id}::uuid and "organizationId"=${org}::uuid and action='status:approved'),0)
      order by revision desc limit 1`);
    if (prior) {
      const materialListId = prior.action.slice(
        "material-list-prepared:".length,
      );
      const [existing] = await tx.execute<{ id: string }>(
        sql`select id from kublai_material_list where id=${materialListId}::uuid and "organizationId"=${org}::uuid and "jobId"=${estimate.jobId}::uuid`,
      );
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "The previously prepared material list was deleted. Restore and approve a new estimate revision to prepare another list.",
        });
      return {
        estimate: await record(tx, estimate),
        materialListId,
        warnings: [] as string[],
        created: false,
      };
    }
    assertRevision(estimate, input.expectedRevision);
    if (estimate.document.settings.currency !== "CAD")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Job material lists currently store CAD costs. Prepare a CAD estimate with verified CAD pricing before handing off materials.",
      });
    await validateCurrentEvidence(tx, estimate);
    const calculation = calculateEstimate(estimate.document);
    if (!calculation.readiness.ready)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Resolve the current estimate warnings before preparing materials.",
      });
    const unitRows = await tx.execute<{ id: string; code: string }>(
      sql`select id,code from kublai_unit order by id`,
    );
    const supplierIds = [
      ...new Set(
        estimate.document.lines.flatMap((line) =>
          line.supplierPartId ? [line.supplierPartId] : [],
        ),
      ),
    ];
    const supplierPacks = supplierIds.length
      ? await tx.execute<{ id: string; packSize: string | null }>(
          sql`select id,"packSize" from kublai_supplier_part where "organizationId"=${org}::uuid and id in (${sql.join(
            supplierIds.map((id) => sql`${id}::uuid`),
            sql`,`,
          )})`,
        )
      : [];
    const packParts = await tx.execute<{id: string; piecesPerPack: number | null}>(sql`select id, "piecesPerPack" from kublai_part_definition where "organizationId"=${org}::uuid and "piecesPerPack" is not null`);
    const packContentsByPart = new Map(packParts.map(part => [part.id, part.piecesPerPack]));
    const warnings: string[] = [];
    type MaterialDemand = {
      partDefinitionId: string;
      supplierPartId: string | null;
      uomId: string | null;
      quantity: number;
      unitCost: number;
      orderMultiple: number | null;
      description: string;
      notes: string;
    };
    const groups = new Map<string, MaterialDemand>();
    let excluded = 0;
    for (const line of calculation.lines) {
      if (!line.included || line.requiredQuantity <= 0) continue;
      if (!line.partDefinitionId) {
        excluded++;
        continue;
      }
      const normalizedUnit = normalizeUnit(line.unit);
      const unit = Array.from(unitRows).find(
        (row) => normalizeUnit(row.code) === normalizedUnit,
      );
      if (!unit && normalizedUnit !== "ea") {
        warnings.push(
          `${line.description}: ${line.unit} has no matching materials unit and was excluded.`,
        );
        continue;
      }
      if (line.materialUnitCost === null)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Material pricing is missing.",
        });
      const storedPack = line.supplierPartId
        ? amountOrMissing(
            supplierPacks.find((row) => row.id === line.supplierPartId)
              ?.packSize ?? null,
          )
        : null;
      if ((storedPack ?? 0) !== (line.orderMultiple ?? 0))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${line.description}: the estimate order multiple differs from the current supplier listing. Restore a draft and verify the purchasing multiple before preparing materials.`,
        });
      const demand: MaterialDemand = {
        partDefinitionId: line.partDefinitionId,
        supplierPartId: line.supplierPartId ?? null,
        uomId: unit?.id ?? null,
        quantity: line.requiredQuantity,
        unitCost: line.materialUnitCost,
        orderMultiple: line.orderMultiple,
        description: line.description,
        notes: `Prepared from estimate ${estimate.id}, revision ${estimate.revision}. Required quantity includes waste; purchasing multiples remain separate.`,
      };
      const key = JSON.stringify([
        demand.partDefinitionId,
        demand.supplierPartId,
        demand.uomId,
        demand.unitCost,
        demand.orderMultiple,
      ]);
      const existing = groups.get(key);
      if (existing)
        existing.quantity = numeric(
          add(decimal(existing.quantity), decimal(demand.quantity)),
        );
      else groups.set(key, demand);
    }
    if (excluded)
      warnings.push(
        `${excluded} included scope/labor lines without catalogue part links were excluded from the material list.`,
      );
    const rows = [...groups.values()];
    if (!rows.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "There are no included catalogue materials to prepare. Link material scope to catalogue parts first.",
      });
    let subtotal = 0;
    for (const row of rows) {
      if (row.quantity > 999_999.999999 || row.unitCost > 99_999_999.9999)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A material quantity or cost exceeds the job materials storage limit. Split the scope before preparing materials.",
        });
      const quantity = Number(row.quantity.toFixed(6)),
        cost = Number(row.unitCost.toFixed(4));
      if (quantity !== row.quantity || cost !== row.unitCost)
        warnings.push(
          `${row.description}: materials storage rounded quantity to six decimals and cost to four decimals.`,
        );
      row.quantity = quantity;
      row.unitCost = cost;
      subtotal += purchaseLineTotal(quantity, cost, row.orderMultiple, packContentsByPart.get(row.partDefinitionId));
    }
    if (!Number.isFinite(subtotal) || subtotal > 999_999_999_999.99)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Prepared materials exceed the material-list total limit.",
      });
    const materialListId = randomUUID(),
      quoteId = randomUUID();
    const listName = `${estimate.name.slice(0, 243)} · materials`;
    await tx.execute(sql`insert into kublai_material_list (id,"organizationId","jobId",name,"createdByUserId",kind,"createdAt","updatedAt")
      values (${materialListId}::uuid,${org}::uuid,${estimate.jobId}::uuid,${listName},${ctx.userId},'materials',now(),now())`);
    await tx.execute(sql`insert into kublai_quote (id,"organizationId","materialListId","jobId","createdByUserId","markupPercent","laborHours","laborRate",notes,"subtotalMaterials",total,"createdAt")
      values (${quoteId}::uuid,${org}::uuid,${materialListId}::uuid,${estimate.jobId}::uuid,${ctx.userId},0,0,0,${`Material planning snapshot from estimate ${estimate.id}, revision ${estimate.revision}. Pricing is in ${estimate.document.settings.currency}. No orders have been sent.`},${subtotal.toFixed(2)},${subtotal.toFixed(2)},now())`);
    const itemValues = rows.map(
      (row) =>
        sql`(${randomUUID()}::uuid,${quoteId}::uuid,${row.partDefinitionId}::uuid,${row.supplierPartId}::uuid,${row.quantity.toFixed(6)},${row.uomId}::uuid,${row.unitCost.toFixed(4)},0,${row.unitCost.toFixed(4)},${purchaseLineTotal(row.quantity, row.unitCost, row.orderMultiple, packContentsByPart.get(row.partDefinitionId)).toFixed(2)},${row.description},${row.notes},${ctx.userId},now(),now())`,
    );
    await tx.execute(
      sql`insert into kublai_quote_item (id,"quoteId","partDefinitionId","supplierPartId",quantity,"uomId","unitCost","markupPercent","unitPrice","extendedPrice","descriptionSnapshot",notes,"addedByUserId","createdAt","updatedAt") values ${sql.join(itemValues, sql`,`)}`,
    );
    await tx.execute(
      sql`update kublai_material_list set "quoteId"=${quoteId}::uuid where id=${materialListId}::uuid and "organizationId"=${org}::uuid`,
    );
    const [updated] = await tx
      .update(estimates)
      .set({ revision: estimate.revision + 1, updatedAt: new Date() })
      .where(
        and(
          eq(estimates.id, estimate.id),
          eq(estimates.organizationId, org),
          eq(estimates.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This estimate changed. Reload it before preparing materials.",
      });
    await appendAudit(
      tx,
      ctx,
      updated,
      `material-list-prepared:${materialListId}`,
    );
    return {
      estimate: await record(tx, updated),
      materialListId,
      warnings,
      created: true,
    };
  });
}

export async function analyzeEstimateDrawings(
  ctx: EstimateContext,
  input: {
    id: string;
    expectedRevision: number;
    sheetIds: string[];
    includeRooms?: boolean;
  },
) {
  const org = assertEstimateAccess(ctx, true);
  assertCan(ctx.user, "drawings.view");
  z.array(uuid).min(1).max(5).parse(input.sheetIds);
  const estimate = await requireEstimate(ctx.db, org, input.id);
  assertRevision(estimate, input.expectedRevision);
  assertMutable(estimate);
  const sheetIds = [...new Set(input.sheetIds)];
  const selected = parseDocument({
    ...estimate.document,
    selectedSheetIds: [
      ...new Set([...estimate.document.selectedSheetIds, ...sheetIds]),
    ],
  });
  await validateReferences(ctx.db, org, estimate.jobId, selected);
  const [pricing] = await ctx.db
    .select()
    .from(estimatingPricing)
    .where(eq(estimatingPricing.organizationId, org))
    .limit(1);
  const { analyzeJobDrawings } = await import("./drawing-analysis");
  // PDF reads/parsing run before opening a write transaction. The expected
  // estimate revision is checked again when applying this completed analysis.
  const result = await analyzeJobDrawings({
    db: ctx.db as typeof database,
    organizationId: org,
    jobId: estimate.jobId,
    sheetIds,
    includeRooms: input.includeRooms ?? false,
    existingLines: estimate.document.lines,
    pricingRows: pricing?.rows ?? [],
    currency: estimate.document.settings.currency,
  });
  return changeEstimate(ctx, input, "drawings-analyzed", async () => ({
    document: withWarnings(
      { ...selected, lines: [...estimate.document.lines, ...result.lines] },
      result.warnings,
    ),
  }));
}
