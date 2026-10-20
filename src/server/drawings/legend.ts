import { and, eq } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { TRPCError } from "@trpc/server";
import { drawingLegendItems, jobDrawingSheets } from "~/server/db/schema";
import { accessSheet, type DrawingContext } from "./service";
import { drawingPdfLocation, equipmentIndex } from "./equipment-index";
import {
  detectLegendItems,
  type LegendItemData,
  type LegendLine,
} from "~/lib/drawing-legend";
import { assertRevision } from "./domain";

export async function legendAccess(
  ctx: DrawingContext,
  sheetId: string,
  sourceId?: string,
  write = false,
) {
  const access = await accessSheet(ctx.db, ctx.userId, sheetId);
  if (write && !access.canAnnotate)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Editing this drawing is not allowed.",
    });
  if (sourceId && sourceId !== sheetId) {
    const source = await accessSheet(ctx.db, ctx.userId, sourceId);
    if (
      source.sheet.setId !== access.sheet.setId ||
      source.sheet.organizationId !== access.sheet.organizationId
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a legend sheet from this drawing set.",
      });
    return { ...access, source: source.sheet };
  }
  return { ...access, source: access.sheet };
}
export async function listLegendItems(ctx: DrawingContext, sheetId: string) {
  const { sheet, canAnnotate } = await legendAccess(ctx, sheetId);
  const [items, sheets] = await Promise.all([
    ctx.db
      .select()
      .from(drawingLegendItems)
      .where(
        and(
          eq(drawingLegendItems.organizationId, sheet.organizationId),
          eq(drawingLegendItems.setId, sheet.setId),
        ),
      ),
    ctx.db
      .select({
        id: jobDrawingSheets.id,
        name: jobDrawingSheets.name,
        imageUrl: jobDrawingSheets.imageUrl,
        width: jobDrawingSheets.width,
        height: jobDrawingSheets.height,
      })
      .from(jobDrawingSheets)
      .where(
        and(
          eq(jobDrawingSheets.organizationId, sheet.organizationId),
          eq(jobDrawingSheets.setId, sheet.setId),
        ),
      )
      .orderBy(jobDrawingSheets.sortOrder),
  ]);
  return { items, sheets, canEdit: canAnnotate };
}
export async function scanLegend(
  ctx: DrawingContext,
  input: { sheetId: string; sourceSheetId: string },
) {
  const { source } = await legendAccess(
    ctx,
    input.sheetId,
    input.sourceSheetId,
  );
  const location = drawingPdfLocation(source.imageUrl, source.jobId);
  if (!location)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This drawing needs an original PDF to read its legend.",
    });
  const index = await equipmentIndex(location.file, "pdf");
  const words = index.pages.find((p) => p.page === location.page)?.words ?? [];
  if (!words.length)
    return {
      items: [],
      warning:
        "No readable text found. Scanned legends need text recognition before they can be read.",
    };
  let segments: LegendLine[];
  let truncated = false;
  try {
    const filename = path.join(
      path.dirname(location.file),
      `pipes-${location.page}-v1.json`,
    );
    if ((await stat(filename)).size > 48 * 1024 * 1024)
      throw Error("Too large");
    const bytes = await readFile(filename);
    const value = JSON.parse(
      (bytes[0] === 31
        ? gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 })
        : bytes
      ).toString(),
    ) as { linework: { segments: LegendLine[]; truncated: boolean } };
    if (!Array.isArray(value.linework.segments))
      throw Error("Invalid linework");
    segments = value.linework.segments;
    truncated =
      value.linework.truncated ||
      segments.length > 250_000 ||
      words.length > 50_000;
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Vector data is unavailable for this sheet. Choose another legend sheet or re-upload the original PDF.",
    });
  }
  const items = detectLegendItems(words, segments);
  return {
    items,
    warning:
      (truncated || items.length === 300
        ? "This sheet reached a reading limit; some symbols may be missing. "
        : "") +
      (items.length
        ? "Review each symbol and description before saving. Unbordered or unusual legend layouts may be missed."
        : "No bordered symbol legend found on this sheet. Choose the sheet containing the legend."),
  };
}
const sourceKey = (data: LegendItemData) =>
  [data.row.left, data.row.top, data.row.right, data.row.bottom]
    .map((n) => n.toFixed(4))
    .join(":");
export async function saveLegendItems(
  ctx: DrawingContext,
  input: { sheetId: string; sourceSheetId: string; items: LegendItemData[] },
) {
  const { sheet, source } = await legendAccess(
    ctx,
    input.sheetId,
    input.sourceSheetId,
    true,
  );
  const added = await ctx.db
    .insert(drawingLegendItems)
    .values(
      input.items.map((data) => ({
        organizationId: sheet.organizationId,
        setId: sheet.setId,
        sourceSheetId: source.id,
        sourceKey: sourceKey(data),
        data,
        reviewedBy: ctx.userId,
      })),
    )
    .onConflictDoNothing({
      target: [
        drawingLegendItems.setId,
        drawingLegendItems.sourceSheetId,
        drawingLegendItems.sourceKey,
      ],
    })
    .returning({ id: drawingLegendItems.id });
  return { added: added.length, existing: input.items.length - added.length };
}
export async function updateLegendItem(
  ctx: DrawingContext,
  input: {
    sheetId: string;
    id: string;
    revision: number;
    data: LegendItemData | null;
  },
) {
  const { sheet } = await legendAccess(ctx, input.sheetId, undefined, true);
  const where = and(
    eq(drawingLegendItems.id, input.id),
    eq(drawingLegendItems.setId, sheet.setId),
    eq(drawingLegendItems.organizationId, sheet.organizationId),
  );
  return ctx.db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(drawingLegendItems)
      .where(where)
      .for("update");
    if (!item)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Legend item not found.",
      });
    assertRevision(item.revision, input.revision);
    if (input.data)
      await tx
        .update(drawingLegendItems)
        .set({
          data: input.data,
          revision: input.revision + 1,
          reviewedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(where);
    else await tx.delete(drawingLegendItems).where(where);
    return { ok: true };
  });
}
