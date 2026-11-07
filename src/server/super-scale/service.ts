import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { superScaleJobs } from "~/server/db/super-scale-schema";
import { accessSheet, type DrawingContext } from "../drawings/service";
import { assertDrawingManager } from "../drawings/domain";

export async function superScaleLatest(ctx: DrawingContext, sheetId: string) {
  const access = await accessSheet(ctx.db, ctx.userId, sheetId);
  assertDrawingManager(access.actor);
  const [row] = await ctx.db
    .select()
    .from(superScaleJobs)
    .where(
      and(
        eq(superScaleJobs.userId, ctx.userId),
        eq(superScaleJobs.organizationId, access.actor.organizationId),
        eq(superScaleJobs.sheetId, sheetId),
      ),
    )
    .orderBy(desc(superScaleJobs.createdAt))
    .limit(1);
  return row ?? null;
}
export async function startSuperScale(
  ctx: DrawingContext,
  input: { id: string; sheetId: string; first: string; second: string },
) {
  const access = await accessSheet(ctx.db, ctx.userId, input.sheetId);
  assertDrawingManager(access.actor);
  if (access.sheet.documentVersionId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Super scale requires a job drawing.",
    });
  if (Boolean(input.first) !== Boolean(input.second))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose both grid lines.",
    });
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ctx.userId}, 7159))`,
    );
    const [existing] = await tx
      .select()
      .from(superScaleJobs)
      .where(eq(superScaleJobs.id, input.id));
    if (existing) {
      if (
        existing.userId !== ctx.userId ||
        existing.sheetId !== input.sheetId ||
        existing.first !== input.first ||
        existing.second !== input.second
      )
        throw new TRPCError({ code: "CONFLICT" });
      return existing;
    }
    const [active] = await tx
      .select()
      .from(superScaleJobs)
      .where(
        and(
          eq(superScaleJobs.userId, ctx.userId),
          inArray(superScaleJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active) {
      if (
        active.sheetId === input.sheetId &&
        active.first === input.first &&
        active.second === input.second
      )
        return active;
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "A Super scale job is already running. Wait for it or stop it first.",
      });
    }
    const [row] = await tx
      .insert(superScaleJobs)
      .values({
        ...input,
        userId: ctx.userId,
        organizationId: access.actor.organizationId,
      })
      .returning();
    return row!;
  });
}
export async function cancelSuperScale(
  ctx: DrawingContext,
  input: { sheetId: string; id: string },
) {
  const access = await accessSheet(ctx.db, ctx.userId, input.sheetId);
  assertDrawingManager(access.actor);
  await ctx.db
    .update(superScaleJobs)
    .set({
      status: "cancelled",
      progress: "Stopped. No scales were changed.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(superScaleJobs.id, input.id),
        eq(superScaleJobs.sheetId, input.sheetId),
        eq(superScaleJobs.userId, ctx.userId),
        inArray(superScaleJobs.status, ["queued", "running"]),
      ),
    );
}
