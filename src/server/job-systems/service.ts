import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  defaultPipeSpec,
  pipeSpecSchema,
  type PipeSpec,
} from "~/lib/pipe-spec";
import {
  mapSystemAlternative,
  mergeSystemRequirements,
  type JobSystemRequirements,
} from "~/lib/job-systems";
import { userCan } from "~/server/auth/permissions";
import { db } from "~/server/db";
import {
  catalogs,
  materials,
  partDefinitions,
  jobSystemAssessments,
  pipeSystemSpecs,
} from "~/server/db/schema";
import { assertDocumentAccess, documentActor } from "../documents/access";
import { applyDocumentAction, folderRole } from "../documents/domain";
import { mutateWorkspace, readWorkspace } from "../documents/service";
import { systemCatalogCategories as categories } from "./catalog-schema";
import { assessPassages, specificationPassages } from "./analyze";
import { extractSpecification } from "./extract";
import { specificationSources, sourceFingerprint } from "./sources";
import {
  assessmentSchema,
  type SystemsAssessment,
  type AssessmentSelection,
  type AssessmentSource,
} from "./types";
import { drawingSources, extractDrawingSource } from "./drawings";
const LEASE_MS = 20 * 60_000;
const tasks = new Map<string, Promise<void>>();
let admissions = 0;
let tail = Promise.resolve();
export function assertAssessPermission(user: Parameters<typeof userCan>[0]) {
  if (!userCan(user, "lists.edit"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Editing job material lists permission is required to assess systems.",
    });
}
export async function getSpecificationContext(
  userId: string,
  jobId: string,
  reader: Pick<typeof db, "select"> = db,
) {
  const access = await assertDocumentAccess(userId, jobId, reader);
  const state = await readWorkspace(access, reader);
  const context = specificationSources(state, access);
  const actor = documentActor(access, []);
  const readableDocumentIds = new Set(
    state.documents
      .filter(
        (d) =>
          d.jobId === jobId &&
          (!d.deletedAt || access.canManage) &&
          folderRole(state, actor, d.folderId),
      )
      .map((d) => d.id),
  );
  const allDocuments = specificationSources(state, access, true);
  const drawings = await drawingSources(reader, access);
  for (const source of drawings.sources)
    readableDocumentIds.add(source.documentId);
  return {
    access,
    state,
    ...context,
    readableDocumentIds,
    availableSources: [...allDocuments.sources, ...drawings.sources],
    drawingSets: drawings.sets,
  };
}

