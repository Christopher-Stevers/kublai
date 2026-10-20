// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  access: vi.fn(),
  sheets: vi.fn(),
  documentAccess: vi.fn(),
  overview: vi.fn(),
  index: vi.fn(),
  versions: [] as unknown[],
  metadata: [] as unknown[],
}));
vi.mock("./service", () => ({
  accessSheet: mock.access,
  jobSheets: mock.sheets,
}));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: mock.documentAccess,
}));
vi.mock("~/server/documents/service", () => ({
  documentOverview: mock.overview,
}));
vi.mock("~/server/documents/storage", () => ({
  documentBlobPath: () => "/private/test.pdf",
}));
vi.mock("./equipment-index", () => ({
  equipmentIndex: mock.index,
  drawingPdfLocation: () => ({ file: "/private/plan.pdf", page: 1 }),
}));
import {
  equipmentMatches,
  equipmentMatchesBatch,
  equipmentSources,
} from "./equipment-links";
import { clearEquipmentRegisters } from "./equipment-register";
import { drawingWorkspaceEntities } from "~/server/db/drawing-workspace-schema";
import type { DrawingContext } from "./service";
const ctx = {
  userId: "user",
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === drawingWorkspaceEntities ? mock.versions : mock.metadata,
      }),
    }),
  },
} as unknown as DrawingContext;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const a = { id: uuid(1), setId: uuid(3), name: "A", imageUrl: "a" },
  b = { id: uuid(2), setId: uuid(3), name: "B", imageUrl: "b" };
