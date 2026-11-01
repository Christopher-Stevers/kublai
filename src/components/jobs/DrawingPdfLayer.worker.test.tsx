import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawingPdfRaster } from "~/lib/drawing-pdf-raster-client";
import { loadPdfDocument } from "~/lib/pdf-client";
import type { DrawingPatch } from "~/lib/drawing-viewport";
import { DrawingPdfLayer } from "./DrawingPdfLayer";

vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn(), discardPdfDocument: vi.fn() }));
vi.mock("~/lib/drawing-performance", () => ({ recordDrawingPerformance: vi.fn() }));
vi.mock("~/lib/drawing-pdf-raster-client", () => ({
  canRasterDrawingOffThread: () => true,
  drawingPdfRaster: vi.fn(),
}));

type Job = {
  patch: DrawingPatch;
  resolve: (value: { bitmap: ImageBitmap; renderMs: number }) => void;
  reject: (reason: Error) => void;
};
const jobs: Job[] = [];
const release = vi.fn();
const raster = {
  acquire: vi.fn(() => release),
  warm: vi.fn(),
  render: vi.fn((_url: string, _page: number, patch: DrawingPatch) => {
    let resolve!: Job["resolve"], reject!: Job["reject"];
    const promise = new Promise<{ bitmap: ImageBitmap; renderMs: number }>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    jobs.push({ patch, resolve, reject });
    return { promise, cancel: vi.fn() };
  }),
};
const transferFromImageBitmap = vi.fn();
const renderPage = vi.fn(() => ({ promise: new Promise<void>(() => undefined), cancel: vi.fn() }));
const bitmapFor = (patch: DrawingPatch) => {
  const close = vi.fn();
  const bitmap = { width: patch.pixelWidth, height: patch.pixelHeight, close };
  return { bitmap: bitmap as unknown as ImageBitmap, close };
};
const props = {
  fit: { width: 400, height: 300 },
  frameSize: { width: 400, height: 600 },
  view: { scale: 10, x: 0, y: 0 },
  dpr: 3,
  enabled: true,
  moving: false,
};
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });

beforeEach(() => {
  vi.useFakeTimers();
  jobs.length = 0;
  vi.mocked(drawingPdfRaster).mockReturnValue(
    raster as unknown as ReturnType<typeof drawingPdfRaster>,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((type: string) =>
    type === "bitmaprenderer" ? { transferFromImageBitmap } : null) as unknown as HTMLCanvasElement["getContext"]);
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 1000 * scale, height: 750 * scale }),
    render: renderPage,
    recordedBBoxes: null,
  };
  vi.mocked(loadPdfDocument).mockResolvedValue({
    getPage: async () => page,
  } as unknown as Awaited<ReturnType<typeof loadPdfDocument>>);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PDF detail drawn by the background worker", () => {
  it("shows the worker's bitmap at its own size without parsing the PDF on the page", async () => {
    const view = render(<DrawingPdfLayer {...props} pdf={{ url: "/a.pdf", page: 2 }} />);
    await tick();
    expect(raster.render).toHaveBeenCalledWith("/a.pdf", 2, jobs[0]!.patch);
    const { bitmap, close } = bitmapFor(jobs[0]!.patch);
    await act(async () => {
      jobs[0]!.resolve({ bitmap, renderMs: 5 });
      await vi.advanceTimersByTimeAsync(1);
    });
    const canvas = [...view.container.querySelectorAll("canvas")].find(
      (item) => item.style.visibility === "visible",
    )!;
    expect(transferFromImageBitmap).toHaveBeenCalledWith(bitmap);
    // Sized so markup snapshots can still read the detail back.
    expect([canvas.width, canvas.height]).toEqual([
      jobs[0]!.patch.pixelWidth,
      jobs[0]!.patch.pixelHeight,
    ]);
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(raster.warm).toHaveBeenCalledWith("/a.pdf", 2);
    expect(loadPdfDocument).not.toHaveBeenCalled();
    view.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("closes a bitmap that arrives after the sheet has gone", async () => {
    const view = render(<DrawingPdfLayer {...props} pdf={{ url: "/b.pdf", page: 1 }} />);
    await tick();
    view.unmount();
    const { bitmap, close } = bitmapFor(jobs[0]!.patch);
    await act(async () => {
      jobs[0]!.resolve({ bitmap, renderMs: 5 });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(transferFromImageBitmap).not.toHaveBeenCalledWith(bitmap);
  });

  it("draws a page on the main thread after the worker cannot, and remembers that page", async () => {
    const pdf = { url: "/masked.pdf", page: 1 };
    const view = render(<DrawingPdfLayer {...props} pdf={pdf} />);
    await tick();
    await act(async () => {
      jobs[0]!.reject(new Error("unsupported"));
      await vi.advanceTimersByTimeAsync(1);
    });
    await tick();
    expect(loadPdfDocument).toHaveBeenCalledWith("/masked.pdf");
    expect(renderPage).toHaveBeenCalledTimes(1);
    view.unmount();

    raster.render.mockClear();
    render(<DrawingPdfLayer {...props} pdf={pdf} />);
    await tick();
    await tick();
    expect(raster.render).not.toHaveBeenCalled();
    expect(renderPage).toHaveBeenCalledTimes(2);

    // Other sheets keep using the worker.
    render(<DrawingPdfLayer {...props} pdf={{ url: "/plain.pdf", page: 1 }} />);
    await tick();
    expect(raster.render).toHaveBeenCalledWith("/plain.pdf", 1, expect.anything());
  });
});
