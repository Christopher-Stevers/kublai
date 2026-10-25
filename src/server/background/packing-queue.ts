import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { packingSlipJobs } from "./packing-schema";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SlipClaim = typeof packingSlipJobs.$inferSelect;
export async function claimPackingSlip() {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(packingSlipJobs)
      .where(
        sql`${packingSlipJobs.status} = 'queued' or (${packingSlipJobs.status} = 'running' and ${packingSlipJobs.leaseUntil} < now())`,
      )
      .orderBy(asc(packingSlipJobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    const [claimed] = await tx
      .update(packingSlipJobs)
      .set({
        status: "running",
        workerId: randomUUID(),
        leaseUntil: new Date(Date.now() + 90_000),
        attempts: row.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(packingSlipJobs.id, row.id))
      .returning();
    return claimed ?? null;
  });
}
function owned(claim: SlipClaim) {
  return and(
    eq(packingSlipJobs.id, claim.id),
    eq(packingSlipJobs.organizationId, claim.organizationId),
    eq(packingSlipJobs.status, "running"),
    eq(packingSlipJobs.workerId, claim.workerId!),
  );
}
/** Lock ownership in the same transaction as the result commit. */
export async function ownsPackingSlip(tx: Tx, claim: SlipClaim) {
  const [row] = await tx
    .select({ id: packingSlipJobs.id })
    .from(packingSlipJobs)
    .where(and(owned(claim), sql`${packingSlipJobs.leaseUntil} > now()`))
    .for("update");
  return !!row;
}
export async function heartbeatPackingSlip(claim: SlipClaim) {
  return db
    .update(packingSlipJobs)
    .set({ leaseUntil: new Date(Date.now() + 90_000), updatedAt: new Date() })
    .where(and(owned(claim), sql`${packingSlipJobs.leaseUntil} > now()`));
}
export async function finishPackingSlip(claim: SlipClaim, failed = false) {
  await db
    .update(packingSlipJobs)
    .set({
      status: failed ? "failed" : "done",
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(and(owned(claim), sql`${packingSlipJobs.leaseUntil} > now()`));
}
/** Mark only this owned run failed if the requesting user's access disappeared.
 * This system status update never reads the file or changes receipt quantities. */
export async function failPackingSlip(claim: SlipClaim) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${claim.jobId},4149))`,
    );
    if (!(await ownsPackingSlip(tx, claim))) return;
    await tx.execute(sql`update kublai_job_document_workspace set state=jsonb_set(state,'{documents}',
      coalesce((select jsonb_agg(case when d->>'id'=${claim.documentId} and d->'packingSlipAnalysis'->>'runId'=${claim.id} and d->'packingSlipAnalysis'->>'status'='processing'
       then jsonb_set(d,'{packingSlipAnalysis}',(d->'packingSlipAnalysis') || '{"status":"failed","error":"Analysis stopped because access or the source changed. Retry after checking access."}'::jsonb) else d end)
       from jsonb_array_elements(state->'documents') d),'[]'::jsonb)),revision=revision+1,"updatedAt"=now()
       where "jobId"=${claim.jobId} and "organizationId"=${claim.organizationId}`);
    await tx
      .update(packingSlipJobs)
      .set({ status: "failed", leaseUntil: null, updatedAt: new Date() })
      .where(owned(claim));
  });
}
