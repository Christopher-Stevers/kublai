import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { bimDesigns, bimActivity } from "~/server/db/bim-schema";
import { requireModelUpload, type ModelAccess } from "./access";
import { readModel } from "./service";
import {
  emptyDesign,
  designSchema,
  type ModelDesign,
  type SavedModelDesign,
} from "~/lib/bim/design";
const scope = (a: ModelAccess, modelId: string) =>
  and(
    eq(bimDesigns.modelId, modelId),
    eq(bimDesigns.jobId, a.job.id),
    eq(bimDesigns.organizationId, a.job.organizationId),
  );
export async function readDesign(
  a: ModelAccess,
  modelId: string,
): Promise<SavedModelDesign> {
  await readModel(a, modelId);
  const [row] = await db.select().from(bimDesigns).where(scope(a, modelId));
  return row
    ? {
        revision: row.revision,
        design: row.data,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      }
    : { revision: 0, design: emptyDesign(), updatedAt: null, updatedBy: null };
}
export async function saveDesign(
  a: ModelAccess,
  modelId: string,
  expectedRevision: number,
  input: ModelDesign,
): Promise<SavedModelDesign> {
  requireModelUpload(a);
  const design = designSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`bim:${a.job.organizationId}:${a.job.id}`},0))`,
    );
    const model = await readModel(a, modelId, tx);
    if (
      model.data.status !== "ready" ||
      model.data.conversionEngine === "native"
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Editing requires a ready, verified IFC model.",
      });
    const [row] = await tx
      .select()
      .from(bimDesigns)
      .where(scope(a, modelId))
      .for("update");
    if ((row?.revision ?? 0) !== expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Another person saved model changes. Your draft is retained. Reload the saved design before applying your changes again.",
      });
    if (
      (!a.canDelete &&
        (row?.data.elements ?? []).some(
          (e) => !design.elements.some((n) => n.id === e.id),
        )) ||
      (!a.canDelete &&
        design.overrides.some(
          (o) =>
            o.deleted &&
            !row?.data.overrides.some(
              (old) => old.expressId === o.expressId && old.deleted,
            ),
        ))
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Model delete permission is required to remove elements.",
      });
    const revision = expectedRevision + 1,
      updatedAt = new Date();
    await tx
      .insert(bimDesigns)
      .values({
        modelId,
        jobId: a.job.id,
        organizationId: a.job.organizationId,
        revision,
        data: design,
        updatedBy: a.user.id,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: bimDesigns.modelId,
        set: { revision, data: design, updatedBy: a.user.id, updatedAt },
      });
    await tx.insert(bimActivity).values({
      organizationId: a.job.organizationId,
      jobId: a.job.id,
      actorId: a.user.id,
      entityId: modelId,
      action: "design.saved",
      data: { revision, before: row?.data ?? emptyDesign(), after: design },
    });
    return {
      revision,
      design,
      updatedAt: updatedAt.toISOString(),
      updatedBy: a.user.id,
    };
  });
}