export function selectedAssessmentSources(
  context: Awaited<ReturnType<typeof getSpecificationContext>>,
  selection?: AssessmentSelection,
): AssessmentSource[] {
  if (!selection) return context.sources;
  const docs = new Set(selection.documentIds),
    sets = new Set(selection.drawingSetIds);
  if (
    [...docs].some(
      (id) =>
        !context.availableSources.some(
          (s) => !s.drawing && s.documentId === id,
        ),
    ) ||
    [...sets].some((id) => !context.drawingSets.some((s) => s.id === id))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A selected document or drawing set is unavailable or outside this job. Refresh the source picker.",
    });
  const sources = context.availableSources.filter((s) =>
    s.drawing ? sets.has(s.drawing.setId) : docs.has(s.documentId),
  );
  if (
    sources.filter((s) => s.drawing).length > 500 ||
    sources.filter((s) => !s.drawing).length > 20
  )
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message:
        "Choose up to 20 documents and 500 drawing sheets per assessment.",
    });
  return sources;
}
async function assertStoredSystemsReadable(
  reader: Pick<typeof db, "select">,
  organizationId: string,
  jobId: string,
  readable: ReadonlySet<string>,
  canManage: boolean,
) {
  // Managers can recover deleted document citations via readableDocumentIds.
  void canManage;
  const rows = await reader
    .select({ data: pipeSystemSpecs.data })
    .from(pipeSystemSpecs)
    .where(
      and(
        eq(pipeSystemSpecs.organizationId, organizationId),
        eq(pipeSystemSpecs.jobId, jobId),
      ),
    );
  for (const row of rows) {
    const parsed = pipeSpecSchema.safeParse(row.data);
    const req = parsed.success ? parsed.data.requirements : undefined;
    if (!req) continue;
    const refs = [
      ...req.sourceVersions,
      ...req.applicabilityEvidence,
      ...req.rules.flatMap((r) => r.evidence),
    ];
    if (refs.some((r) => !readable.has(r.documentId)))
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "An existing system uses restricted or deleted specification documents. Ask a job manager with access to assess this job; existing systems were kept.",
      });
  }
}
export async function getAssessment(userId: string, jobId: string) {
  const context = await getSpecificationContext(userId, jobId);
  const [row] = await db
    .select()
    .from(jobSystemAssessments)
    .where(
      and(
        eq(jobSystemAssessments.jobId, jobId),
        eq(
          jobSystemAssessments.organizationId,
          context.access.job.organizationId,
        ),
      ),
    )
    .limit(1);
  const parsed = assessmentSchema.safeParse(row?.data);
  let assessment = parsed.success ? parsed.data : null;
  if (
    assessment?.sources.some(
      (s) => !context.readableDocumentIds.has(s.documentId),
    )
  )
    assessment = {
      ...assessment,
      sources: [],
      selection: undefined,
      stage: "Source access restricted",
      warnings: [
        "Some assessed sources are restricted. Ask your job manager for access.",
      ],
      error:
        assessment.status === "failed"
          ? "Assessment failed. Ask your job manager to review it."
          : undefined,
    };
  if (
    assessment?.status === "processing" &&
    Date.now() - Date.parse(assessment.startedAt) > LEASE_MS
  )
    assessment = {
      ...assessment,
      status: "failed",
      error: "Assessment was interrupted. Start assessment again to retry.",
      stage: "Interrupted",
    };
  return {
    assessment,
    stale:
      !!assessment &&
      assessment.sourceFingerprint !==
        sourceFingerprint(
          assessment.selection
            ? context.availableSources.filter((s) =>
                s.drawing
                  ? assessment.selection!.drawingSetIds.includes(
                      s.drawing.setId,
                    )
                  : assessment.selection!.documentIds.includes(s.documentId),
              )
            : context.sources,
        ),
    providerConfigured: !!process.env.TYPESAFE_API_KEY,
    documents: context.availableSources
      .filter((s) => !s.drawing)
      .map((s) => ({
        id: s.documentId,
        name: s.name,
        versionId: s.versionId,
        mimeType: s.mimeType,
        inSpecifications: context.sources.some(
          (d) => d.documentId === s.documentId,
        ),
      })),
    drawingSets: context.drawingSets,
    folderId: context.folderId,
    canAssess: userCan(context.access.user, "lists.edit"),
  };
}
export async function ensureSpecifications(userId: string, jobId: string) {
  return mutateWorkspace(userId, jobId, (state, actor) => {
    const existing = state.folders.find(
      (f) =>
        f.parentId === null && f.name.trim().toLowerCase() === "specifications",
    );
    if (existing) {
      if (!folderRole(state, actor, existing.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot access Specifications.",
        });
      return { folderId: existing.id };
    }
    const result = applyDocumentAction(state, actor, {
      action: "createFolder",
      name: "Specifications",
      parentId: null,
    });
    return { folderId: result.id };
  });
}
export function retainManualEdits(
  previous: PipeSpec | undefined,
  next: PipeSpec,
): PipeSpec {
  if (!next.requirements)
    return previous?.requirements
      ? { ...next, requirements: previous.requirements }
      : next;
  const prior = previous?.requirements;
  const rules = next.requirements.rules.map((rule) => {
    const old = prior?.rules.find((r) => r.id === rule.id);
    if (!old)
      return { ...rule, origin: "manual" as const, manualOverride: true };
    const strip = (r: typeof rule) =>
      JSON.stringify({
        ...r,
        selectedAlternativeId: null,
        reviewStatus: "pending",
        manualOverride: false,
        overrideReason: null,
      });
    return strip(old) !== strip(rule)
      ? { ...rule, manualOverride: true }
      : rule;
  });
  return {
    ...next,
    requirements: {
      ...next.requirements,
      rules,
      manualName:
        next.requirements.manualName ||
        (!!prior && prior.systemName !== next.requirements.systemName),
      suppressedRuleIds: [
        ...new Set([
          ...next.requirements.suppressedRuleIds,
          ...(prior?.rules
            .filter((r) => !rules.some((n) => n.id === r.id))
            .map((r) => r.id) ?? []),
        ]),
      ],
    },
  };
}
/** Every client-provided catalog reference must be an active entry in this organization. */
export async function validateSpecReferences(
  reader: Pick<typeof db, "select">,
  organizationId: string,
  spec: PipeSpec,
) {
  const alternatives =
    spec.requirements?.rules.flatMap((r) => r.alternatives) ?? [];
  const ids = {
    materials: new Set<string>(),
    categories: new Set<string>(),
    catalogs: new Set<string>(),
    parts: new Set(Object.values(spec.parts)),
  };
  for (const group of [
    spec.pipe,
    spec.fittings,
    spec.valves,
    ...alternatives,
  ]) {
    if (group.materialId) ids.materials.add(group.materialId);
    if (group.categoryId) ids.categories.add(group.categoryId);
    if ("catalogId" in group && typeof group.catalogId === "string")
      ids.catalogs.add(group.catalogId);
  }
  for (const [key, table] of [
    ["materials", materials],
    ["categories", categories],
    ["catalogs", catalogs],
    ["parts", partDefinitions],
  ] as const) {
    const values = [...ids[key]];
    if (!values.length) continue;
    const rows = await reader
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.organizationId, organizationId),
          inArray(table.id, values),
          key === "parts" ? eq(partDefinitions.isActive, true) : undefined,
        ),
      );
    if (rows.length !== values.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "A chosen catalog entry is unavailable in your organization. Refresh the editor.",
      });
  }
}
export async function validateSpecEvidence(
  userId: string,
  jobId: string,
  spec: PipeSpec,
  previous?: PipeSpec,
  reader: Pick<typeof db, "select"> = db,
) {
  const req = spec.requirements;
  if (!req) return;
  const context = await getSpecificationContext(userId, jobId, reader);
  assertAssessPermission(context.access.user);
  const priorEvidence = [
    ...(previous?.requirements?.applicabilityEvidence ?? []),
    ...(previous?.requirements?.rules.flatMap((r) => r.evidence) ?? []),
  ];
  if (priorEvidence.some((e) => !context.readableDocumentIds.has(e.documentId)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot replace a system whose sources are restricted.",
    });
  const references = [
    ...req.applicabilityEvidence,
    ...req.rules.flatMap((r) => r.evidence),
  ];
  const known = [
    ...(previous?.requirements?.applicabilityEvidence ?? []),
    ...(previous?.requirements?.rules.flatMap((r) => r.evidence) ?? []),
  ];
  for (const e of references) {
    if (
      !context.readableDocumentIds.has(e.documentId) ||
      (!e.drawing &&
        !context.access.canManage &&
        !context.state.versions.some(
          (v) => v.documentId === e.documentId && v.id === e.versionId,
        ))
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "A source citation is no longer accessible.",
      });
    if (!known.some((k) => JSON.stringify(k) === JSON.stringify(e)))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Source citations are supplied by assessment and cannot be edited. Add a manual rule with an override reason instead.",
      });
  }
}
export async function startAssessment(
  userId: string,
  jobId: string,
  selection?: AssessmentSelection,
) {
  const context = await getSpecificationContext(userId, jobId);
  assertAssessPermission(context.access.user);
  await assertStoredSystemsReadable(
    db,
    context.access.job.organizationId,
    jobId,
    context.readableDocumentIds,
    context.access.canManage,
  );
  if (!process.env.TYPESAFE_API_KEY)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Specifications assessment is not configured. Add the server TypeSafe API key, or set up systems manually.",
    });
  const selectedSources = selectedAssessmentSources(context, selection);
  if (!selectedSources.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose at least one document or drawing set with sheets before assessing.",
    });
  if (
    selectedSources.filter((s) => !s.drawing).length > 20 ||
    selectedSources.filter((s) => s.drawing).length > 500
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose up to 20 documents and 500 drawing sheets per assessment.",
    });
  if (tasks.size + admissions >= 4)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Specification assessment is busy. Retry shortly.",
    });
  admissions++;
  try {
    const organizationId = context.access.job.organizationId;
    const task = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 74159))`,
      );
      const fresh = await getSpecificationContext(userId, jobId, tx);
      assertAssessPermission(fresh.access.user);
      const [existing] = await tx
        .select()
        .from(jobSystemAssessments)
        .where(
          and(
            eq(jobSystemAssessments.jobId, jobId),
            eq(jobSystemAssessments.organizationId, organizationId),
          ),
        )
        .limit(1);
      const prior = assessmentSchema.safeParse(existing?.data);
      if (
        prior.success &&
        prior.data.status === "processing" &&
        Date.now() - Date.parse(prior.data.startedAt) < LEASE_MS
      )
        return { assessment: prior.data, started: false };
      const assessment: SystemsAssessment = {
        runId: randomUUID(),
        status: "processing",
        startedAt: new Date().toISOString(),
        stage: "Queued",
        warnings: (selection ? [] : fresh.unsupported).map(
          (n) =>
            `${n} is a linked or unavailable document; upload its file to assess it.`,
        ),
        sources: selectedAssessmentSources(fresh, selection),
        selection,
        sourceFingerprint: sourceFingerprint(
          selectedAssessmentSources(fresh, selection),
        ),
      };
      await tx
        .insert(jobSystemAssessments)
        .values({
          id: assessment.runId,
          organizationId,
          jobId,
          requestedBy: userId,
          status: "processing",
          data: assessment,
        })
        .onConflictDoUpdate({
          target: jobSystemAssessments.jobId,
          set: {
            id: assessment.runId,
            requestedBy: userId,
            status: "processing",
            data: assessment,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      return { assessment, started: true };
    });
    if (!task.started) return { runId: task.assessment.runId };
    const assessment = task.assessment;
    const update = async (patch: Partial<SystemsAssessment>) => {
      Object.assign(assessment, patch);
      await db
        .update(jobSystemAssessments)
        .set({
          status: assessment.status,
          data: assessment,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobSystemAssessments.id, assessment.runId),
            eq(jobSystemAssessments.organizationId, organizationId),
          ),
        );
    };
    const work = tail
      .catch(() => undefined)
      .then(async () => {
        try {
          if (Date.now() - Date.parse(assessment.startedAt) > LEASE_MS)
            throw Error(
              "Assessment waited too long in the queue. Retry when the service is less busy.",
            );
          const started = Date.now();
          const guard = async () => {
            if (Date.now() - started > 15 * 60_000)
              throw Error(
                "Assessment reached its time limit. Existing systems are unchanged; split large documents and retry.",
              );
            const [active] = await db
              .select({ id: jobSystemAssessments.id })
              .from(jobSystemAssessments)
              .where(
                and(
                  eq(jobSystemAssessments.jobId, jobId),
                  eq(jobSystemAssessments.id, assessment.runId),
                ),
              );
            if (!active)
              throw Error("This assessment was superseded by a newer request.");
            const fresh = await getSpecificationContext(userId, jobId);
            assertAssessPermission(fresh.access.user);
            if (
              fresh.access.job.organizationId !== organizationId ||
              sourceFingerprint(
                selectedAssessmentSources(fresh, assessment.selection),
              ) !== assessment.sourceFingerprint
            )
              throw Error(
                "Specification documents or access changed during assessment. Existing systems are unchanged. Retry with the current sources.",
              );
          };
          await guard();
          const [materialRows, categoryRows, catalogRows] = await Promise.all([
            db
              .select({ id: materials.id, name: materials.name })
              .from(materials)
              .where(eq(materials.organizationId, organizationId)),
            db
              .select({ id: categories.id, name: categories.name })
              .from(categories)
              .where(eq(categories.organizationId, organizationId)),
            db
              .select({ id: catalogs.id, name: catalogs.name })
              .from(catalogs)
              .where(
                and(
                  eq(catalogs.organizationId, organizationId),
                  eq(catalogs.kind, "materials"),
                ),
              ),
          ]);
          const passages: ReturnType<typeof specificationPassages> = [];
          for (const source of assessment.sources) {
            await guard();
            await update({ stage: `Reading ${source.name}` });
            const extracted = source.drawing
              ? await extractDrawingSource(source)
              : await extractSpecification(organizationId, source);
            passages.push(...specificationPassages(source, extracted));
            assessment.warnings.push(
              ...extracted.warnings.map((w) => `${source.name}: ${w}`),
            );
          }
          const output = await assessPassages(
            passages,
            materialRows.map((m) => m.name),
            undefined,
            async (stage) => {
              await guard();
              await update({ stage });
            },
          );
          await guard();
          const facets = {
            materials: materialRows,
            categories: categoryRows,
            catalogs: catalogRows,
          };
          await db.transaction(async (tx) => {
            // Same job lock as document mutations prevents version/ACL changes between the check and commit.
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 4149))`,
            );
            const fresh = await getSpecificationContext(userId, jobId, tx);
            assertAssessPermission(fresh.access.user);
            await assertStoredSystemsReadable(
              tx,
              organizationId,
              jobId,
              fresh.readableDocumentIds,
              fresh.access.canManage,
            );
            if (
              sourceFingerprint(
                selectedAssessmentSources(fresh, assessment.selection),
              ) !== assessment.sourceFingerprint
            )
              throw Error(
                "Sources changed while assessment ran. Retry with the current documents.",
              );
            const [active] = await tx
              .select()
              .from(jobSystemAssessments)
              .where(eq(jobSystemAssessments.id, assessment.runId))
              .for("update");
            if (!active) return;
            for (const system of output.systems) {
              const [existing] = await tx
                .select()
                .from(pipeSystemSpecs)
                .where(
                  and(
                    eq(pipeSystemSpecs.organizationId, organizationId),
                    eq(pipeSystemSpecs.jobId, jobId),
                    eq(pipeSystemSpecs.system, system.code),
                  ),
                )
                .for("update")
                .limit(1);
              const before = existing
                ? pipeSpecSchema.parse(existing.data)
                : defaultPipeSpec();
              const incoming: JobSystemRequirements = {
                ...system.requirements,
                rules: system.requirements.rules.map((r) => ({
                  ...r,
                  alternatives: r.alternatives.map((a) =>
                    mapSystemAlternative(a, facets),
                  ),
                })),
              };
              const data = {
                ...before,
                requirements: mergeSystemRequirements(
                  before.requirements,
                  incoming,
                ),
              };
              if (existing)
                await tx
                  .update(pipeSystemSpecs)
                  .set({
                    data,
                    revision: existing.revision + 1,
                    updatedAt: new Date(),
                    updatedBy: userId,
                  })
                  .where(eq(pipeSystemSpecs.id, existing.id));
              else
                await tx
                  .insert(pipeSystemSpecs)
                  .values({
                    organizationId,
                    jobId,
                    system: system.code,
                    data,
                    updatedBy: userId,
                  })
                  .onConflictDoNothing();
            }
            // Absent systems remain, with stale/unconfirmed applicability called out instead of removing corrections.
            const rows = await tx
              .select()
              .from(pipeSystemSpecs)
              .where(
                and(
                  eq(pipeSystemSpecs.organizationId, organizationId),
                  eq(pipeSystemSpecs.jobId, jobId),
                ),
              )
              .for("update");
            for (const row of rows) {
              if (output.systems.some((s) => s.code === row.system)) continue;
              const spec = pipeSpecSchema.safeParse(row.data);
              if (!spec.success || !spec.data.requirements) continue;
              const req = spec.data.requirements;
              req.issues = req.issues.filter(
                (i) => i.code !== "not_in_latest_assessment",
              );
              req.issues.push({
                code: "not_in_latest_assessment",
                message:
                  "This system was not identified in the latest assessment. Your previous choices were kept; review its applicability.",
                ruleId: null,
                blocking: true,
                resolved: false,
              });
              await tx
                .update(pipeSystemSpecs)
                .set({
                  data: spec.data,
                  revision: row.revision + 1,
                  updatedAt: new Date(),
                  updatedBy: userId,
                })
                .where(eq(pipeSystemSpecs.id, row.id));
            }
            Object.assign(assessment, {
              status: "ready",
              stage: "Ready for review",
              completedAt: new Date().toISOString(),
              model: output.model,
              systemCount: output.systems.length,
              warnings: [
                ...assessment.warnings,
                ...output.warnings,
                ...(!output.systems.length
                  ? [
                      "No supported systems were identified. Review the source documents and add systems manually.",
                    ]
                  : []),
              ],
            });
            await tx
              .update(jobSystemAssessments)
              .set({ status: "ready", data: assessment, updatedAt: new Date() })
              .where(eq(jobSystemAssessments.id, assessment.runId));
          });
        } catch (error) {
          await update({
            status: "failed",
            stage: "Assessment failed",
            completedAt: new Date().toISOString(),
            error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Assessment failed. Existing systems are unchanged; retry later.",
          }).catch(() => undefined);
        }
      });
    tasks.set(assessment.runId, work);
    tail = work;
    void work.finally(() => tasks.delete(assessment.runId));
    return { runId: assessment.runId };
  } finally {
    admissions--;
  }
}
