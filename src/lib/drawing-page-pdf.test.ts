import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSheetPdfSources,
  mayHavePagePdf,
  sheetPdfSource,
} from "./drawing-page-pdf";
import { hintPdfWhole } from "./pdf-range-source";

vi.mock("./pdf-range-source", () => ({ hintPdfWhole: vi.fn() }));

const base =
  "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/b06815cb-ebac-42e0-8521-db654e9cad60";
const plan = `${base}/plan.pdf`;
const index = {
  v: 1,
  pages: [
    { pdf: 600_000, image: 1_300_000 },
    { pdf: null, image: 900_000 },
    { pdf: 20_000_000, image: null },
  ],
};
let fetched: ReturnType<typeof vi.fn>;

describe("a sheet's own PDF", () => {
  beforeEach(() => {
    clearSheetPdfSources();
    vi.mocked(hintPdfWhole).mockClear();
    fetched = vi.fn(async () => Response.json(index));
    vi.stubGlobal("fetch", fetched);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads a sheet from its page file and asks for it in one request", async () => {
    expect(await sheetPdfSource({ url: plan, page: 1 })).toEqual({
      url: `${base}/pages/1.pdf`,
      page: 1,
      original: { url: plan, page: 1 },
      pdfBytes: 600_000,
      imageBytes: 1_300_000,
    });
    expect(fetched).toHaveBeenCalledWith(
      `${base}/pages/index.json`,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(hintPdfWhole).toHaveBeenCalledWith(`${base}/pages/1.pdf`, 600_000);
  });

  it("asks once per drawing set", async () => {
    await Promise.all([
      sheetPdfSource({ url: plan, page: 1 }),
      sheetPdfSource({ url: plan, page: 3 }),
    ]);
    await sheetPdfSource({ url: plan, page: 2 });
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("keeps to the set for a page without a file of its own", async () => {
    const source = { url: plan, page: 2 };
    expect(await sheetPdfSource(source)).toBe(source);
    const beyond = { url: plan, page: 9 };
    expect(await sheetPdfSource(beyond)).toBe(beyond);
  });

  it("reads a very large page file in ranges", async () => {
    const found = await sheetPdfSource({ url: plan, page: 3 });
    expect(found.url).toBe(`${base}/pages/3.pdf`);
    expect(hintPdfWhole).not.toHaveBeenCalled();
  });

  it("keeps to the set when it is not split yet, and asks again later", async () => {
    vi.useFakeTimers();
    fetched.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const source = { url: plan, page: 1 };
    expect(await sheetPdfSource(source)).toBe(source);
    expect(await sheetPdfSource(source)).toBe(source);
    expect(fetched).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect((await sheetPdfSource(source)).url).toBe(`${base}/pages/1.pdf`);
  });

  it("keeps to the set when the answer cannot be read", async () => {
    const source = { url: plan, page: 1 };
    fetched.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await sheetPdfSource(source)).toBe(source);
    clearSheetPdfSources();
    fetched.mockResolvedValueOnce(Response.json({ pages: "no" }));
    expect(await sheetPdfSource(source)).toBe(source);
  });

  it("leaves other PDFs alone without a request", async () => {
    for (const url of [
      "blob:https://app/1",
      "/api/job-documents/files/0391aed4-7773-47ec-9141-09df373ec008?jobId=b06815cb-ebac-42e0-8521-db654e9cad60",
      "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/plan.pdf",
    ]) {
      const source = { url, page: 1 };
      expect(mayHavePagePdf(source)).toBe(false);
      expect(await sheetPdfSource(source)).toBe(source);
    }
    expect(mayHavePagePdf(null)).toBe(false);
    expect(mayHavePagePdf({ url: plan, page: 4 })).toBe(true);
    expect(fetched).not.toHaveBeenCalled();
  });
});
