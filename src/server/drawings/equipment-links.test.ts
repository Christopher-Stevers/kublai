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
import { equipmentMatches, equipmentMatchesBatch } from "./equipment-links";
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