beforeEach(() => {
  vi.clearAllMocks();
  clearEquipmentRegisters();
  mock.access.mockResolvedValue({
    sheet: { ...a, jobId: uuid(4), organizationId: "org" },
    actor: { organizationId: "org" },
  });
  mock.sheets.mockResolvedValue([
    a,
    b,
    { ...b, id: "foreign", setId: "other" },
  ]);
  mock.versions = [];
  mock.metadata = [];
  mock.documentAccess.mockResolvedValue({ job: { organizationId: "org" } });
  mock.overview.mockResolvedValue({ documents: [], versions: [] });
  mock.index.mockResolvedValue({
    pages: [{ page: 1, words: [] }],
    incomplete: false,
  });
});
it("loads shared data and a PDF index once for a batch of matching pages", async () => {
  const pages = Array.from({ length: 32 }, (_, n) => ({
    ...b,
    id: uuid(100 + n),
    name: `M-${n}`,
  }));
  mock.sheets.mockResolvedValue([a, ...pages]);
  mock.index.mockResolvedValue({
    pages: [
      {
        page: 1,
        words: [
          { text: "HEX-2", left: 0.1, right: 0.2, top: 0.1, bottom: 0.2 },
          { text: "HEX-20", left: 0.4, right: 0.5, top: 0.4, bottom: 0.5 },
        ],
      },
    ],
  });
  const result = await equipmentMatchesBatch(ctx, {
    sheetId: a.id,
    tag: "HEX-2",
    sources: pages.map((p) => ({ kind: "drawing", id: p.id, name: p.name })),
  });
  expect(result.results).toHaveLength(32);
  expect(result.results.every((r) => r.links.length === 1)).toBe(true);
  expect(mock.access).toHaveBeenCalledOnce();
  expect(mock.overview).toHaveBeenCalledOnce();
  expect(mock.index).toHaveBeenCalledOnce();
});
it("excludes the source and superseded pages even when the client requests them", async () => {
  for (const target of [a, b]) {
    mock.versions = [
      { entity: { kind: "version", data: { sourceSheetId: b.id } } },
    ];
    await expect(
      equipmentMatches(ctx, {
        sheetId: a.id,
        tag: "HEX-2",
        source: { kind: "drawing", id: target.id, name: target.name },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  expect(mock.index).not.toHaveBeenCalled();
});
it("refuses a page in another drawing set", async () => {
  await expect(
    equipmentMatches(ctx, {
      sheetId: a.id,
      tag: "HEX-2",
      source: { kind: "drawing", id: "foreign", name: "Fake" },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mock.index).not.toHaveBeenCalled();
});
it("does not inspect private or deleted documents excluded by document access", async () => {
  await expect(
    equipmentMatches(ctx, {
      sheetId: a.id,
      tag: "HEX-2",
      source: { kind: "document", id: "hidden", name: "Fake" },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mock.index).not.toHaveBeenCalled();
});
it("keeps metadata matches even when contents cannot be indexed and reports the gap", async () => {
  mock.overview.mockResolvedValue({
    documents: [
      {
        id: "doc",
        name: "HEX-2 datasheet",
        description: "",
        tags: [],
        currentVersionId: "version",
      },
    ],
    versions: [
      {
        id: "version",
        name: "data.pdf",
        mimeType: "application/pdf",
        sha256: "hash",
      },
    ],
  });
  mock.index.mockRejectedValue(Error("timeout"));
  const result = await equipmentMatches(ctx, {
    sheetId: a.id,
    tag: "HEX-2",
    source: { kind: "document", id: "doc", name: "Fake" },
  });
  expect(result.links).toHaveLength(1);
  expect(result.links[0]!.label).toBe("HEX-2 — HEX-2 datasheet");
  expect(result.warnings).toHaveLength(1);
});
it("groups common equipment tags by sheet for automatic scans without losing the sheet to an occurrence limit", async () => {
  mock.index.mockResolvedValue({
    pages: [
      {
        page: 1,
        words: Array.from({ length: 80 }, (_, i) => ({
          text: "WC-1",
          left: 0.1 + (i % 10) * 0.03,
          right: 0.12 + (i % 10) * 0.03,
          top: 0.1 + Math.floor(i / 10) * 0.03,
          bottom: 0.11 + Math.floor(i / 10) * 0.03,
        })),
      },
    ],
    incomplete: false,
  });
  const result = await equipmentMatchesBatch(ctx, {
    sheetId: a.id,
    tag: "WC-1",
    sources: [{ kind: "drawing", id: b.id, name: b.name }],
    groupBySheet: true,
  });
  expect(result.results[0]?.links).toHaveLength(1);
  expect(result.results[0]?.overflow).toBe(false);
});
it("uses accessible drawing schedules to recognize custom tag names", async () => {
  mock.index.mockResolvedValue({
    pages: [
      {
        page: 1,
        words: [
          {
            text: "EQUIPMENT SCHEDULE",
            left: 0.1,
            right: 0.4,
            top: 0.05,
            bottom: 0.06,
          },
          { text: "TAG", left: 0.1, right: 0.13, top: 0.1, bottom: 0.11 },
          { text: "ZBC-7", left: 0.09, right: 0.14, top: 0.15, bottom: 0.16 },
        ],
      },
    ],
  });
  const result = await equipmentSources(ctx, a.id);
  expect(result.knownTags).toEqual(["ZBC-7"]);
  expect(result.sources).toEqual([{ kind: "drawing", id: b.id, name: b.name }]);
  mock.index.mockClear();
  mock.access.mockRejectedValue(Error("No access"));
  await expect(equipmentSources(ctx, a.id)).rejects.toThrow("No access");
  expect(mock.index).not.toHaveBeenCalled();
});
it("keeps standard detection available and reports unreadable schedules", async () => {
  mock.index.mockRejectedValue(Error("timeout"));
  const result = await equipmentSources(ctx, a.id);
  expect(result.knownTags).toEqual([]);
  expect(result.sources).toHaveLength(1);
  expect(result.warnings).toEqual([
    expect.stringContaining("could not be read"),
  ]);
});

it("opens a submittal at its exact PDF page and tag even when metadata already matches", async () => {
  const docId = uuid(40), versionId = uuid(41);
  mock.overview.mockResolvedValue({documents:[{id:docId,name:"HEX-2 submittal",description:"",tags:[],currentVersionId:versionId}],versions:[{id:versionId,name:"submittal.pdf",mimeType:"application/pdf",sha256:"hash"}]});
  mock.index.mockResolvedValue({pages:[{page:1,words:[{text:"HEX-20",left:.1,right:.2,top:.2,bottom:.22}]},{page:7,words:[{text:"HEX-2",left:.6,right:.7,top:.3,bottom:.32}]}],incomplete:false});
  const result = await equipmentMatches(ctx,{sheetId:a.id,tag:"HEX-2",source:{kind:"document",id:docId,name:"Submittal"}});
  expect(result.links).toHaveLength(1);
  const url=new URL(result.links[0]!.url!,"https://example.com");
  const state=JSON.parse(decodeURIComponent(url.hash.slice("#snapshot=".length)));
  expect(state.document).toMatchObject({documentId:docId,versionId});
  expect(state.pdf.page).toBe(7);
  expect(state.pdf.viewport.center.x).toBeCloseTo(.65);
  expect(state.pdf.viewport.center.y).toBeCloseTo(.31);
  expect(state.pdf.viewport.zoom).toBeGreaterThan(1);
});

it("finds a clicked tag's schedule row, other drawings and documents across the job", async () => {
  const { equipmentTagDestinations } = await import("./equipment-register");
  const docId = uuid(50), versionId = uuid(51);
  mock.sheets.mockResolvedValue([a, b]);
  mock.overview.mockResolvedValue({documents:[{id:docId,name:"Pump submittal",description:"",tags:[],currentVersionId:versionId}],versions:[{id:versionId,name:"p.pdf",mimeType:"application/pdf",sha256:"hash"}]});
  const word = (text: string, left: number, top: number) => ({ text, left, right: left + 0.04, top, bottom: top + 0.01 });
  mock.index.mockImplementation(async (file: string) => file === "/private/plan.pdf"
    ? { pages: [{ page: 1, words: [
        word("PUMP SCHEDULE", 0.1, 0.05), word("TAG", 0.1, 0.1), word("GPM", 0.2, 0.1),
        word("P-1", 0.1, 0.15), word("150", 0.2, 0.15), word("P-2", 0.1, 0.2), word("90", 0.2, 0.2),
        word("P-1", 0.6, 0.6), word("P-10", 0.7, 0.7),
      ] }], incomplete: false }
    : { pages: [{ page: 1, words: [] }, { page: 4, words: [word("P-1", 0.5, 0.5)] }], incomplete: false });
  const result = await equipmentTagDestinations(ctx, { sheetId: a.id, tag: "p-1", exclude: { left: 0.59, right: 0.65, top: 0.59, bottom: 0.62 } });
  expect(result.tag).toBe("P-1");
  expect(result.schedules.map((s) => [s.title, s.cells, s.source])).toEqual([
    ["PUMP SCHEDULE", ["150"], "A"],
    ["PUMP SCHEDULE", ["150"], "B"],
  ]);
  // The viewed sheet comes first, without the occurrence that was clicked.
  expect(result.drawings.map((d) => [d.name, d.here, d.links.length])).toEqual([["A", true, 1], ["B", false, 2]]);
  expect(result.documents).toEqual([expect.objectContaining({ documentId: docId, pages: [4] })]);
  expect(result.documents[0]!.url).toContain("#snapshot=");
  expect(result.warnings).toEqual([]);
  await expect(equipmentTagDestinations(ctx, { sheetId: a.id, tag: "ZONE" })).rejects.toThrow("equipment tag");
});
