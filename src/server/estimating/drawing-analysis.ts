import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { db as database } from "~/server/db";
import { jobDrawingSheets, jobFloors, jobRooms } from "~/server/db/schema";
import {
  drawingWorkspaceEntities,
  drawingWorkspaceMetadata,
} from "~/server/db/drawing-workspace-schema";
import {
  drawingArea,
  drawingMarkupEdges,
} from "~/lib/drawing-annotation-geometry";
import {
  drawingMarkupSchema,
  type DrawingEntity,
  type DrawingMetadata,
} from "~/lib/drawing-workspace";
import { realLength } from "~/lib/sheet-measure";
import { estimateSourceKey } from "~/lib/estimating/calculator";
import { matchEstimatePricing } from "~/lib/estimating/pricing";
import {
  newEstimateLine,
  type EstimateLine,
  type PricingRow,
  type EstimatingSettings,
} from "~/lib/estimating/types";
import { normalizeUnit } from "~/lib/estimating/units";
import {
  pdfTitleBlockWord,
  type TitleBlockWord,
} from "~/lib/drawing-title-block";
import { openJobRoomFile, readJobRoomFile } from "~/server/rooms/storage";

type DrawingSheet = {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  sourceFilename?: string | null;
};
type ScheduleRow = {
  description: string;
  quantity: number;
  unit: string;
  rowNumber: number;
  evidence: string;
};
const MAX_SHEETS = 5,
  MAX_LINES = 500,
  MAX_PDF_BYTES = 80_000_000,
  MAX_TEXT_ITEMS = 40_000;
