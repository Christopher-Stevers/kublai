import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { drawingLegendItems, jobDrawingSheets } from "~/server/db/schema";
import { legendAccess } from "./legend";
import type { DrawingContext } from "./service";
import { drawingPdfLocation } from "./equipment-index";
import type { PipeLinework } from "~/lib/pipe-system";
import type { PipeLegendReferences } from "~/lib/pipe-components-types";
import { savedLegendTemplates } from "~/lib/pipe-components";
const execute = promisify(execFile);
const pending = new Map<string, Promise<PipeLinework>>();
let queue: Promise<unknown> = Promise.resolve();
/** Cache immutable source geometry, never user permissions or reviewed names. */
export async function legendComponentLinework(
  file: string,
  page: number,
): Promise<PipeLinework> {
  const filename = path.join(path.dirname(file), `pipes-${page}-v1.json`);
  const read = async () => {
    if ((await stat(filename)).size > 48 * 1024 * 1024)
      throw Error("Oversize vector cache");
    const bytes = await readFile(filename);
    const value = JSON.parse(
      (bytes[0] === 31
        ? gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 })
        : bytes
      ).toString(),
    ) as { linework: PipeLinework };
    if (
      (value.linework.componentDataVersion !== 3 &&
        ((value.linework.componentDataVersion !== 1 &&
          value.linework.componentDataVersion !== 2) ||
          value.linework.componentDataPartial)) ||
      !Array.isArray(value.linework.symbols) ||
      !Number.isFinite(value.linework.aspect) ||
      value.linework.aspect <= 0
    )
      throw Error("Old vector cache");
    return value.linework;
  };
  const inFlight = pending.get(filename);
  if (inFlight) return inFlight;
  const task = (async () => {
    try {
      return await read();
    } catch {
      /* Backfill older uploads once. */
    }
    const work = queue.then(async () => {
      try {
        return await read();
      } catch {
        /* Another request may have completed it. */
      }
      await execute(
        process.execPath,
        [
          "--max-old-space-size=512",
          "--import",
          "tsx",
          path.join(
            process.cwd(),
            "src/server/drawings/legend-component-worker.ts",
          ),
          file,
          String(page),
        ],
        { timeout: 60_000, maxBuffer: 65536 },
      );
      return read();
    });
    queue = work.catch(() => undefined);
    return work;
  })();
  pending.set(filename, task);
  try {
    return await task;
  } finally {
    pending.delete(filename);
  }
}
export async function pipeLegendReferences(
  ctx: DrawingContext,
  sheetId: string,
): Promise<PipeLegendReferences> {
  const { sheet } = await legendAccess(ctx, sheetId);
  const rows = await ctx.db
    .select({ item: drawingLegendItems, source: jobDrawingSheets })
    .from(drawingLegendItems)
    .innerJoin(
      jobDrawingSheets,
      and(
        eq(jobDrawingSheets.id, drawingLegendItems.sourceSheetId),
        eq(jobDrawingSheets.setId, sheet.setId),
        eq(jobDrawingSheets.organizationId, sheet.organizationId),
      ),
    )
    .where(
      and(
        eq(drawingLegendItems.setId, sheet.setId),
        eq(drawingLegendItems.organizationId, sheet.organizationId),
      ),
    )
    .orderBy(drawingLegendItems.id)
    .limit(301);
  const result: PipeLegendReferences = { templates: [], warnings: [] };
  if (rows.length > 300)
    result.warnings.push("Only the first 300 saved legend items were read.");
  if (!rows.length)
    result.warnings.push(
      "No saved Legend Items for this drawing set. Read and review its legend first.",
    );
  const sources = new Map<string, typeof rows>();
  for (const row of rows.slice(0, 300)) {
    const list = sources.get(row.source.id) ?? [];
    list.push(row);
    sources.set(row.source.id, list);
  }
  let points = 0;
  for (const [sourceId, items] of [...sources].slice(0, 12)) {
    const source = items[0]!.source;
    await legendAccess(ctx, sheetId, sourceId);
    const location = drawingPdfLocation(source.imageUrl, source.jobId);
    if (!location) {
      result.warnings.push(`${source.name}: original PDF unavailable.`);
      continue;
    }
    try {
      const linework = await legendComponentLinework(
        location.file,
        location.page,
      );
      if (linework.componentDataPartial || linework.truncated)
        result.warnings.push(`${source.name}: some symbol data is incomplete.`);
      let missing = 0;
      for (const { item } of items) {
        const templates = savedLegendTemplates(item, source, linework);
        if (!templates.length) missing++;
        for (const template of templates) {
          points += template.reference!.paths.reduce(
            (n, p) => n + p.points.length,
            0,
          );
          if (points > 100_000 || result.templates.length >= 600) {
            result.warnings.push(
              "Legend reference limit reached; some items were not analyzed.",
            );
            return result;
          }
          result.templates.push(template);
        }
      }
      if (missing)
        result.warnings.push(
          `${source.name}: ${missing} saved items have no usable vector symbol. Check their crops in Legend Items.`,
        );
    } catch {
      result.warnings.push(
        `${source.name}: symbols could not be read. Try Recheck while connected.`,
      );
    }
  }
  if (sources.size > 12)
    result.warnings.push("Only the first 12 legend sheets were read.");
  return result;
}
