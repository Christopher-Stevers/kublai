import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { DrawingContext } from "./service";
import { hyperlinkReaderRuns as runs } from "./hyperlink-reader-schema";
import type { VisionHyperlinkReader } from "~/lib/hyperlink-readers";

export type HyperlinkRunScope = {
  id: string;
  organizationId: string;
  jobId: string;
  sourceSheetId: string;
  userId: string;
  reader: VisionHyperlinkReader;
  fingerprint: string;
};
export async function reserveHyperlinkRun(
  db: DrawingContext["db"],
  scope: HyperlinkRunScope,
  refresh: boolean,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scope.organizationId}, 414932))`,
    );
    const [retry] = await tx
      .select()
      .from(runs)
      .where(eq(runs.id, scope.id))
      .limit(1);
    if (retry) {
      if (
        [
          "organizationId",
          "jobId",
          "sourceSheetId",
          "userId",
          "reader",
          "fingerprint",
        ].some(
          (key) =>
            retry[key as keyof typeof scope] !==
            scope[key as keyof typeof scope],
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This reading request belongs to another drawing or version.",
        });
      if (retry.status === "done" && retry.result)
        return { cached: retry.result };
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This reading is unfinished or failed. Read again to start a new attempt.",
      });
    }
    const same = and(
      eq(runs.organizationId, scope.organizationId),
      eq(runs.jobId, scope.jobId),
      eq(runs.sourceSheetId, scope.sourceSheetId),
      eq(runs.reader, scope.reader),
      eq(runs.fingerprint, scope.fingerprint),
    );
    if (!refresh) {
      const [saved] = await tx
        .select()
        .from(runs)
        .where(and(same, eq(runs.status, "done")))
        .orderBy(desc(runs.createdAt))
        .limit(1);
      if (saved?.result) return { cached: saved.result };
    }
    const [pending] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          same,
          eq(runs.status, "reserved"),
          sql`${runs.createdAt} > now() - interval '5 minutes'`,
        ),
      )
      .limit(1);
    if (pending)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This reader is already checking the drawing. Try again shortly.",
      });
    const [counts] = await tx
      .select({
        today: sql<number>`count(*) filter (where ${runs.createdAt} >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'))::int`,
        active: sql<number>`count(*) filter (where ${runs.status}='reserved' and ${runs.createdAt} > now() - interval '5 minutes')::int`,
      })
      .from(runs)
      .where(eq(runs.organizationId, scope.organizationId));
    const configured = Number(process.env.HYPERLINK_AI_DAILY_CALLS ?? 40);
    const limit = Number.isFinite(configured)
      ? Math.max(0, Math.min(200, configured))
      : 0;
    if (Number(counts?.today ?? 0) >= limit)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "The daily AI drawing-reading limit has been reached. Normal is still available.",
      });
    if (Number(counts?.active ?? 0) >= 2)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Two AI drawing readings are already running. Try again shortly.",
      });
    await tx.insert(runs).values({ ...scope, status: "reserved" });
    return { cached: null };
  });
}
