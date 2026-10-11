import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDrawingExportInBackground } from "./drawing-pdf-export-client";
import { clearDrawingGeometryWorkers } from "./drawing-geometry-client";
import type {
  DrawingExportRequest,
  DrawingExportResponse,
} from "./drawing-pdf-export-protocol";
import type { DrawingMarkup } from "./drawing-workspace";

class ExportWorker {
  static instances: ExportWorker[] = [];
  onmessage: ((event: MessageEvent<DrawingExportResponse>) => void) | null =
    null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: DrawingExportRequest[] = [];
  terminate = vi.fn();
  constructor() {
    ExportWorker.instances.push(this);
  }
  postMessage(request: DrawingExportRequest) {
    this.requests.push(request);
  }
  respond(value: DrawingExportResponse) {
    this.onmessage?.({ data: value } as MessageEvent<DrawingExportResponse>);
  }
}
afterEach(() => {
  clearDrawingGeometryWorkers();
  ExportWorker.instances = [];
  vi.unstubAllGlobals();
});
const turn = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const markup: DrawingMarkup = {
  sourceSheetId: "sheet",
  type: "link",
  stroke: "#ff0000",
  width: 2,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
  ],
  text: "AHU-1",
};

describe("background drawing PDF export", () => {
  it("resolves account sources once and preserves each markup destination before worker transfer", async () => {
    vi.stubGlobal("Worker", ExportWorker);
    const resolveSource = vi.fn(async () => "blob:account-source");
    const fallback = vi.fn();
    const result = buildDrawingExportInBackground(
      {
        kind: "package",
        options: {
          resolveSource,
          sheets: [1, 2].map((pageNumber) => ({
            pdfUrl: "/protected.pdf",
            pageNumber,
            markups: [markup],
            markupLinkUrl: () => `https://example.com/page${pageNumber}`,
          })),
        },
      },
      fallback,
    );
    await turn();
    const worker = ExportWorker.instances[0]!;
    const request = worker.requests[0]!;
    expect(resolveSource).toHaveBeenCalledOnce();
    expect(request.kind).toBe("package");
    if (request.kind === "package") {
      expect(request.options.sheets.map((sheet) => sheet.pdfUrl)).toEqual([
        "blob:account-source",
        "blob:account-source",
      ]);
      expect(request.options.sheets.map((sheet) => sheet.linkUrls)).toEqual([
        ["https://example.com/page1"],
        ["https://example.com/page2"],
      ]);
      expect(request.options.sheets[0]).not.toHaveProperty("resolveSource");
      expect(request.options.sheets[0]).not.toHaveProperty("markupLinkUrl");
    }
    const bytes = new Uint8Array([1, 2, 3]);
    worker.respond({ ok: true, bytes });
    expect(await result).toBe(bytes);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });
  it.each(["Cancelled", "Line\nbreak", "中文", "Café"])(
    "preserves the browser font fallback for %s when required",
    async (text) => {
      vi.stubGlobal("Worker", ExportWorker);
      const bytes = new Uint8Array([42]);
      const fallback = vi.fn(async () => bytes);
      if (text === "Cancelled") vi.stubGlobal("Worker", undefined);
      expect(
        await buildDrawingExportInBackground(
          {
            kind: "sheet",
            options: {
              pdfUrl: "/sheet.pdf",
              pageNumber: 1,
              markups: [{ ...markup, text }],
            },
          },
          fallback,
        ),
      ).toBe(bytes);
      expect(fallback).toHaveBeenCalledOnce();
      expect(ExportWorker.instances).toHaveLength(0);
    },
  );
  it("cancels before resolving an account source without submitting private data", async () => {
    vi.stubGlobal("Worker", ExportWorker);
    const controller = new AbortController();
    let resolve!: (url: string) => void;
    const result = buildDrawingExportInBackground(
      {
        kind: "sheet",
        options: {
          pdfUrl: "/sheet.pdf",
          pageNumber: 1,
          signal: controller.signal,
          resolveSource: () =>
            new Promise<string>((done) => {
              resolve = done;
            }),
        },
      },
      vi.fn(),
    );
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    resolve("blob:old-account");
    await rejection;
    expect(ExportWorker.instances[0]!.requests).toHaveLength(0);
    expect(ExportWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it("terminates private export work on logout", async () => {
    vi.stubGlobal("Worker", ExportWorker);
    const result = buildDrawingExportInBackground(
      { kind: "sheet", options: { pdfUrl: "/sheet.pdf", pageNumber: 1 } },
      vi.fn(),
    );
    await turn();
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    clearDrawingGeometryWorkers();
    await rejection;
    expect(ExportWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it("reports a worker startup failure that arrives while the source is resolving", async () => {
    vi.stubGlobal("Worker", ExportWorker);
    let resolve!: (url: string) => void;
    const result = buildDrawingExportInBackground(
      {
        kind: "sheet",
        options: {
          pdfUrl: "/sheet.pdf",
          pageNumber: 1,
          resolveSource: () =>
            new Promise<string>((done) => {
              resolve = done;
            }),
        },
      },
      vi.fn(),
    );
    const rejection = expect(result).rejects.toThrow("worker stopped");
    ExportWorker.instances[0]!.onerror?.();
    resolve("/sheet.pdf");
    await rejection;
    expect(ExportWorker.instances[0]!.requests).toHaveLength(0);
  });
});
