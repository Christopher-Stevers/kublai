import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { bimModels, bimActivity } from "~/server/db/bim-schema";
import { modelAccess, requireModelUpload, type ModelAccess } from "./access";
import { modelScope, readModel } from "./service";
import {
  nativeConversionAvailable,
  convertNativeRevit,
} from "./native-conversion";
import { modelBlobPath, storeConvertedModel } from "./storage";
import type { BimModel } from "~/lib/bim/types";
export async function convertRevitModel(a: ModelAccess, id: string) {
  requireModelUpload(a);
  if (!(await nativeConversionAvailable()))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The local Revit converter is unavailable on this server.",
    });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`bim-convert:${id}`},0))`,
    );
    const m = await readModel(a, id, tx);
    if (
      m.data.format !== "rvt" ||
      m.data.status === "ready" ||
      m.data.status === "processing"
    )
      return m.data;
    const data: BimModel = {
      ...m.data,
      status: "processing",
      conversionMessage: "Queued for local Revit conversion",
      conversionEngine: "native",
      publication:
        m.data.publication === "archived" ? "archived" : "coordination",
      nativeConversion: undefined,
    };
    await tx
      .update(bimModels)
      .set({
        data,
        conversionRequestedBy: a.user.id,
        conversionCheckedAt: null,
        conversionLease: null,
        conversionUrn: null,
      })
      .where(and(modelScope(a), eq(bimModels.id, id)));
    await tx.insert(bimActivity).values({
      organizationId: a.job.organizationId,
      jobId: a.job.id,
      actorId: a.user.id,
      entityId: id,
      action: "model.conversion_queued",
      data: { engine: "native" },
    });
    return data;
  });
}
export async function refreshRevitModel(a: ModelAccess, id: string) {
  return (await readModel(a, id)).data;
}
let running = false;
/** Durable queue: DB leases survive request disconnects and expired leases resume after a restart. */
export async function dispatchModelConversions() {
  if (running || process.env.BIM_WORKER_DISABLED === "1") return;
  running = true;
  try {
    const leased = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bimModels)
        .where(
          sql`${bimModels.data}->>'status' = 'processing' and ${bimModels.conversionRequestedBy} is not null and (${bimModels.conversionLease} is null or ${bimModels.conversionLease} < now()) and (${bimModels.conversionCheckedAt} is null or ${bimModels.conversionCheckedAt} < now() - interval '25 seconds')`,
        )
        .limit(1)
        .for("update", { skipLocked: true });
      const row = rows[0];
      if (!row) return null;
      await tx
        .update(bimModels)
        .set({
          conversionLease: new Date(Date.now() + 60 * 60 * 1000),
          conversionCheckedAt: new Date(),
        })
        .where(eq(bimModels.id, row.id));
      return row;
    });
    if (!leased) return;
    try {
      const a = await modelAccess(leased.conversionRequestedBy, leased.jobId);
      requireModelUpload(a);
      if (a.job.organizationId !== leased.organizationId)
        throw Error("Model access changed.");
      await db
        .update(bimModels)
        .set({
          data: sql`${bimModels.data} || ${JSON.stringify({ conversionEngine: "native", conversionMessage: "Reading Revit geometry locally" })}::jsonb`,
        })
        .where(eq(bimModels.id, leased.id));
      const result = await convertNativeRevit(
        modelBlobPath(a.job.organizationId, leased.sourceSha),
      );
      const fresh = await modelAccess(a.user.id, a.job.id);
      requireModelUpload(fresh);
      const sha =
        result.status === "ready"
          ? await storeConvertedModel(a.job.organizationId, result.bytes)
          : null;
      const change = {
        status: result.status,
        conversionEngine: "native",
        nativeConversion: result.report,
        conversionMessage:
          result.status === "ready"
            ? "Experimental local preview · geometry is unverified"
            : (result.report.warnings.at(-1) ??
              "This Revit file is not supported yet."),
      };
      await db.transaction(async (tx) => {
        await tx
          .update(bimModels)
          .set({
            data: sql`${bimModels.data} || ${JSON.stringify(change)}::jsonb`,
            viewSha: sha,
            conversionLease: null,
            conversionCheckedAt: new Date(),
          })
          .where(and(modelScope(fresh), eq(bimModels.id, leased.id)));
        await tx.insert(bimActivity).values({
          organizationId: a.job.organizationId,
          jobId: a.job.id,
          actorId: a.user.id,
          entityId: leased.id,
          action: `model.conversion_${result.status}`,
          data: change,
        });
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Conversion failed. Retry conversion.";
      await db
        .update(bimModels)
        .set({
          conversionLease: null,
          data: sql`${bimModels.data} || ${JSON.stringify({ status: "failed", conversionMessage: message })}::jsonb`,
        })
        .where(eq(bimModels.id, leased.id));
    }
  } finally {
    running = false;
  }
}
