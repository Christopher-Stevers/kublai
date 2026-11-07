// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const m = vi.hoisted(() => ({
  access: vi.fn(),
  can: vi.fn(),
  files: vi.fn(),
  vocabulary: vi.fn(),
  render: vi.fn(),
  read: vi.fn(),
  reserve: vi.fn(),
  configured: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));
vi.mock("node:fs", () => ({
  createReadStream: () =>
    (async function* () {
      yield Buffer.from("PDF");
    })(),
}));
vi.mock("node:fs/promises", () => ({ stat: async () => ({ size: 100 }) }));
vi.mock("~/server/auth/permissions", () => ({ assertCan: m.can }));
vi.mock("~/server/documents/storage", () => ({
  documentBlobPath: () => "document.pdf",
}));
vi.mock("./service", () => ({ accessSheet: m.access }));
vi.mock("./equipment-index", () => ({
  drawingPdfLocation: () => ({ file: "drawing.pdf", page: 1 }),
}));
vi.mock("./equipment-register", () => ({
  jobFiles: m.files,
  jobEquipmentVocabulary: m.vocabulary,
}));
vi.mock("./hyperlink-images", () => ({ hyperlinkImages: m.render }));
vi.mock("./hyperlink-reader-store", () => ({ reserveHyperlinkRun: m.reserve }));
vi.mock("./hyperlink-vision", () => ({
  HYPERLINK_READER_REVISION: "test",
  HYPERLINK_MODELS: { terra: "terra", deepseek: "deepseek" },
  hyperlinkReaderConfigured: m.configured,
  readHyperlinkVision: m.read,
}));
import {
  detectHyperlinkTags,
  hyperlinkReaderOptions,
} from "./hyperlink-readers";
import type { DrawingContext } from "./service";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ctx = {
  userId: "reader",
  db: { update: m.update },
} as unknown as DrawingContext;
const input = {
  sheetId: id(1),
  sourceSheetId: id(2),
  requestId: id(3),
  reader: "terra" as const,
  refresh: false,
};
const result = { reader: "terra", model: "terra", tags: [], warnings: [] };
function access(sheetId: string) {
  return {
    user: {},
    actor: { organizationId: id(5) },
    canAnnotate: true,
    sheet: {
      id: sheetId,
      jobId: id(4),
      organizationId: id(5),
      imageUrl: "image",
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.access.mockImplementation(
    async (_db: unknown, _user: string, sheetId: string) => access(sheetId),
  );
  m.configured.mockReturnValue(true);
  m.files.mockResolvedValue({
    context: {
      access: access(id(1)),
      sheets: [{ id: id(2), imageUrl: "image" }],
      docs: { versions: [] },
    },
  });
  m.vocabulary.mockResolvedValue({
    knownTags: ["AHU-1"],
    pending: 0,
    failed: 0,
  });
  m.reserve.mockResolvedValue({ cached: null });
  m.render.mockResolvedValue({ images: [], words: [] });
  m.read.mockImplementation(async () => structuredClone(result));
  m.update.mockReturnValue({ set: m.set });
  m.set.mockReturnValue({ where: m.where });
  m.where.mockResolvedValue(undefined);
});
it("checks sheet and editing permissions before returning availability or reading a PDF", async () => {
  m.access.mockResolvedValue({ ...access(id(1)), canAnnotate: false });
  await expect(hyperlinkReaderOptions(ctx, id(1))).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(detectHyperlinkTags(ctx, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(m.files).not.toHaveBeenCalled();
  expect(m.render).not.toHaveBeenCalled();
  expect(m.read).not.toHaveBeenCalled();
});
it("rejects disconnected providers and sources outside the readable job", async () => {
  m.configured.mockReturnValue(false);
  await expect(detectHyperlinkTags(ctx, input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  m.configured.mockReturnValue(true);
  m.access.mockImplementation(
    async (_db: unknown, _user: string, sheetId: string) => ({
      ...access(sheetId),
      sheet: {
        ...access(sheetId).sheet,
        jobId: sheetId === id(2) ? id(9) : id(4),
      },
    }),
  );
  await expect(detectHyperlinkTags(ctx, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(m.reserve).not.toHaveBeenCalled();
  expect(m.read).not.toHaveBeenCalled();
});
it("reuses an authorized saved reading without rendering or calling a provider", async () => {
  m.reserve.mockResolvedValue({ cached: result });
  await expect(detectHyperlinkTags(ctx, input)).resolves.toEqual({
    ...result,
    cached: true,
  });
  expect(m.render).not.toHaveBeenCalled();
  expect(m.read).not.toHaveBeenCalled();
  expect(m.can).toHaveBeenCalledWith({}, "drawings.sheetTools");
});
it("rechecks access after a cache lookup and after rendering", async () => {
  const revoked = () =>
    m.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
  m.reserve.mockImplementationOnce(async () => {
    revoked();
    return { cached: result };
  });
  await expect(detectHyperlinkTags(ctx, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  m.access.mockImplementation(
    async (_db: unknown, _user: string, sheetId: string) => access(sheetId),
  );
  m.render.mockImplementationOnce(async () => {
    revoked();
    return { images: [], words: [] };
  });
  await expect(detectHyperlinkTags(ctx, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(m.read).not.toHaveBeenCalled();
  expect(m.set).toHaveBeenCalledWith(
    expect.objectContaining({ status: "failed" }),
  );
});
it("does not publish a reading after its source or permissions change", async () => {
  m.read.mockImplementationOnce(async () => {
    m.access.mockImplementation(
      async (_db: unknown, _user: string, sheetId: string) => ({
        ...access(sheetId),
        sheet: { ...access(sheetId).sheet, imageUrl: "replacement" },
      }),
    );
    return result;
  });
  await expect(detectHyperlinkTags(ctx, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(m.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ status: "done" }),
  );
});
it("persists the chosen reader result, with incomplete schedule evidence clearly flagged", async () => {
  m.vocabulary.mockResolvedValue({
    knownTags: ["AHU-1"],
    pending: 1,
    failed: 0,
  });
  const response = await detectHyperlinkTags(ctx, input);
  expect(response.cached).toBe(false);
  expect(response.warnings[0]).toMatch(/indexing/);
  expect(m.read).toHaveBeenCalledExactlyOnceWith("terra", [], [], ["AHU-1"]);
  expect(m.set).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "done",
    }),
  );
});
it("records failed calls without retrying or switching to another provider", async () => {
  m.read.mockRejectedValue(
    new Error("Terra could not read the drawing (HTTP 429)."),
  );
  await expect(detectHyperlinkTags(ctx, input)).rejects.toThrow("HTTP 429");
  expect(m.read).toHaveBeenCalledTimes(1);
  expect(m.set).toHaveBeenCalledWith(
    expect.objectContaining({ status: "failed" }),
  );
});
