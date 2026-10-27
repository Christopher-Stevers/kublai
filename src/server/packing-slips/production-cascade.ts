import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  escalationPlan,
  mergeAssistedLines,
  type CheapReading,
} from "./cascade-policy";
import {
  readTerraFallback,
  fallbackLines,
  TERRA_MODEL,
  type FallbackInput,
} from "./terra-fallback";
import { packingSlipTerraCalls } from "./terra-call-schema";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { recordPipelineStage } from "./trace";
type Scope = {
  runId: string;
  organizationId: string;
  jobId: string;
  documentId: string;
  versionId: string;
  sourceHash: string;
};
export function terraEnabled(organizationId: string) {
  return (
    process.env.PACKING_SLIP_TERRA_ENABLED === "true" &&
    !!process.env.OPENAI_API_KEY &&
    (process.env.PACKING_SLIP_TERRA_ORGANIZATIONS ?? "")
      .split(",")
      .map((s) => s.trim())
      .includes(organizationId)
  );
}
function limit(name: string, fallback: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}
/** Serial budget reservation across web/worker processes. Unknown charges remain reserved. */
export async function reserveTerra(scope: Scope, requestHash: string) {
  const { db } = await import("~/server/db");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(72491839)`);
    const [old] = await tx
      .select()
      .from(packingSlipTerraCalls)
      .where(eq(packingSlipTerraCalls.id, scope.runId))
      .limit(1);
    if (old) {
      if (
        old.organizationId !== scope.organizationId ||
        old.jobId !== scope.jobId ||
        old.documentId !== scope.documentId ||
        old.versionId !== scope.versionId ||
        old.sourceHash !== scope.sourceHash ||
        old.requestHash !== requestHash
      )
        return { kind: "interrupted" as const };
      if (old.status === "done" && old.result)
        return { kind: "cached" as const, result: old.result };
      return { kind: "interrupted" as const };
    }
    const [totals] = await tx
      .select({
        spent: sql<number>`coalesce(sum(${packingSlipTerraCalls.budgetUsd}), 0)::float8`,
        calls: sql<number>`count(*)::int`,
      })
      .from(packingSlipTerraCalls)
      .where(
        sql`${packingSlipTerraCalls.createdAt} >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`,
      );
    // One dollar reserved for a bounded 20-page / 120 KB-context / 16K-output
    // request. Release the difference only when actual usage is available.
    if (
      Number(totals?.spent ?? 0) + 1 >
        limit("PACKING_SLIP_TERRA_DAILY_USD", 5, 100) ||
      Number(totals?.calls ?? 0) >=
        limit("PACKING_SLIP_TERRA_DAILY_CALLS", 50, 500)
    )
      return { kind: "budget-limited" as const };
    await tx
      .insert(packingSlipTerraCalls)
      .values({
        id: scope.runId,
        organizationId: scope.organizationId,
        jobId: scope.jobId,
        documentId: scope.documentId,
        versionId: scope.versionId,
        sourceHash: scope.sourceHash,
        requestHash,
        status: "reserved",
        budgetUsd: 1,
      });
    return { kind: "reserved" as const };
  });
}
export async function productionCascade<T extends CheapReading>(args: {
  scope: Scope;
  base: T;
  pages: Buffer[];
  unresolvedOrder: boolean;
  context: () => Promise<FallbackInput>;
  assertCurrent: () => Promise<void>;
  progress: (message: string) => Promise<void>;
}) {
  const plan = escalationPlan(args.base, args.unresolvedOrder);
  const cascade: NonNullable<SlipAnalysis["cascade"]> = {
    ...plan,
    status: "not-needed",
  };
  const result = {
    ...args.base,
    lines: structuredClone(args.base.lines),
    warnings: [...args.base.warnings],
    cascade,
    suggestedOrderId: null as string | null,
  };
  await recordPipelineStage("routing", {
    ...plan,
    sourceHash: args.scope.sourceHash,
    jobId: args.scope.jobId,
  });
  if (!plan.reasons.length) return result;
  if (!terraEnabled(args.scope.organizationId)) {
    cascade.status = "unavailable";
    return result;
  }
  let reserved = false;
  try {
    await args.assertCurrent();
    const context = await args.context();
    if (
      Buffer.byteLength(JSON.stringify(context)) > 120000 ||
      !args.pages.length ||
      args.pages.length > 20
    )
      throw Error(
        "Terra input exceeds its page or candidate limit. Review the earlier reading manually.",
      );
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          sourceHash: args.scope.sourceHash,
          context,
          policy: plan.policy,
          model: TERRA_MODEL,
        }),
      )
      .digest("hex");
    const reservation = await reserveTerra(args.scope, requestHash);
    if (
      reservation.kind === "budget-limited" ||
      reservation.kind === "interrupted"
    ) {
      cascade.status = reservation.kind;
      result.warnings.push(
        reservation.kind === "budget-limited"
          ? "Terra's daily testing budget is reached. The earlier reading remains available for manual review."
          : "An earlier Terra attempt was interrupted or its inputs changed. It was not charged again automatically; review the saved reading.",
      );
      return result;
    }
    reserved = reservation.kind === "reserved";
    await args.progress("Terra is checking unresolved lines and matches…");
    await args.assertCurrent();
    const assisted =
      reservation.kind === "cached"
        ? reservation.result
        : await readTerraFallback(args.pages, context);
    if (reserved) {
      const { db } = await import("~/server/db");
      await db
        .update(packingSlipTerraCalls)
        .set({
          status: "done",
          result: assisted,
          budgetUsd: assisted.usage?.estimatedUsd ?? 1,
          updatedAt: new Date(),
        })
        .where(eq(packingSlipTerraCalls.id, args.scope.runId));
      reserved = false;
    }
    const targets =
      args.unresolvedOrder || !args.base.lines.length
        ? args.base.lines.map((_, i) => i)
        : plan.lineIndexes;
    const merged = mergeAssistedLines(
      args.base.lines,
      fallbackLines(assisted.output),
      targets,
    );
    result.lines = merged.lines;
    result.warnings.push(...merged.warnings, ...assisted.output.warnings);
    result.model = `${args.base.model || "OCR"} → ${assisted.model}`;
    result.suggestedOrderId = assisted.output.orderId;
    cascade.status = "completed";
    cascade.model = assisted.model;
    cascade.document = assisted.output.document;
    cascade.estimatedUsd = assisted.usage?.estimatedUsd ?? null;
    await recordPipelineStage("terra-result", assisted);
  } catch (error) {
    cascade.status = "failed";
    // Provider bodies and arbitrary parsing errors must not escape into the UI.
    cascade.error =
      error instanceof Error &&
      /^Terra (?:unavailable|input|did not|could not|returned|images|response)/.test(
        error.message,
      )
        ? error.message.slice(0, 250)
        : "Terra assistance was unavailable. Review the earlier reading manually.";
    result.warnings.push(cascade.error);
    if (reserved) {
      const { db } = await import("~/server/db");
      await db
        .update(packingSlipTerraCalls)
        .set({ status: "failed", error: cascade.error, updatedAt: new Date() })
        .where(eq(packingSlipTerraCalls.id, args.scope.runId))
        .catch(() => undefined);
    }
  }
  await recordPipelineStage("cascade-result", { cascade, lines: result.lines });
  return result;
}