const idFor = (value: string) =>
  `takeoff-${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function sheetFingerprint(sheet: DrawingSheet, metadata?: DrawingMetadata) {
  return hash(
    stableJson({
      id: sheet.id,
      imageUrl: sheet.imageUrl,
      width: sheet.width,
      height: sheet.height,
      currentSourceSheetId: metadata?.currentSourceSheetId ?? sheet.id,
    }),
  );
}
function measurementFingerprint(
  entity: Extract<DrawingEntity, { kind: "markup" }>,
  sheet: DrawingSheet,
  metadata?: DrawingMetadata,
) {
  return `m1:${hash(
    stableJson({
      id: entity.id,
      sheet: sheetFingerprint(sheet, metadata),
      type: entity.data.type,
      points: entity.data.points,
      parents: entity.data.parents,
      text: entity.data.text,
      scale: entity.data.scale ?? metadata?.scale?.unitsPerSheetWidth,
      unit: entity.data.unit ?? metadata?.scale?.unit,
      sourceSheetId: entity.data.sourceSheetId,
    }),
  )}`;
}
type EvidenceRoom = {
  id: string;
  floorId: string;
  name: string;
  source: string;
  shape: unknown;
  updatedAt: Date | string;
  floorName: string;
};
function roomFingerprint(room: EvidenceRoom) {
  return `r1:${hash(stableJson({ id: room.id, floorId: room.floorId, name: room.name, source: room.source, shape: room.shape, updatedAt: room.updatedAt, floorName: room.floorName }))}`;
}
function evidenceDate(value: unknown) {
  if (!(value instanceof Date) && typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
async function resolveCurrentDrawingSources(input: {
  db: Pick<typeof database, "select">;
  organizationId: string;
  jobId: string;
  sheets: DrawingSheet[];
  metadata: Map<string, DrawingMetadata>;
  lock?: boolean;
}) {
  const warnings: string[] = [];
  const currentIds = [
    ...new Set(
      input.sheets.flatMap((sheet) => {
        const current = input.metadata.get(sheet.id)?.currentSourceSheetId;
        return current && current !== sheet.id ? [current] : [];
      }),
    ),
  ];
  if (!currentIds.length) return { sheets: input.sheets, warnings };
  if (
    currentIds.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    return {
      sheets: [],
      warnings: [
        "A drawing references an invalid current source; choose or restore a valid drawing revision.",
      ],
    };
  const query = input.db
    .select({
      id: jobDrawingSheets.id,
      name: jobDrawingSheets.name,
      imageUrl: jobDrawingSheets.imageUrl,
      width: jobDrawingSheets.width,
      height: jobDrawingSheets.height,
      sourceFilename: jobDrawingSheets.sourceFilename,
    })
    .from(jobDrawingSheets)
    .where(
      and(
        eq(jobDrawingSheets.organizationId, input.organizationId),
        isNull(jobDrawingSheets.documentVersionId),
        eq(jobDrawingSheets.jobId, input.jobId),
        inArray(jobDrawingSheets.id, currentIds),
      ),
    );
  const sources = await (input.lock ? query.for("share") : query);
  const sheets = input.sheets.flatMap((sheet) => {
    const current = input.metadata.get(sheet.id)?.currentSourceSheetId;
    if (!current || current === sheet.id) return [sheet];
    const source = sources.find((source) => source.id === current);
    if (!source) {
      warnings.push(
        `${sheet.name}: current drawing revision is deleted or unavailable in this job; source was skipped.`,
      );
      return [];
    }
    return [
      {
        ...sheet,
        imageUrl: source.imageUrl,
        width: source.width,
        height: source.height,
        sourceFilename: source.sourceFilename,
      },
    ];
  });
  return { sheets, warnings };
}

/** Fixtures and server share the exact saved DrawingEntity shape and measurement geometry. */
export function extractDrawingTakeoff(input: {
  sheets: DrawingSheet[];
  entities: DrawingEntity[];
  metadata?: Map<string, DrawingMetadata>;
  existingLines?: EstimateLine[];
}) {
  const lines: EstimateLine[] = [],
    warnings: string[] = [];
  const known = new Set(
    (input.existingLines ?? [])
      .map(estimateSourceKey)
      .filter((key): key is string => Boolean(key)),
  );
  const sheets = new Map(input.sheets.map((sheet) => [sheet.id, sheet]));
  for (const entity of input.entities) {
    if (entity.kind !== "markup" || entity.visibility !== "published") continue;
    const sheet = sheets.get(entity.sheetId);
    if (!sheet || !["dimension", "area", "count"].includes(entity.data.type))
      continue;
    const metadata = input.metadata?.get(sheet.id);
    if (
      entity.data.sourceSheetId !== (metadata?.currentSourceSheetId ?? sheet.id)
    ) {
      warnings.push(
        `${sheet.name}: measurement ${entity.id} belongs to a previous drawing source and was skipped.`,
      );
      continue;
    }
    const parsed = drawingMarkupSchema.safeParse(entity.data);
    if (!parsed.success) {
      warnings.push(
        `${sheet.name}: malformed saved measurement ${entity.id} was skipped.`,
      );
      continue;
    }
    const data = parsed.data;
    let quantity: number, unit: string;
    const aspect = sheet.height / sheet.width;
    const scale = data.scale ?? metadata?.scale?.unitsPerSheetWidth;
    const measureUnit = data.unit ?? metadata?.scale?.unit;
    if (data.type === "count") {
      quantity = data.points.length;
      unit = "ea";
    } else {
      if (
        !Number.isFinite(aspect) ||
        !(aspect > 0) ||
        !scale ||
        !Number.isFinite(scale) ||
        !(scale > 0) ||
        !measureUnit
      ) {
        warnings.push(
          `${sheet.name}: ${data.text ?? data.type} has no valid saved scale; no quantity was invented.`,
        );
        continue;
      }
      // A markup unit override without its own scale must never relabel the shared numeric scale.
      if (
        data.scale === undefined &&
        data.unit &&
        metadata?.scale?.unit &&
        data.unit !== metadata.scale.unit
      ) {
        warnings.push(
          `${sheet.name}: ${data.text ?? data.type} has incompatible markup/shared scale units and was skipped.`,
        );
        continue;
      }
      quantity =
        data.type === "area"
          ? drawingArea(data.points, aspect, scale)
          : drawingMarkupEdges(data).reduce(
              (sum, edge) =>
                sum +
                realLength(
                  [data.points[edge.from]!, data.points[edge.to]!],
                  aspect,
                  scale,
                ),
              0,
            );
      unit = data.type === "area" ? `${measureUnit}2` : measureUnit;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000_000) {
      warnings.push(
        `${sheet.name}: invalid or zero ${data.type} quantity was skipped.`,
      );
      continue;
    }
    const label = data.text?.trim().slice(0, 500) ?? "";
    const line = newEstimateLine({
      id: idFor(`measurement:${sheet.id}:${entity.id}`),
      description:
        label.length > 0 ? label : `${sheet.name} ${data.type} measurement`,
      quantity,
      unit,
      area: sheet.name,
      source: {
        kind: "drawing-measurement",
        sheetId: sheet.id,
        markupId: entity.id,
        label: sheet.name,
        revision: String(metadata?.revision ?? 0),
        fingerprint: measurementFingerprint(entity, sheet, metadata),
        confidence: 1,
        evidence:
          data.type === "count"
            ? `${data.points.length} saved count points; markup revision ${entity.revision}.`
            : `${data.type} geometry from saved points; ${scale} ${measureUnit} per sheet width; sheet ${sheet.width}×${sheet.height}; markup revision ${entity.revision}.`,
      },
      notes:
        "Verify this measurement's material scope, scale and pricing before approving.",
    });
    const key = estimateSourceKey(line)!;
    if (known.has(key)) {
      warnings.push(
        `${sheet.name}: measurement ${entity.id} is already in the estimate and was skipped.`,
      );
      continue;
    }
    known.add(key);
    lines.push(line);
    if (lines.length >= MAX_LINES) {
      warnings.push("Drawing takeoff reached the 500-line review limit.");
      break;
    }
  }
  return { lines, warnings };
}

const headerName = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[._ -]/g, "");
function scheduleColumns(cells: string[]) {
  const names = cells.map(headerName);
  const quantity = names.findIndex((name) =>
    ["qty", "quantity", "count"].includes(name),
  );
  const unit = names.findIndex((name) =>
    ["unit", "units", "uom"].includes(name),
  );
  const description = names.findIndex((name) =>
    ["description", "material", "item", "sku", "partnumber", "partno"].includes(
      name,
    ),
  );
  return quantity >= 0 && unit >= 0 && description >= 0
    ? { quantity, unit, description }
    : null;
}
function scheduleValue(
  cells: string[],
  columns: { quantity: number; unit: number; description: number },
  rowNumber: number,
): ScheduleRow | null {
  const raw = cells[columns.quantity]?.trim() ?? "",
    unit = cells[columns.unit]?.trim() ?? "",
    description = cells[columns.description]?.trim() ?? "";
  // Reject dimensions, ranges, revision numbers and uncertain OCR rather than estimating their intent.
  if (
    !/^(\d+(\.\d*)?|\.\d+)$/.test(raw) ||
    !unit ||
    !description ||
    description.length > 500
  )
    return null;
  const quantity = Number(raw);
  if (!(quantity > 0) || quantity > 100_000_000) return null;
  if (
    ![
      "ea",
      "ft",
      "m",
      "in",
      "cm",
      "mm",
      "ft2",
      "m2",
      "in2",
      "cm2",
      "mm2",
      "hr",
      "day",
    ].includes(normalizeUnit(unit))
  )
    return null;
  return {
    quantity,
    unit: normalizeUnit(unit),
    description,
    rowNumber,
    evidence: cells.join(" | ").slice(0, 1800),
  };
}

/** Explicit bounded schedule columns only. General notes and unlabeled numbers are not a BOM. */
export function parseDrawingScheduleText(text: string): {
  rows: ScheduleRow[];
  warnings: string[];
} {
  const rows: ScheduleRow[] = [],
    warnings: string[] = [];
  if (text.length > 500_000)
    return {
      rows,
      warnings: ["Drawing text exceeded the bounded extraction limit."],
    };
  let columns: ReturnType<typeof scheduleColumns> = null;
  let delimiter = /\|/;
  for (const [index, line] of text.split(/\r?\n/).slice(0, 10_000).entries()) {
    const separator = line.includes("|")
      ? /\s*\|\s*/
      : line.includes("\t")
        ? /\t+/
        : / {2,}/;
    const potential = line.split(separator).map((cell) => cell.trim());
    const header = scheduleColumns(potential);
    if (header) {
      columns = header;
      delimiter = separator;
      continue;
    }
    if (!columns || !line.trim()) continue;
    const cells = line.split(delimiter).map((cell) => cell.trim());
    const row = scheduleValue(cells, columns, index + 1);
    if (row) rows.push(row);
    if (rows.length >= MAX_LINES) {
      warnings.push("Schedule extraction reached the 500-line review limit.");
      break;
    }
  }
  return { rows, warnings };
}

export function parseDrawingScheduleWords(
  words: TitleBlockWord[],
): ScheduleRow[] {
  const textRows: { y: number; height: number; words: TitleBlockWord[] }[] = [];
  for (const word of [...words].sort(
    (a, b) => a.bottom - b.bottom || a.left - b.left,
  )) {
    const height = Math.max(0.001, word.bottom - word.top);
    const row = textRows.at(-1);
    if (
      row &&
      Math.abs(row.y - word.bottom) <=
        Math.max(0.002, Math.min(row.height, height) * 0.4)
    )
      row.words.push(word);
    else textRows.push({ y: word.bottom, height, words: [word] });
  }
  const results: ScheduleRow[] = [];
  let header: {
    words: TitleBlockWord[];
    columns: NonNullable<ReturnType<typeof scheduleColumns>>;
  } | null = null;
  for (const [index, row] of textRows.entries()) {
    row.words.sort((a, b) => a.left - b.left);
    const columns = scheduleColumns(row.words.map((word) => word.text));
    if (columns) {
      header = { words: row.words, columns };
      continue;
    }
    if (!header) continue;
    const cells = header.words.map(() => "");
    for (const word of row.words) {
      // Table columns align at their left edges; choose the nearest header left edge.
      let nearest = 0,
        distance = Infinity;
      for (const [column, label] of header.words.entries()) {
        const delta = Math.abs(word.left - label.left);
        if (delta < distance) {
          nearest = column;
          distance = delta;
        }
      }
      cells[nearest] = `${cells[nearest]} ${word.text}`.trim();
    }
    const value = scheduleValue(cells, header.columns, index + 1);
    if (value) results.push(value);
    if (results.length >= MAX_LINES) break;
  }
  return results;
}

/** Only DB-owned image paths for this job can resolve a local PDF. No user-provided path enters storage. */
export function drawingPdfSource(
  imageUrl: string,
  jobId: string,
): { storageKey: string; page: number } | null {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      jobId,
    )
  )
    return null;
  const match =
    /^\/api\/job-rooms\/files\/([0-9a-f-]{36})\/(?:([0-9a-f-]{36})\/)?floor-(\d+)\.webp$/i.exec(
      imageUrl,
    );
  if (
    !match ||
    match[1]?.toLowerCase() !== jobId.toLowerCase() ||
    (match[2] &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        match[2],
      ))
  )
    return null;
  const page = Number(match[3]);
  if (!Number.isSafeInteger(page) || page < 1 || page > 2000) return null;
  return {
    storageKey: `${jobId}/${match[2] ? `${match[2]}/` : ""}plan.pdf`,
    page,
  };
}

async function readSchedules(
  sheets: DrawingSheet[],
  jobId: string,
  metadata: Map<string, DrawingMetadata>,
) {
  const lines: EstimateLine[] = [],
    warnings: string[] = [];
  const sources = new Map<string, { sheet: DrawingSheet; page: number }[]>();
  for (const sheet of sheets) {
    const source = drawingPdfSource(sheet.imageUrl, jobId);
    if (!source) {
      warnings.push(
        `${sheet.name}: no trusted uploaded PDF is available for schedule extraction.`,
      );
      continue;
    }
    const entries = sources.get(source.storageKey) ?? [];
    entries.push({ sheet, page: source.page });
    sources.set(source.storageKey, entries);
  }
  let readBytes = 0;
  for (const [key, entries] of sources) {
    try {
      const handle = await openJobRoomFile(key);
      const size = handle.size;
      const fileIdentity = hash(handle.etag ?? "unavailable");
      await handle.close();
      if (size > MAX_PDF_BYTES || readBytes + size > MAX_PDF_BYTES * 2) {
        warnings.push(
          "Uploaded PDF exceeds the bounded schedule extraction budget; measured markups remain available.",
        );
        continue;
      }
      readBytes += size;
      const bytes = await readJobRoomFile(key);
      const pdfHash = hash(bytes);
      const { getDocument, VerbosityLevel } =
        await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({
        data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        useSystemFonts: true,
        verbosity: VerbosityLevel.ERRORS,
        stopAtErrors: true,
      });
      const timer = setTimeout(() => {
        void task.destroy();
      }, 20_000);
      try {
        const pdf = await task.promise;
        for (const { sheet, page: pageNumber } of entries) {
          if (pageNumber > pdf.numPages) {
            warnings.push(`${sheet.name}: source PDF page is unavailable.`);
            continue;
          }
          const page = await pdf.getPage(pageNumber);
          try {
            const content = await page.getTextContent();
            if (
              content.items.length > MAX_TEXT_ITEMS ||
              content.items.reduce(
                (count, item) => count + ("str" in item ? item.str.length : 0),
                0,
              ) > 500_000
            ) {
              warnings.push(
                `${sheet.name}: PDF text exceeds the bounded extraction limit.`,
              );
              continue;
            }
            const viewport = page.getViewport({ scale: 1 });
            const words = content.items.flatMap((item) =>
              "str" in item && item.str.trim()
                ? [pdfTitleBlockWord(item, viewport)]
                : [],
            );
            const schedule = parseDrawingScheduleWords(words);
            for (const row of schedule)
              lines.push(
                newEstimateLine({
                  id: idFor(
                    `schedule:${sheet.id}:${row.rowNumber}:${row.description}`,
                  ),
                  description: row.description,
                  quantity: row.quantity,
                  unit: row.unit,
                  area: sheet.name,
                  source: {
                    kind: "drawing-schedule",
                    sheetId: sheet.id,
                    markupId: `schedule-row-${row.rowNumber}`,
                    label: sheet.name,
                    revision: String(metadata.get(sheet.id)?.revision ?? 0),
                    fingerprint: `s2:${sheetFingerprint(sheet, metadata.get(sheet.id))}:${fileIdentity}:${pdfHash}`,
                    confidence: 0.85,
                    evidence: `PDF page ${pageNumber}, explicit quantity/unit/description columns: ${row.evidence}`,
                  },
                  notes:
                    "Extracted from explicit PDF schedule columns. Verify row boundaries, quantity, scope and pricing.",
                }),
              );
            if (!schedule.length)
              warnings.push(
                `${sheet.name}: no explicit quantity/unit/description schedule found. Geometry and general notes were not converted into material scope.`,
              );
          } finally {
            page.cleanup();
          }
        }
      } finally {
        clearTimeout(timer);
        await task.destroy();
      }
    } catch (error) {
      warnings.push(
        `${entries.map((entry) => entry.sheet.name).join(", ")}: schedule extraction unavailable (${error instanceof Error ? error.message.slice(0, 200) : "PDF read failed"}).`,
      );
    }
  }
  return { lines, warnings };
}

export async function analyzeJobDrawings(input: {
  db: typeof database;
  organizationId: string;
  jobId: string;
  sheetIds?: string[];
  max5?: number;
  maxSheets?: number;
  includeRooms?: boolean;
  existingLines?: EstimateLine[];
  pricingRows?: PricingRow[];
  currency?: EstimatingSettings["currency"];
}) {
  const warnings: string[] = [];
  const limit = Math.max(
    1,
    Math.min(
      MAX_SHEETS,
      Math.trunc(input.maxSheets ?? input.max5 ?? MAX_SHEETS) || MAX_SHEETS,
    ),
  );
  const requested = [...new Set(input.sheetIds ?? [])];
  if (requested.length > limit)
    warnings.push(
      `Only the first ${limit} selected drawings were analyzed in this pass.`,
    );
  const selectedIds = requested.slice(0, limit);
  let sheets: DrawingSheet[] = await input.db
    .select({
      id: jobDrawingSheets.id,
      name: jobDrawingSheets.name,
      imageUrl: jobDrawingSheets.imageUrl,
      width: jobDrawingSheets.width,
      height: jobDrawingSheets.height,
      sourceFilename: jobDrawingSheets.sourceFilename,
    })
    .from(jobDrawingSheets)
    .where(
      and(
        eq(jobDrawingSheets.organizationId, input.organizationId),
        isNull(jobDrawingSheets.documentVersionId),
        eq(jobDrawingSheets.jobId, input.jobId),
        selectedIds.length
          ? inArray(jobDrawingSheets.id, selectedIds)
          : undefined,
      ),
    )
    .orderBy(asc(jobDrawingSheets.sortOrder), asc(jobDrawingSheets.id))
    .limit(limit);
  if (selectedIds.length && sheets.length !== selectedIds.length)
    warnings.push(
      "One or more requested drawings were unavailable for this organization/job.",
    );
  const ids = sheets.map((sheet) => sheet.id);
  const lineBudget = Math.max(
    0,
    Math.min(MAX_LINES, 2000 - (input.existingLines?.length ?? 0)),
  );
  if (!lineBudget)
    return {
      lines: [] as EstimateLine[],
      warnings: [
        ...warnings,
        "The estimate already has 2,000 lines. Remove or consolidate scope before importing more drawing quantities.",
      ],
      sheetIds: ids,
    };
  let entities: DrawingEntity[] = [],
    metadata = new Map<string, DrawingMetadata>();
  if (ids.length) {
    const [storedEntities, storedMetadata] = await Promise.all([
      input.db
        .select({ entity: drawingWorkspaceEntities.entity })
        .from(drawingWorkspaceEntities)
        .where(
          and(
            eq(drawingWorkspaceEntities.organizationId, input.organizationId),
            eq(drawingWorkspaceEntities.jobId, input.jobId),
            inArray(drawingWorkspaceEntities.sheetId, ids),
          ),
        )
        .limit(5001),
      input.db
        .select({
          sheetId: drawingWorkspaceMetadata.sheetId,
          data: drawingWorkspaceMetadata.data,
          revision: drawingWorkspaceMetadata.revision,
        })
        .from(drawingWorkspaceMetadata)
        .where(inArray(drawingWorkspaceMetadata.sheetId, ids)),
    ]);
    entities = storedEntities.slice(0, 5000).map((row) => row.entity);
    if (storedEntities.length > 5000)
      warnings.push(
        "Saved annotations exceeded the 5,000-entity extraction budget; some drawing evidence remains unanalyzed.",
      );
    metadata = new Map(
      storedMetadata.map((row) => [
        row.sheetId,
        { ...row.data, revision: row.revision ?? row.data.revision ?? 0 },
      ]),
    );
  }
  const current = await resolveCurrentDrawingSources({
    ...input,
    sheets,
    metadata,
  });
  sheets = current.sheets;
  warnings.push(...current.warnings);
  const measurements = extractDrawingTakeoff({
    sheets,
    entities,
    metadata,
    existingLines: input.existingLines,
  });
  const schedules = await readSchedules(sheets, input.jobId, metadata);
  warnings.push(...measurements.warnings, ...schedules.warnings);
  const candidates = [...measurements.lines, ...schedules.lines];
  if (input.includeRooms) {
    const rooms = await input.db
      .select({
        id: jobRooms.id,
        floorId: jobRooms.floorId,
        name: jobRooms.name,
        confirmed: jobRooms.confirmed,
        reviewStatus: jobRooms.reviewStatus,
        source: jobRooms.source,
        floorName: jobFloors.name,
        floorStatus: jobFloors.status,
        shape: jobRooms.shape,
        updatedAt: jobRooms.updatedAt,
      })
      .from(jobRooms)
      .innerJoin(
        jobFloors,
        and(
          eq(jobFloors.id, jobRooms.floorId),
          eq(jobFloors.organizationId, input.organizationId),
          eq(jobFloors.jobId, input.jobId),
        ),
      )
      .where(
        and(
          eq(jobRooms.organizationId, input.organizationId),
          eq(jobRooms.jobId, input.jobId),
        ),
      )
      .orderBy(asc(jobRooms.sortOrder), asc(jobRooms.id))
      .limit(501);
    if (rooms.length > 500)
      warnings.push(
        "Room counts exceeded the 500-room extraction budget; additional room scope remains unanalyzed.",
      );
    const visible = rooms.filter(
      (room) =>
        !["rejected", "superseded", "archived"].includes(room.reviewStatus) &&
        !["pending_review", "pending_upload"].includes(room.floorStatus),
    );
    const active = visible.slice(0, 500);
    for (const room of active) {
      const floor = room.floorName;
      candidates.push(
        newEstimateLine({
          id: idFor(`room:${room.floorId}:${room.id}`),
          description: "Room allowance",
          quantity: 1,
          unit: "ea",
          area: `${floor}: ${room.name}`.slice(0, 200),
          source: {
            kind: "room",
            floorId: room.floorId,
            markupId: room.id,
            label: room.name,
            revision: evidenceDate(room.updatedAt),
            fingerprint: roomFingerprint({
              id: room.id,
              floorId: room.floorId,
              name: room.name,
              source: room.source,
              shape: room.shape,
              updatedAt: room.updatedAt,
              floorName: room.floorName,
            }),
            confidence: room.source === "manual" ? 0.9 : 0.5,
            evidence: `Saved active room: ${room.name}; source ${room.source}; persisted status ${room.reviewStatus}. Count allowance only. Physical room correctness, detection completeness, area and assembly scope are unverified.`,
          },
          notes:
            "Verify this room exists, define its scope/assembly and price the allowance before estimate approval. Active detections may omit, split or merge physical rooms.",
        }),
      );
    }
    if (rooms.length !== visible.length)
      warnings.push(
        `${rooms.length - visible.length} rejected/superseded or unaccepted-upload rooms were skipped.`,
      );
    if (active.length)
      warnings.push(
        "Active rooms are unreviewed count allowances. Verify physical room correctness and completeness; stored outlines alone do not establish a physical area or complete job scope.",
      );
  }
  const known = new Set(
    (input.existingLines ?? [])
      .map(estimateSourceKey)
      .filter((key): key is string => Boolean(key)),
  );
  const deduped: EstimateLine[] = [];
  for (const line of candidates) {
    const key = estimateSourceKey(line);
    if (key && known.has(key)) {
      warnings.push(
        `${line.description}: source is already in the estimate and was skipped.`,
      );
      continue;
    }
    if (key) known.add(key);
    deduped.push(line);
    if (deduped.length >= lineBudget) {
      warnings.push(
        lineBudget === MAX_LINES
          ? "Takeoff reached the 500-line review limit; analyze more scope after reviewing these rows."
          : `Takeoff reached the remaining ${lineBudget}-line document budget; additional scope remains unanalyzed.`,
      );
      break;
    }
  }
  const pricing = matchEstimatePricing(deduped, input.pricingRows ?? [], {
    currency: input.currency,
  });
  warnings.push(...pricing.warnings);
  if (!pricing.lines.length)
    warnings.push(
      "No new supported drawing quantities found. Save scaled measurements, explicit schedules or active room counts to generate a takeoff.",
    );
  warnings.push(
    "Generated rows require estimator review. This pass does not establish complete project scope or detect hidden construction requirements.",
  );
  return {
    lines: pricing.lines,
    warnings: [...new Set(warnings)],
    sheetIds: ids,
  };
}

/** Authoritative current-source gate. Call with included rows before approval/sending/material handoff. */
export async function validateDrawingEvidence(input: {
  db: Pick<typeof database, "select">;
  organizationId: string;
  jobId: string;
  lines: EstimateLine[];
  lock?: boolean;
}): Promise<string[]> {
  const warnings: string[] = [];
  const relevant = input.lines.filter(
    (line) =>
      line.reviewStatus !== "excluded" &&
      line.quantity * line.multiplier > 0 &&
      ["drawing-measurement", "drawing-schedule", "room"].includes(
        line.source.kind,
      ),
  );
  for (const line of relevant)
    if (!line.source.fingerprint)
      warnings.push(
        `${line.description}: drawing evidence has no current source fingerprint; regenerate this quantity before approval.`,
      );
  const bound = relevant.filter((line) => line.source.fingerprint);
  const sheetIds = [
    ...new Set(
      bound.flatMap((line) =>
        line.source.sheetId ? [line.source.sheetId] : [],
      ),
    ),
  ];
  const roomIds = [
    ...new Set(
      bound.flatMap((line) =>
        line.source.kind === "room" && line.source.markupId
          ? [line.source.markupId]
          : [],
      ),
    ),
  ];
  const measurementIds = [
    ...new Set(
      bound.flatMap((line) =>
        line.source.kind === "drawing-measurement" && line.source.markupId
          ? [line.source.markupId]
          : [],
      ),
    ),
  ];
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ([...sheetIds, ...roomIds, ...measurementIds].some((id) => !uuid.test(id)))
    return [
      ...warnings,
      "Drawing evidence has an invalid source identifier; regenerate the quantity.",
    ];
  let sheets: DrawingSheet[] = [],
    metadata = new Map<string, DrawingMetadata>(),
    entities: DrawingEntity[] = [];
  if (sheetIds.length) {
    const sheetQuery = input.db
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
          eq(jobDrawingSheets.organizationId, input.organizationId),
        isNull(jobDrawingSheets.documentVersionId),
          eq(jobDrawingSheets.jobId, input.jobId),
          inArray(jobDrawingSheets.id, sheetIds),
        ),
      );
    sheets = await (input.lock ? sheetQuery.for("share") : sheetQuery);
    const available = sheets.map((sheet) => sheet.id);
    if (available.length) {
      const metadataQuery = input.db
        .select({
          sheetId: drawingWorkspaceMetadata.sheetId,
          data: drawingWorkspaceMetadata.data,
          revision: drawingWorkspaceMetadata.revision,
        })
        .from(drawingWorkspaceMetadata)
        .where(inArray(drawingWorkspaceMetadata.sheetId, available));
      const rows = await (input.lock
        ? metadataQuery.for("share")
        : metadataQuery);
      metadata = new Map(
        rows.map((row) => [
          row.sheetId,
          { ...row.data, revision: row.revision ?? row.data.revision ?? 0 },
        ]),
      );
    }
    if (available.length && measurementIds.length) {
      const entityQuery = input.db
        .select({ entity: drawingWorkspaceEntities.entity })
        .from(drawingWorkspaceEntities)
        .where(
          and(
            eq(drawingWorkspaceEntities.organizationId, input.organizationId),
            eq(drawingWorkspaceEntities.jobId, input.jobId),
            inArray(drawingWorkspaceEntities.sheetId, available),
            inArray(drawingWorkspaceEntities.id, measurementIds),
          ),
        );
      entities = (
        await (input.lock ? entityQuery.for("share") : entityQuery)
      ).map((row) => row.entity);
    }
  }
  let rooms: (EvidenceRoom & { reviewStatus: string; floorStatus: string })[] =
    [];
  if (roomIds.length) {
    const roomQuery = input.db
      .select({
        id: jobRooms.id,
        floorId: jobRooms.floorId,
        name: jobRooms.name,
        source: jobRooms.source,
        shape: jobRooms.shape,
        updatedAt: jobRooms.updatedAt,
        reviewStatus: jobRooms.reviewStatus,
        floorName: jobFloors.name,
        floorStatus: jobFloors.status,
      })
      .from(jobRooms)
      .innerJoin(
        jobFloors,
        and(
          eq(jobFloors.id, jobRooms.floorId),
          eq(jobFloors.organizationId, input.organizationId),
          eq(jobFloors.jobId, input.jobId),
        ),
      )
      .where(
        and(
          eq(jobRooms.organizationId, input.organizationId),
          eq(jobRooms.jobId, input.jobId),
          inArray(jobRooms.id, roomIds),
        ),
      );
    rooms = await (input.lock ? roomQuery.for("share") : roomQuery);
  }
  const current = await resolveCurrentDrawingSources({
    ...input,
    sheets,
    metadata,
  });
  sheets = current.sheets;
  warnings.push(...current.warnings);
  const fileIdentities = new Map<string, string | null>();
  for (const line of bound) {
    const source = line.source;
    if (source.kind === "room") {
      const room = rooms.find(
        (room) =>
          room.id === source.markupId && room.floorId === source.floorId,
      );
      if (
        !room ||
        ["rejected", "superseded", "archived"].includes(room.reviewStatus) ||
        ["pending_review", "pending_upload"].includes(room.floorStatus)
      )
        warnings.push(
          `${line.description}: source room is deleted, unavailable or hidden; regenerate/review its scope.`,
        );
      else if (roomFingerprint(room) !== source.fingerprint)
        warnings.push(
          `${line.description}: source room name or geometry changed; regenerate/review its count and scope.`,
        );
      continue;
    }
    const sheet = sheets.find((sheet) => sheet.id === source.sheetId);
    if (!sheet) {
      warnings.push(
        `${line.description}: source drawing is deleted or unavailable in this job.`,
      );
      continue;
    }
    const sheetMetadata = metadata.get(sheet.id);
    if (source.revision !== String(sheetMetadata?.revision ?? 0))
      warnings.push(
        `${line.description}: source drawing workspace revision changed; regenerate/review its evidence.`,
      );
    if (source.kind === "drawing-measurement") {
      const entity = entities.find(
        (entity) =>
          entity.id === source.markupId && entity.sheetId === sheet.id,
      );
      if (
        !entity ||
        entity.kind !== "markup" ||
        entity.visibility !== "published" ||
        !["dimension", "area", "count"].includes(entity.data.type) ||
        !drawingMarkupSchema.safeParse(entity.data).success ||
        entity.data.sourceSheetId !==
          (sheetMetadata?.currentSourceSheetId ?? sheet.id)
      )
        warnings.push(
          `${line.description}: saved measurement is deleted, private, archived or belongs to an old source; regenerate it.`,
        );
      else if (
        measurementFingerprint(entity, sheet, sheetMetadata) !==
        source.fingerprint
      )
        warnings.push(
          `${line.description}: saved measurement geometry, label or scale changed; regenerate/review its quantity.`,
        );
    } else if (source.kind === "drawing-schedule") {
      const fingerprint = source.fingerprint!.split(":");
      const pdf = drawingPdfSource(sheet.imageUrl, input.jobId);
      if (
        !pdf ||
        fingerprint.length !== 4 ||
        fingerprint[0] !== "s2" ||
        fingerprint[1] !== sheetFingerprint(sheet, sheetMetadata)
      ) {
        warnings.push(
          `${line.description}: schedule drawing source changed or is unbound; regenerate the row.`,
        );
        continue;
      }
      if (!fileIdentities.has(pdf.storageKey)) {
        try {
          const file = await openJobRoomFile(pdf.storageKey);
          fileIdentities.set(
            pdf.storageKey,
            file.etag ? hash(file.etag) : null,
          );
          await file.close();
        } catch {
          fileIdentities.set(pdf.storageKey, null);
        }
      }
      if (
        !fileIdentities.get(pdf.storageKey) ||
        fileIdentities.get(pdf.storageKey) !== fingerprint[2]
      )
        warnings.push(
          `${line.description}: source PDF was replaced or is unavailable; regenerate the schedule row.`,
        );
    }
  }
  return [...new Set(warnings)];
}
