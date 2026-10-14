import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discardPdfDocument, loadPdfDocument } from "~/lib/pdf-client";
import { MAX_DRAWING_PATCH_PIXELS } from "~/lib/drawing-viewport";
import { recordDrawingPerformance } from "~/lib/drawing-performance";
import { DrawingPdfLayer } from "./DrawingPdfLayer";

vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn(), discardPdfDocument: vi.fn() }));
vi.mock("~/lib/drawing-performance", () => ({
  recordDrawingPerformance: vi.fn(),
}));
type Pending = {
  resolve: () => void;
  reject: (reason: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
};
const pending: Pending[] = [];
const renderPage = vi.fn(
  (_options: {
    recordOperations?: boolean;
    operationsFilter?: (index: number) => boolean;
  }) => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const cancel = vi.fn();
    pending.push({ resolve, reject, cancel });
    return { promise, cancel };
  },
);
const props = {
  pdf: { url: "/plan.pdf", page: 1 },
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
const finish = (index: number) =>
  act(async () => {
    pending[index]!.resolve();
    await vi.advanceTimersByTimeAsync(1);
  });

beforeEach(() => {
  vi.useFakeTimers();
  pending.length = 0;
  renderPage.mockClear();
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 1000 * scale,
      height: 750 * scale,
    }),
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
  vi.clearAllMocks();
});

function visibleCanvases(container: HTMLElement) {
  return [...container.querySelectorAll("canvas")].filter(
    (canvas) => canvas.style.visibility === "visible",
  );
}

