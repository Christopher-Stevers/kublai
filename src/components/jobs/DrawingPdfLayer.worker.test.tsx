import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawingPdfRaster } from "~/lib/drawing-pdf-raster-client";
import { loadPdfDocument } from "~/lib/pdf-client";
import {
  planDrawingPatch,
  type DrawingPatch,
  type DrawingView,
} from "~/lib/drawing-viewport";
import { DrawingPdfLayer } from "./DrawingPdfLayer";

const strain = vi.hoisted(() => ({ strained: false }));
vi.mock("~/lib/drawing-render-strain", () => ({
  createDrawingRenderStrain: () => ({
    frame: () => undefined,
    get strained() {
      return strain.strained;
    },
  }),
}));
vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn(), discardPdfDocument: vi.fn() }));
vi.mock("~/lib/drawing-performance", () => ({ recordDrawingPerformance: vi.fn() }));
vi.mock("~/lib/drawing-pdf-raster-client", () => ({
  canRasterDrawingOffThread: () => true,
  drawingPdfRaster: vi.fn(),
  isRasterCancel: (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError",
}));

type Job = {
  patch: DrawingPatch;
  resolve: (value: { bitmap: ImageBitmap; renderMs: number }) => void;
  reject: (reason: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
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
    const cancel = vi.fn();
    jobs.push({ patch, resolve, reject, cancel });
    return { promise, cancel };
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
  strain.strained = false;
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

  it("draws ahead of a pan while it is moving and drops that render once the view settles elsewhere", async () => {
    const paintRef: { current: ((view: DrawingView) => void) | null } = { current: null };
    const pdf = { url: "/pan.pdf", page: 1 };
    const view = render(<DrawingPdfLayer {...props} pdf={pdf} paintRef={paintRef} />);
    await tick();
    const first = jobs[0]!;
    await act(async () => {
      first.resolve({ bitmap: bitmapFor(first.patch).bitmap, renderMs: 20 });
      await vi.advanceTimersByTimeAsync(1);
    });
    view.rerender(<DrawingPdfLayer {...props} pdf={pdf} paintRef={paintRef} moving />);
    await tick();
    expect(jobs).toHaveLength(1);

    // The live camera pans each frame without React seeing a new view.
    let x = 0;
    for (let frame = 0; frame < 6 && jobs.length === 1; frame++) {
      x -= 16;
      act(() => paintRef.current!({ ...props.view, x }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    }
    expect(jobs).toHaveLength(2);
    const ahead = jobs[1]!.patch;
    const centred = planDrawingPatch(props.fit, props.frameSize, { ...props.view, x }, props.dpr)!;
    expect(ahead.left).toBeGreaterThan(centred.left);

    // The pan comes to rest somewhere that render does not cover.
    const rest = { ...props.view, x: x - 2000 };
    act(() => paintRef.current!(rest));
    view.rerender(<DrawingPdfLayer {...props} pdf={pdf} paintRef={paintRef} view={rest} />);
    expect(jobs[1]!.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      jobs[1]!.reject(new DOMException("cancelled", "AbortError"));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(jobs).toHaveLength(3);
    expect(jobs[2]!.patch).toEqual(
      planDrawingPatch(props.fit, props.frameSize, rest, props.dpr),
    );
    expect(loadPdfDocument).not.toHaveBeenCalled();
  });

  it("moves to the main thread when the worker drops a render the layer still wanted", async () => {
    render(<DrawingPdfLayer {...props} pdf={{ url: "/closed.pdf", page: 1 }} />);
    await tick();
    await act(async () => {
      jobs[0]!.reject(new DOMException("closed", "AbortError"));
      await vi.advanceTimersByTimeAsync(1);
    });
    await tick();
    expect(jobs).toHaveLength(1);
    expect(loadPdfDocument).toHaveBeenCalledWith("/closed.pdf");
  });

  it("keeps to settled refills on a device that misses frames for each new bitmap", async () => {
    strain.strained = true;
    const paintRef: { current: ((view: DrawingView) => void) | null } = { current: null };
    const pdf = { url: "/slow.pdf", page: 1 };
    const view = render(<DrawingPdfLayer {...props} pdf={pdf} paintRef={paintRef} />);
    await tick();
    await act(async () => {
      jobs[0]!.resolve({ bitmap: bitmapFor(jobs[0]!.patch).bitmap, renderMs: 20 });
      await vi.advanceTimersByTimeAsync(1);
    });
    view.rerender(<DrawingPdfLayer {...props} pdf={pdf} paintRef={paintRef} moving />);
    let x = 0;
    for (let frame = 0; frame < 6; frame++) {
      x -= 16;
      act(() => paintRef.current!({ ...props.view, x }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    }
    // Most of the bitmap is still on screen; it moves instead of redrawing.
    expect(jobs).toHaveLength(1);
    const far = { ...props.view, x: -300 };
    act(() => paintRef.current!(far));
    await tick();
    expect(jobs).toHaveLength(2);
    expect(jobs[1]!.patch).toEqual(
      planDrawingPatch(props.fit, props.frameSize, far, props.dpr),
    );
  });
});
