import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PdfClient from "./pdf-client";
import { loadPdfDocument } from "./pdf-client";
import {
  clearDrawingPdfLinks,
  drawingPdfLinkTarget,
  drawingPdfLinkUrl,
  readDrawingPdfLinks,
} from "./drawing-pdf-links";
vi.mock("./pdf-client", async (importOriginal) => ({
  ...(await importOriginal<typeof PdfClient>()),
  loadPdfDocument: vi.fn(),
}));
const source = { url: "/private.pdf", page: 1 };
function fixture(annotations: unknown[], rotated = false) {
  const document = {
    numPages: 3,
    getPage: vi.fn(async () => ({
      getViewport: () => ({
        width: rotated ? 100 : 200,
        height: rotated ? 200 : 100,
        convertToViewportPoint: (x: number, y: number) =>
          rotated ? [y - 20, x - 10] : [x - 10, 120 - y],
      }),
      getAnnotations: async () => annotations,
    })),
    getDestination: vi.fn(async (name: string) => {
      if (name === "broken") throw Error("Broken destination");
      return name === "section" ? [{ num: 9, gen: 0 }, { name: "Fit" }] : null;
    }),
    getPageIndex: vi.fn(async () => 2),
  };
  vi.mocked(loadPdfDocument).mockResolvedValue(
    document as unknown as Awaited<ReturnType<typeof loadPdfDocument>>,
  );
  return document;
}
const annotation = (extra: object) => ({
  subtype: "Link",
  rect: [30, 40, 70, 60],
  ...extra,
});
beforeEach(() => {
  clearDrawingPdfLinks();
  vi.clearAllMocks();
});
describe("original PDF hyperlinks", () => {
  it("retains external links and numeric, named, and indirect page destinations", async () => {
    fixture([
      annotation({ url: "https://example.com/detail" }),
      annotation({ dest: [1, { name: "Fit" }] }),
      annotation({ dest: "section" }),
      annotation({ dest: [{ num: 9, gen: 0 }] }),
    ]);
    expect(await readDrawingPdfLinks(source)).toEqual([
      {
        left: 0.1,
        top: 0.6,
        right: 0.3,
        bottom: 0.8,
        url: "https://example.com/detail",
      },
      { left: 0.1, top: 0.6, right: 0.3, bottom: 0.8, page: 2 },
      { left: 0.1, top: 0.6, right: 0.3, bottom: 0.8, page: 3 },
      { left: 0.1, top: 0.6, right: 0.3, bottom: 0.8, page: 3 },
    ]);
  });
  it("aligns link regions on rotated pages with an offset crop box", async () => {
    fixture([annotation({ url: "https://example.com" })], true);
    expect(await readDrawingPdfLinks(source)).toEqual([
      {
        left: 0.2,
        top: 0.1,
        right: 0.4,
        bottom: 0.3,
        url: "https://example.com/",
      },
    ]);
  });
  it("keeps later links when a destination is broken and rejects invisible, invalid, or executable links", async () => {
    fixture([
      null,
      annotation({ dest: "broken" }),
      annotation({ dest: "missing" }),
      annotation({ dest: [1.5] }),
      annotation({ dest: [3] }),
      annotation({ dest: [-1] }),
      annotation({ url: "javascript:alert(1)" }),
      annotation({ url: "https://user:password@example.com" }),
      annotation({ rect: [0, 0, NaN, 1], url: "https://example.com" }),
      annotation({ rect: [0, 0, 0, 0], url: "https://example.com" }),
      annotation({ url: "mailto:plans@example.com" }),
    ]);
    expect(await readDrawingPdfLinks(source)).toEqual([
      {
        left: 0.1,
        top: 0.6,
        right: 0.3,
        bottom: 0.8,
        url: "mailto:plans@example.com",
      },
    ]);
  });
  it.each([
    "https://example.com/",
    "http://example.com/",
    "mailto:plans@example.com",
    "tel:+15555551212",
  ])("preserves supported address %s", (url) => {
    expect(drawingPdfLinkUrl(url)).toBe(url);
  });
  it("caches per page and discards parsed private links after account changes", async () => {
    const document = fixture([annotation({ url: "https://example.com" })]);
    await readDrawingPdfLinks(source);
    await readDrawingPdfLinks(source);
    expect(document.getPage).toHaveBeenCalledOnce();
    clearDrawingPdfLinks();
    await readDrawingPdfLinks(source);
    expect(document.getPage).toHaveBeenCalledTimes(2);
  });
  it("rejects results completed after account invalidation", async () => {
    fixture([]);
    const result = readDrawingPdfLinks(source);
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    clearDrawingPdfLinks();
    await rejected;
  });
  it("resolves a linked page only within its original upload, regardless of sheet order or name", () => {
    const base =
      "/api/job-rooms/files/65eef309-0b45-4aa1-bc39-8dfe5a3297ab/5d9a7cbd-7c52-48ed-b7ca-d14f423b3e19";
    const sheets = [
      {
        id: "other-upload",
        imageUrl: `${base.replace("5d9a7cbd", "6d9a7cbd")}/floor-2.webp`,
      },
      { id: "linked", name: "Renamed sheet", imageUrl: `${base}/floor-2.webp` },
    ];
    const origin = { url: `${base}/plan.pdf`, page: 1 };
    expect(
      drawingPdfLinkTarget(
        { left: 0, top: 0, right: 1, bottom: 1, page: 2 },
        origin,
        sheets,
      )?.id,
    ).toBe("linked");
    expect(
      drawingPdfLinkTarget(
        { left: 0, top: 0, right: 1, bottom: 1, page: 3 },
        origin,
        sheets,
      ),
    ).toBeUndefined();
  });
});
