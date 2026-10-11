// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { db as database } from "~/server/db";
import {
  drawingMarkupSchema,
  drawingMetadataSchema,
  type DrawingEntity,
  type DrawingMetadata,
} from "~/lib/drawing-workspace";
import { newEstimateLine, pricingRowSchema } from "~/lib/estimating/types";
const storage = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn() }));
vi.mock("~/server/rooms/storage", () => ({
  openJobRoomFile: storage.open,
  readJobRoomFile: storage.read,
}));
import {
  analyzeJobDrawings,
  drawingPdfSource,
  extractDrawingTakeoff,
  parseDrawingScheduleText,
  parseDrawingScheduleWords,
  validateDrawingEvidence,
} from "./drawing-analysis";

const sheetId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const organizationId = "00000000-0000-4000-8000-000000000003";
const uploadId = "00000000-0000-4000-8000-000000000004";
const roomId = "00000000-0000-4000-8000-000000000005";
const floorId = "00000000-0000-4000-8000-000000000006";
const sheet = {
  id: sheetId,
  name: "P101",
  width: 2000,
  height: 1000,
  imageUrl: `/api/job-rooms/files/${jobId}/${uploadId}/floor-1.webp`,
  sourceFilename: "fixture.pdf",
};
const metadata: DrawingMetadata = {
  ...drawingMetadataSchema.parse({
    scale: { unitsPerSheetWidth: 100, unit: "ft" },
  }),
  currentSourceSheetId: sheetId,
  revision: 1,
};
function entity(
  type: "dimension" | "area" | "count",
  values = {},
): DrawingEntity {
  return {
    id: `00000000-0000-4000-8000-0000000000${type === "dimension" ? "10" : type === "area" ? "11" : "12"}`,
    kind: "markup",
    sheetId,
    revision: 7,
    visibility: "published",
    authorId: "user",
    authorName: "Estimator",
    createdAt: "2026-10-10T12:00:00Z",
    updatedAt: "2026-10-10T12:00:00Z",
    comments: [],
    data: drawingMarkupSchema.parse({
      sourceSheetId: sheetId,
      type,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.3, y: 0.3 },
        { x: 0.1, y: 0.3 },
      ],
      text: "Copper pipe",
      ...values,
    }),
  };
}
function databaseFixture(reads: unknown[][]) {
  const predicates: SQL[] = [];
  const select = vi.fn(() => {
    const rows = reads.shift();
    if (!rows) throw new Error("Unexpected DB read");
    const query = Object.assign(Promise.resolve(rows), {
      from: (_table: unknown) => query,
      where: (predicate: SQL) => {
        predicates.push(predicate);
        return query;
      },
      orderBy: (..._order: unknown[]) => query,
      innerJoin: (_table: unknown, predicate: SQL) => {
        predicates.push(predicate);
        return query;
      },
      limit: (_limit: number) => query,
      for: (_lock: string) => query,
    });
    return query;
  });
  return { db: { select } as unknown as typeof database, predicates, select };
}
async function schedulePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  for (const [text, x, y] of [
    ["QTY", 40, 700],
    ["UNIT", 100, 700],
    ["DESCRIPTION", 180, 700],
    ["12", 40, 675],
    ["ft", 100, 675],
    ["Copper pipe", 180, 675],
    ["4", 40, 650],
    ["ea", 100, 650],
    ["Isolation valve", 180, 650],
  ] as const)
    page.drawText(text, { x, y, size: 10, font });
  return Buffer.from(await pdf.save());
}
beforeEach(() => vi.resetAllMocks());
describe("stored measurement takeoff", () => {
  it("uses saved branching and disconnected edges without phantom connecting runs", () => {
    const dimension = entity("dimension", {
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.1, y: 0.3 },
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.5 },
      ],
      parents: [null, 0, 0, null, 3],
    });
    const result = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [dimension],
      metadata: new Map([[sheetId, metadata]]),
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.quantity).toBeCloseTo(40, 12);
    expect(result.lines[0]).toMatchObject({
      unit: "ft",
      reviewStatus: "unreviewed",
      materialUnitCost: null,
      priceSource: "missing",
      source: {
        kind: "drawing-measurement",
        sheetId,
        markupId: dimension.id,
        revision: "1",
        confidence: 1,
      },
    });
    expect(result.lines[0]?.source.evidence).toContain(
      "100 ft per sheet width",
    );
  });
  it("uses actual aspect ratio for areas and needs no scale for counts", () => {
    const result = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [entity("area"), entity("count")],
      metadata: new Map([[sheetId, metadata]]),
    });
    expect(result.lines[0]?.quantity).toBeCloseTo(200, 12);
    expect(result.lines[0]?.unit).toBe("ft2");
    expect(result.lines[1]?.quantity).toBe(4);
    expect(result.lines[1]?.unit).toBe("ea");
    expect(
      extractDrawingTakeoff({ sheets: [sheet], entities: [entity("count")] })
        .lines,
    ).toHaveLength(1);
  });
  it("uses scale saved on the markup before current sheet scale", () => {
    const result = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [
        entity("dimension", {
          points: [
            { x: 0, y: 0 },
            { x: 0.4, y: 0 },
          ],
          scale: 25,
          unit: "m",
        }),
      ],
      metadata: new Map([[sheetId, metadata]]),
    });
    expect(result.lines[0]?.quantity).toBe(10);
    expect(result.lines[0]?.unit).toBe("m");
  });
  it("skips absent scales and unit relabeling instead of inventing lengths", () => {
    expect(
      extractDrawingTakeoff({
        sheets: [sheet],
        entities: [entity("dimension")],
      }).warnings[0],
    ).toContain("no valid saved scale");
    const result = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [entity("dimension", { unit: "m" })],
      metadata: new Map([[sheetId, metadata]]),
    });
    expect(result.lines).toHaveLength(0);
    expect(result.warnings[0]).toContain("incompatible");
  });
  it("skips private, archived, malformed and superseded-source markups", () => {
    const privateEntity = {
      ...entity("count"),
      visibility: "private" as const,
    };
    const archived = { ...entity("count"), visibility: "archived" as const };
    const bad = entity("dimension");
    if (bad.kind === "markup")
      bad.data = {
        ...bad.data,
        points: [
          { x: -1, y: 0 },
          { x: 1, y: 1 },
        ],
      };
    const old = entity("count", {
      sourceSheetId: "00000000-0000-4000-8000-000000000099",
    });
    const result = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [privateEntity, archived, bad, old],
      metadata: new Map([[sheetId, metadata]]),
    });
    expect(result.lines).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
  });
  it("does not reimport the same measurement source, even after a revision", () => {
    const measured = entity("count");
    const first = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [measured],
    });
    const second = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [{ ...measured, revision: 8 }],
      existingLines: first.lines,
    });
    expect(second.lines).toHaveLength(0);
    expect(second.warnings[0]).toContain("already");
  });
});
describe("authoritative drawing source freshness", () => {
  it("measures against the tenant-authorized current source dimensions and blocks missing replacement sources", async () => {
    const updatedMetadata = {
      ...metadata,
      currentSourceSheetId: uploadId,
      revision: 9,
    };
    const saved = entity("dimension", {
      sourceSheetId: uploadId,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.1, y: 0.3 },
      ],
    });
    const replacement = {
      ...sheet,
      id: uploadId,
      width: 1000,
      height: 2000,
      imageUrl: sheet.imageUrl.replace("floor-1", "floor-2"),
    };
    storage.open.mockRejectedValue(
      new Error("fixture has no PDF for this case"),
    );
    const reads = (sources: unknown[]) =>
      databaseFixture([
        [sheet],
        [{ entity: saved }],
        [{ sheetId, data: updatedMetadata, revision: 9 }],
        sources,
      ]);
    const db = reads([replacement]);
    const result = await analyzeJobDrawings({
      db: db.db,
      organizationId,
      jobId,
    });
    expect(result.lines[0]?.quantity).toBeCloseTo(40, 12);
    expect(result.lines[0]?.source).toMatchObject({ sheetId, revision: "9" });
    const predicate = new PgDialect().sqlToQuery(db.predicates.at(-1)!);
    expect(predicate.params).toEqual(
      expect.arrayContaining([organizationId, jobId, uploadId]),
    );
    const missing = await analyzeJobDrawings({
      db: reads([]).db,
      organizationId,
      jobId,
    });
    expect(missing.lines).toHaveLength(0);
    expect(
      missing.warnings.some((warning) =>
        warning.includes("current drawing revision"),
      ),
    ).toBe(true);
    const currentValidator = databaseFixture([
      [sheet],
      [{ sheetId, data: updatedMetadata, revision: 9 }],
      [{ entity: saved }],
      [replacement],
    ]).db;
    expect(
      await validateDrawingEvidence({
        db: currentValidator,
        organizationId,
        jobId,
        lines: result.lines,
      }),
    ).toEqual([]);
  });
  it("accepts unchanged measured evidence and detects changed geometry/scale, removed and private markups", async () => {
    const saved = entity("dimension");
    const lines = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [saved],
      metadata: new Map([[sheetId, metadata]]),
    }).lines;
    const reads = (current: DrawingEntity[], currentMetadata = metadata) =>
      databaseFixture([
        [sheet],
        [
          {
            sheetId,
            data: currentMetadata,
            revision: currentMetadata.revision,
          },
        ],
        current.map((entity) => ({ entity })),
      ]).db;
    expect(
      await validateDrawingEvidence({
        db: reads([saved]),
        organizationId,
        jobId,
        lines,
        lock: true,
      }),
    ).toEqual([]);
    const moved = entity("dimension", {
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
      ],
    });
    expect(
      (
        await validateDrawingEvidence({
          db: reads([moved]),
          organizationId,
          jobId,
          lines,
        })
      )[0],
    ).toContain("geometry");
    expect(
      (
        await validateDrawingEvidence({
          db: reads([saved], {
            ...metadata,
            scale: { unitsPerSheetWidth: 200, unit: "ft" },
          }),
          organizationId,
          jobId,
          lines,
        })
      )[0],
    ).toContain("scale");
    expect(
      (
        await validateDrawingEvidence({
          db: reads([]),
          organizationId,
          jobId,
          lines,
        })
      )[0],
    ).toContain("deleted");
    expect(
      (
        await validateDrawingEvidence({
          db: reads([{ ...saved, visibility: "private" }]),
          organizationId,
          jobId,
          lines,
        })
      )[0],
    ).toContain("private");
  });
  it("detects workspace version changes independently of the quantity geometry", async () => {
    const saved = entity("count");
    const lines = extractDrawingTakeoff({
      sheets: [sheet],
      entities: [saved],
      metadata: new Map([[sheetId, metadata]]),
    }).lines;
    const db = databaseFixture([
      [sheet],
      [{ sheetId, data: metadata, revision: 2 }],
      [{ entity: saved }],
    ]).db;
    expect(
      (await validateDrawingEvidence({ db, organizationId, jobId, lines }))[0],
    ).toContain("workspace revision");
  });
  it("binds room names and geometry while keeping implicit detections unreviewed", async () => {
    const room = {
      id: roomId,
      floorId,
      name: "301",
      confirmed: false,
      reviewStatus: "pending",
      source: "auto",
      floorName: "Level 3",
      floorStatus: "detected",
      shape: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      updatedAt: new Date("2026-10-10T12:00:00Z"),
    };
    const generated = await analyzeJobDrawings({
      db: databaseFixture([[], [room]]).db,
      organizationId,
      jobId,
      includeRooms: true,
    });
    expect(generated.lines[0]?.reviewStatus).toBe("unreviewed");
    expect(
      await validateDrawingEvidence({
        db: databaseFixture([[room]]).db,
        organizationId,
        jobId,
        lines: generated.lines,
      }),
    ).toEqual([]);
    expect(
      (
        await validateDrawingEvidence({
          db: databaseFixture([[{ ...room, name: "Renamed" }]]).db,
          organizationId,
          jobId,
          lines: generated.lines,
        })
      )[0],
    ).toContain("changed");
    expect(
      (
        await validateDrawingEvidence({
          db: databaseFixture([[{ ...room, reviewStatus: "superseded" }]]).db,
          organizationId,
          jobId,
          lines: generated.lines,
        })
      )[0],
    ).toContain("hidden");
    expect(
      (
        await validateDrawingEvidence({
          db: databaseFixture([[]]).db,
          organizationId,
          jobId,
          lines: generated.lines,
        })
      )[0],
    ).toContain("deleted");
  });
  it("uses immutable PDF identity to reject replaced schedules without reading/decoding PDF bytes during approval", async () => {
    const pdf = await schedulePdf();
    storage.open.mockResolvedValue({
      size: pdf.length,
      etag: '"fixture-v1"',
      close: vi.fn(),
    });
    storage.read.mockResolvedValue(pdf);
    const generated = await analyzeJobDrawings({
      db: databaseFixture([[sheet], [], []]).db,
      organizationId,
      jobId,
    });
    storage.read.mockClear();
    expect(
      await validateDrawingEvidence({
        db: databaseFixture([[sheet], []]).db,
        organizationId,
        jobId,
        lines: generated.lines,
      }),
    ).toEqual([]);
    expect(storage.read).not.toHaveBeenCalled();
    storage.open.mockResolvedValue({
      size: pdf.length,
      etag: '"fixture-v2"',
      close: vi.fn(),
    });
    expect(
      (
        await validateDrawingEvidence({
          db: databaseFixture([[sheet], []]).db,
          organizationId,
          jobId,
          lines: generated.lines,
        })
      )[0],
    ).toContain("PDF was replaced");
  });
  it("rejects legacy unbound evidence and incorrect room identity without attempting arbitrary paths", async () => {
    const legacy = newEstimateLine({
      description: "Legacy",
      quantity: 1,
      source: {
        kind: "drawing-measurement",
        sheetId,
        markupId: entity("count").id,
      },
    });
    expect(
      (
        await validateDrawingEvidence({
          db: databaseFixture([]).db,
          organizationId,
          jobId,
          lines: [legacy],
        })
      )[0],
    ).toContain("fingerprint");
    const malformed = {
      ...legacy,
      source: {
        ...legacy.source,
        fingerprint: "m1:fake",
        markupId: "../../etc/passwd",
      },
    };
    expect(
      (
        await validateDrawingEvidence({
          db: databaseFixture([]).db,
          organizationId,
          jobId,
          lines: [malformed],
        })
      )[0],
    ).toContain("invalid source identifier");
    expect(storage.open).not.toHaveBeenCalled();
  });
});
describe("explicit schedule extraction", () => {
  it("extracts only labeled numeric quantity/unit rows and retains evidence", () => {
    const text =
      "PLUMBING NOTES\nInstall 10 valves\nQTY | UNIT | DESCRIPTION\n12 | ft | Copper pipe\n4 | ea | Isolation valve\n2-4 | ea | uncertain count\n9 | bananas | unsupported unit\n";
    const result = parseDrawingScheduleText(text);
    expect(
      result.rows.map((row) => [row.quantity, row.unit, row.description]),
    ).toEqual([
      [12, "ft", "Copper pipe"],
      [4, "ea", "Isolation valve"],
    ]);
    expect(result.rows[0]?.evidence).toBe("12 | ft | Copper pipe");
  });
  it("does not read a tag/dimension list or unlabeled notes as material quantities", () => {
    expect(
      parseDrawingScheduleText(
        "DESCRIPTION | LENGTH\nPipe | 20\nInstall 10 valve ea\n",
      ).rows,
    ).toHaveLength(0);
  });
  it("reads multiword descriptions in explicit PDF layout columns", () => {
    const word = (text: string, left: number, bottom: number) => ({
      text,
      left,
      bottom,
      right: left + 0.03,
      top: bottom - 0.01,
    });
    const rows = parseDrawingScheduleWords([
      word("QTY", 0.1, 0.1),
      word("UNIT", 0.2, 0.1),
      word("DESCRIPTION", 0.4, 0.1),
      word("3", 0.1, 0.2),
      word("ea", 0.2, 0.2),
      word("Isolation", 0.4, 0.2),
      word("valve", 0.45, 0.2),
    ]);
    expect(rows[0]).toMatchObject({
      quantity: 3,
      unit: "ea",
      description: "Isolation valve",
    });
  });
  it("resolves only immutable storage paths from the same authorized job", () => {
    expect(drawingPdfSource(sheet.imageUrl, jobId)).toEqual({
      storageKey: `${jobId}/${uploadId}/plan.pdf`,
      page: 1,
    });
    for (const unsafe of [
      "/etc/passwd",
      `https://example.com${sheet.imageUrl}`,
      sheet.imageUrl.replace(jobId, organizationId),
      sheet.imageUrl.replace(uploadId, "../../etc"),
      sheet.imageUrl + "?path=elsewhere",
      sheet.imageUrl.replace("floor-1", "floor-0"),
    ])
      expect(drawingPdfSource(unsafe, jobId)).toBeNull();
  });
});
describe("job drawing import boundary", () => {
  it("reads genuine PDF text from the trusted drawing source and exact uploaded pricing", async () => {
    const pdf = await schedulePdf();
    storage.open.mockResolvedValue({
      size: pdf.length,
      close: vi.fn().mockResolvedValue(undefined),
    });
    storage.read.mockResolvedValue(pdf);
    const db = databaseFixture([[sheet], [], []]);
    const result = await analyzeJobDrawings({
      db: db.db,
      organizationId,
      jobId,
      sheetIds: [sheetId],
      pricingRows: [
        pricingRowSchema.parse({
          id: "p",
          description: "Copper pipe",
          unit: "ft",
          materialUnitCost: 5,
          updatedAt: "2026-10-10",
        }),
      ],
    });
    expect(result.sheetIds).toEqual([sheetId]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      description: "Copper pipe",
      quantity: 12,
      unit: "ft",
      materialUnitCost: 5,
      priceSource: "imported",
      reviewStatus: "unreviewed",
      source: { kind: "drawing-schedule", sheetId, confidence: 0.85 },
    });
    expect(result.lines[1]?.priceSource).toBe("missing");
    expect(storage.read).toHaveBeenCalledWith(`${jobId}/${uploadId}/plan.pdf`);
    const sql = new PgDialect().sqlToQuery(db.predicates[0]!);
    expect(sql.params).toEqual(
      expect.arrayContaining([organizationId, jobId, sheetId]),
    );
  });
  it("does not duplicate schedule sources on repeated generation", async () => {
    const pdf = await schedulePdf();
    storage.open.mockResolvedValue({ size: pdf.length, close: vi.fn() });
    storage.read.mockResolvedValue(pdf);
    const first = await analyzeJobDrawings({
      db: databaseFixture([[sheet], [], []]).db,
      organizationId,
      jobId,
    });
    const second = await analyzeJobDrawings({
      db: databaseFixture([[sheet], [], []]).db,
      organizationId,
      jobId,
      existingLines: first.lines,
    });
    expect(first.lines).toHaveLength(2);
    expect(second.lines).toHaveLength(0);
  });
  it("imports active room count allowances unreviewed and skips rejected rooms", async () => {
    const db = databaseFixture([
      [],
      [
        {
          id: roomId,
          floorId,
          name: "301",
          confirmed: true,
          reviewStatus: "approved",
          source: "manual",
          floorName: "Level 3",
        },
        {
          id: "pending",
          floorId,
          name: "Unreviewed",
          confirmed: false,
          reviewStatus: "pending",
          source: "auto",
          floorName: "Level 3",
        },
        {
          id: "rejected",
          floorId,
          name: "False room",
          confirmed: true,
          reviewStatus: "rejected",
          source: "auto",
          floorName: "Level 3",
        },
      ],
    ]);
    const result = await analyzeJobDrawings({
      db: db.db,
      organizationId,
      jobId,
      includeRooms: true,
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      quantity: 1,
      unit: "ea",
      description: "Room allowance",
      area: "Level 3: 301",
      reviewStatus: "unreviewed",
      materialUnitCost: null,
      source: { kind: "room", floorId, markupId: roomId, confidence: 0.9 },
    });
    expect(result.lines[1]).toMatchObject({
      reviewStatus: "unreviewed",
      source: { kind: "room", confidence: 0.5 },
    });
    expect(result.warnings).toContain(
      "1 rejected/superseded or unaccepted-upload rooms were skipped.",
    );
    expect(storage.read).not.toHaveBeenCalled();
  });
  it("preserves measured takeoff when PDF extraction exceeds limits or fails", async () => {
    storage.open.mockResolvedValue({ size: 100_000_000, close: vi.fn() });
    const db = databaseFixture([[sheet], [{ entity: entity("count") }], []]);
    const result = await analyzeJobDrawings({
      db: db.db,
      organizationId,
      jobId,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("budget"))).toBe(
      true,
    );
    expect(storage.read).not.toHaveBeenCalled();
  });
  it("skips rooms on unaccepted uploads and respects the remaining document line budget", async () => {
    const existingLines = Array.from({ length: 1999 }, (_, index) =>
      newEstimateLine({
        id: `existing-${index}`,
        description: "Manual scope",
        quantity: 1,
      }),
    );
    const room = {
      id: roomId,
      floorId,
      name: "301",
      confirmed: false,
      reviewStatus: "pending",
      source: "auto",
      floorName: "Level 3",
      floorStatus: "detected",
    };
    const db = databaseFixture([
      [],
      [
        room,
        { ...room, id: "other" },
        { ...room, id: "unaccepted", floorStatus: "pending_upload" },
      ],
    ]);
    const result = await analyzeJobDrawings({
      db: db.db,
      organizationId,
      jobId,
      includeRooms: true,
      existingLines,
    });
    expect(result.lines).toHaveLength(1);
    expect(
      result.warnings.some((warning) => warning.includes("unaccepted-upload")),
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.includes("remaining 1-line")),
    ).toBe(true);
  });
  it("handles missing tenant/job sheets without reading any file", async () => {
    const result = await analyzeJobDrawings({
      db: databaseFixture([[]]).db,
      organizationId,
      jobId,
      sheetIds: [sheetId],
    });
    expect(result.lines).toHaveLength(0);
    expect(
      result.warnings.some((warning) => warning.includes("unavailable")),
    ).toBe(true);
    expect(storage.open).not.toHaveBeenCalled();
  });
  it("reports bounded sheet coverage and keeps excluded sources excluded on regeneration", async () => {
    const existing = newEstimateLine({
      quantity: 1,
      description: "Saved count",
      reviewStatus: "excluded",
      source: {
        kind: "drawing-measurement",
        sheetId,
        markupId: entity("count").id,
      },
    });
    const db = databaseFixture([
      [{ ...sheet, imageUrl: "unsafe" }],
      [{ entity: entity("count") }],
      [],
    ]);
    const result = await analyzeJobDrawings({
      db: db.db,
      organizationId,
      jobId,
      sheetIds: Array.from(
        { length: 7 },
        (_, index) => `00000000-0000-4000-8000-0000000000${10 + index}`,
      ),
      existingLines: [existing],
    });
    expect(result.lines).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("first 5"))).toBe(
      true,
    );
  });
});