describe("persistent PDF detail during gestures", () => {
  it("positions sharp detail in screen pixels and follows live gestures without a CSS scale", async () => {
    const paintRef = { current: null as ((view: typeof props.view) => void) | null };
    const view = render(<DrawingPdfLayer {...props} screenSpace paintRef={paintRef} />);
    await tick();
    await finish(0);
    const canvas = visibleCanvases(view.container)[0]!;
    const left = parseFloat(canvas.style.left);
    const width = parseFloat(canvas.style.width);
    expect(canvas.style.width.endsWith("px")).toBe(true);
    expect(canvas.width / width).toBeGreaterThan(3);
    act(() => paintRef.current!({ ...props.view, x: 50 }));
    expect(parseFloat(canvas.style.left)).toBeCloseTo(left + 50);
    act(() => paintRef.current!({ ...props.view, scale: 20 }));
    expect(parseFloat(canvas.style.width)).toBeCloseTo(width * 2);
    expect(canvas.style.transform).toBe("");
    expect(pending).toHaveLength(1);
    view.unmount();
    expect(paintRef.current).toBeNull();
  });

  it("sleeps while the sheet is offscreen and resumes when a view is available", async () => {
    const view = render(
      <DrawingPdfLayer {...props} view={{ ...props.view, x: 20_000 }} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pending).toHaveLength(0);
    expect(loadPdfDocument).toHaveBeenCalledTimes(1); // Idle preparation only.
    view.rerender(<DrawingPdfLayer {...props} />);
    await tick();
    expect(pending).toHaveLength(1);
  });

  it("warms the source after the first paint without rasterizing unnecessary detail", async () => {
    const view = render(<DrawingPdfLayer {...props} enabled={false} />);
    await tick();
    expect(loadPdfDocument).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(loadPdfDocument).toHaveBeenCalledWith(props.pdf.url);
    expect(pending).toHaveLength(0);
    view.unmount();
  });

  it("uses the latest view after a cold document load", async () => {
    const document = await loadPdfDocument("/fixture.pdf");
    let loaded!: (value: typeof document) => void;
    vi.mocked(loadPdfDocument).mockReturnValueOnce(
      new Promise((resolve) => {
        loaded = resolve;
      }),
    );
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    expect(pending).toHaveLength(0);
    view.rerender(
      <DrawingPdfLayer {...props} moving view={{ ...props.view, x: 800 }} />,
    );
    await tick();
    await act(async () => {
      loaded(document);
      await Promise.resolve();
    });
    await finish(0);
    // The old viewport is now offscreen; its first render would have been discarded.
    expect(visibleCanvases(view.container)).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it("finishes useful work while moving and keeps it visible without a settle delay", async () => {
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    expect(pending).toHaveLength(1);
    view.rerender(
      <DrawingPdfLayer {...props} moving view={{ ...props.view, x: 20 }} />,
    );
    await tick();
    expect(pending[0]!.cancel).not.toHaveBeenCalled();
    await finish(0);
    expect(visibleCanvases(view.container)).toHaveLength(1);
    expect(pending).toHaveLength(1); // Overscan absorbed the pan; no redundant render.
    view.rerender(
      <DrawingPdfLayer {...props} moving view={{ ...props.view, x: 30 }} />,
    );
    await tick();
    expect(visibleCanvases(view.container)).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it("keeps the front buffer during an edge refill and swaps only when ready", async () => {
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    await finish(0);
    const first = visibleCanvases(view.container)[0]!;
    view.rerender(
      <DrawingPdfLayer {...props} moving view={{ ...props.view, x: 220 }} />,
    );
    await tick();
    expect(pending).toHaveLength(2);
    expect(first.style.visibility).toBe("visible");
    for (const canvas of view.container.querySelectorAll("canvas")) {
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(
        MAX_DRAWING_PATCH_PIXELS,
      );
    }
    await finish(1);
    expect(visibleCanvases(view.container)).toHaveLength(1);
    expect(visibleCanvases(view.container)[0]).not.toBe(first);
    expect(first.style.visibility).toBe("hidden");
  });

  it("coalesces many moving views instead of cancelling and restarting the PDF", async () => {
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    for (let x = 50; x <= 800; x += 50) {
      view.rerender(
        <DrawingPdfLayer {...props} moving view={{ ...props.view, x }} />,
      );
      await tick();
    }
    expect(pending).toHaveLength(1);
    expect(pending[0]!.cancel).not.toHaveBeenCalled();
    await finish(0); // Outdated offscreen work is skipped, latest view rendered next.
    expect(recordDrawingPerformance).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "partial", viewToSharpMs: null }),
    );
    expect(pending).toHaveLength(2);
    await finish(1);
    expect(visibleCanvases(view.container)).toHaveLength(1);
    expect(recordDrawingPerformance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: "sharp",
      }),
    );
    expect(
      typeof vi.mocked(recordDrawingPerformance).mock.calls.at(-1)?.[0]
        .viewToSharpMs,
    ).toBe("number");
  });

  it("never publishes another sheet's late render and cancels on unmount", async () => {
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    view.rerender(
      <DrawingPdfLayer {...props} pdf={{ url: "/other.pdf", page: 2 }} />,
    );
    await tick();
    expect(pending[0]!.cancel).toHaveBeenCalledOnce();
    await finish(0);
    expect(visibleCanvases(view.container)).toHaveLength(0);
    expect(recordDrawingPerformance).not.toHaveBeenCalled();
    await finish(1);
    expect(visibleCanvases(view.container)).toHaveLength(1);
    view.rerender(
      <DrawingPdfLayer {...props} pdf={{ url: "/third.pdf", page: 1 }} />,
    );
    await tick();
    const buffers = [...view.container.querySelectorAll("canvas")];
    view.unmount();
    expect(pending[2]!.cancel).toHaveBeenCalledOnce();
    expect(
      buffers.every((canvas) => canvas.width === 0 && canvas.height === 0),
    ).toBe(true);
  });

  it("keeps good pixels on a failed refill and hides the layer when tiles suffice", async () => {
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    await finish(0);
    view.rerender(
      <DrawingPdfLayer {...props} view={{ ...props.view, x: 220 }} />,
    );
    await tick();
    await act(async () => {
      pending[1]!.reject(new Error("Temporary render failure"));
      await Promise.resolve();
    });
    expect(visibleCanvases(view.container)).toHaveLength(1);
    view.rerender(<DrawingPdfLayer {...props} enabled={false} />);
    expect(
      (view.container.firstElementChild as HTMLElement).style.display,
    ).toBe("none");
  });

  it("backs off repeated failures and recovers a stationary drawing automatically", async () => {
    const view = render(<DrawingPdfLayer {...props} />);
    await tick();
    for (let attempt = 0; attempt < 4; attempt++) {
      await act(async () => {
        pending[attempt]!.reject(new Error("Unreadable PDF"));
        await vi.advanceTimersByTimeAsync(3000 * (attempt + 1) + 1);
      });
    }
    expect(pending).toHaveLength(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(48_000);
    });
    expect(pending).toHaveLength(5);
    await finish(4);
    expect(visibleCanvases(view.container)).toHaveLength(1);
  });
  it("records a complete page once, then filters cropped detail from confirmed bounds", async () => {
    const whole = { ...props, view: { scale: 1, x: 0, y: 0 } };
    const document = await loadPdfDocument(props.pdf.url);
    const page = await document.getPage(1);
    const bounds = {
      isEmpty: () => true,
      minX: () => 0,
      maxX: () => 0,
      minY: () => 0,
      maxY: () => 0,
    };
    const view = render(<DrawingPdfLayer {...whole} />);
    await tick();
    expect(renderPage.mock.calls[0]![0]).toMatchObject({
      recordOperations: true,
      operationsFilter: undefined,
    });
    page.recordedBBoxes = bounds;
    await finish(0);
    view.rerender(<DrawingPdfLayer {...props} />);
    await tick();
    const options = renderPage.mock.calls[1]![0];
    expect(options.recordOperations).toBe(false);
    expect(options.operationsFilter?.(0)).toBe(false);
  });

  it("ignores incomplete bounds from a failed whole-page render when reopening zoomed in", async () => {
    const document = await loadPdfDocument(props.pdf.url);
    const page = await document.getPage(1);
    const view = render(
      <DrawingPdfLayer {...props} view={{ scale: 1, x: 0, y: 0 }} />,
    );
    await tick();
    page.recordedBBoxes = { isEmpty: () => true };
    await act(async () => {
      pending[0]!.reject(new Error("Interrupted rendering"));
      await vi.advanceTimersByTimeAsync(1);
    });
    view.unmount();
    render(<DrawingPdfLayer {...props} />);
    await tick();
    expect(renderPage.mock.calls[1]![0].operationsFilter).toBeUndefined();
  });
});

