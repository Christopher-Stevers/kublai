import { and, eq } from "drizzle-orm";
import { drawingPersonalScales } from "~/server/db/drawing-workspace-schema";
import type { DrawingMetadata } from "~/lib/drawing-workspace";
import { accessSheet, type DrawingContext } from "./service";

/** Overrides belong to the authenticated user and the exact source sheet revision. */
export async function personalDrawingScale(ctx: DrawingContext, sheetId: string) {
  await accessSheet(ctx.db, ctx.userId, sheetId);
  const [row] = await ctx.db.select().from(drawingPersonalScales).where(and(
    eq(drawingPersonalScales.sheetId, sheetId), eq(drawingPersonalScales.userId, ctx.userId),
  ));
  return row?.scale ?? null;
}
export async function savePersonalDrawingScale(ctx: DrawingContext, sheetId: string, scale: DrawingMetadata["scale"]) {
  await accessSheet(ctx.db, ctx.userId, sheetId);
  if (scale === null) {
    await ctx.db.delete(drawingPersonalScales).where(and(eq(drawingPersonalScales.sheetId, sheetId), eq(drawingPersonalScales.userId, ctx.userId)));
  } else {
    await ctx.db.insert(drawingPersonalScales).values({ sheetId, userId: ctx.userId, scale })
      .onConflictDoUpdate({ target: [drawingPersonalScales.sheetId, drawingPersonalScales.userId], set: { scale } });
  }
  return scale;
}