it("recovers detail after four failures when a new zoom settles", async () => {
  const view = render(<DrawingPdfLayer {...props} />);
  await tick();
  for (let attempt = 0; attempt < 4; attempt++) {
    await act(async () => {
      pending[attempt]!.reject(new Error("Transient memory pressure"));
      await vi.advanceTimersByTimeAsync(3000 * (attempt + 1) + 1);
    });
  }
  expect(pending).toHaveLength(4);
  expect([...view.container.querySelectorAll("canvas")].every(c => c.width === 0)).toBe(true);
  view.rerender(<DrawingPdfLayer {...props} view={{...props.view,scale:3.11}} />);
  await tick();
  expect(pending).toHaveLength(5);
  await finish(4);
  expect(visibleCanvases(view.container)).toHaveLength(1);
});
it("retries exhausted detail after connectivity returns", async () => {
  render(<DrawingPdfLayer {...props} />);
  await tick();
  for (let attempt = 0; attempt < 4; attempt++) {
    await act(async () => {
      pending[attempt]!.reject(new Error("Network error"));
      await vi.advanceTimersByTimeAsync(3000 * (attempt + 1) + 1);
    });
  }
  await act(async () => { window.dispatchEvent(new Event("online")); });
  await tick();
  expect(pending).toHaveLength(5);
});
it("releases the previous canvas only after replacement detail is ready", async () => {
  const view = render(<DrawingPdfLayer {...props} />);
  await tick(); await finish(0);
  const first = visibleCanvases(view.container)[0]!;
  view.rerender(<DrawingPdfLayer {...props} view={{...props.view,scale:20}} />);
  await tick();
  expect(first.width).toBeGreaterThan(0);
  await finish(1);
  expect(first.width).toBe(0);
  expect(visibleCanvases(view.container)[0]!.width).toBeGreaterThan(0);
});
it("cancels a stalled detail task so a later retry can run", async () => {
  render(<DrawingPdfLayer {...props} />);
  await tick();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(pending[0]!.cancel).toHaveBeenCalledOnce();
  await act(async () => {
    pending[0]!.reject(new Error("Rendering cancelled"));
    await vi.advanceTimersByTimeAsync(3001);
  });
  expect(pending).toHaveLength(2);
});

it("times out a stuck document load and retries without changing pages", async () => {
  const loading = new Promise<Awaited<ReturnType<typeof loadPdfDocument>>>(() => undefined);
  vi.mocked(loadPdfDocument).mockReturnValueOnce(loading);
  const view = render(<DrawingPdfLayer {...props} />);
  await tick();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(discardPdfDocument).toHaveBeenCalledWith(props.pdf.url, loading);
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(pending).toHaveLength(1);
  await finish(0);
  expect(visibleCanvases(view.container)).toHaveLength(1);
});

it("does not retry while hidden and resumes when visible again", async () => {
  const view = render(<DrawingPdfLayer {...props} />);
  await tick();
  await act(async () => { pending[0]!.reject(new Error("Temporary failure")); });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(pending).toHaveLength(1);
  vi.restoreAllMocks();
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await tick();
  await finish(1);
  expect(visibleCanvases(view.container)).toHaveLength(1);
});

it("times out a stuck page lookup and ignores its late result", async () => {
  let resolvePage!: (page: unknown) => void;
  const document = await loadPdfDocument("/fixture.pdf");
  const page = await document.getPage(1);
  vi.mocked(loadPdfDocument).mockResolvedValueOnce({
    getPage: () => new Promise((resolve) => { resolvePage = resolve; }),
  } as unknown as typeof document);
  const view = render(<DrawingPdfLayer {...props} />);
  await tick();
  await act(async () => { await vi.advanceTimersByTimeAsync(33_001); });
  expect(pending).toHaveLength(1);
  await finish(0);
  await act(async () => { resolvePage(page); });
  expect(pending).toHaveLength(1);
  expect(visibleCanvases(view.container)).toHaveLength(1);
});
