import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingTileRequest } from "~/lib/drawing-tiles";
import { DrawingSheetViewer } from "./DrawingSheetViewer";

const capture = vi.hoisted(() => ({ requests: [] as DrawingTileRequest[] }));
vi.mock("./DrawingTileLayer", () => ({
  DrawingTileLayer: ({ requests }: { requests: DrawingTileRequest[] }) => {
    capture.requests = requests;
    return <div data-testid="tiles" />;
  },
}));
vi.mock("./DrawingPdfLayer", () => ({
  DrawingPdfLayer: ({ moving, enabled }: { moving: boolean; enabled: boolean }) => <div data-testid="pdf" data-moving={String(moving)} data-enabled={String(enabled)} />,
}));

const manifest = {
  version: 1, tileSize: 512,
  levels: [{ factor: 2, width: 2000, height: 1000 }, { factor: 4, width: 4000, height: 2000 }],
};

beforeEach(() => {
  vi.useFakeTimers();
  capture.requests = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("ResizeObserver", class {
    observe() { return undefined; }
    disconnect() { return undefined; }
  });
  vi.stubGlobal("devicePixelRatio", 1);
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open() {
  const view = render(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" tiles="/tiles" pdf={{ url: "/plan.pdf", page: 1 }} />);
  const image = screen.getByAltText("Sheet");
  const frame = image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.parentElement!;
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 500 },
  });
  Object.defineProperties(frame, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  fireEvent.load(image);
  return { ...view, frame, image };
}

describe("drawing detail scheduling", () => {
  it("uses original PDF detail at fit and medium zoom even when pre-rendered tiles exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => manifest })));
    const { frame } = open();
    await act(async () => undefined);
    expect(screen.getByTestId("pdf")).toHaveAttribute("data-enabled", "true");
    fireEvent.wheel(frame, { deltaY: -500, clientX: 400, clientY: 300 });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(capture.requests.some((tile) => tile.factor === 2)).toBe(true);
    expect(screen.getByTestId("pdf")).toHaveAttribute("data-enabled", "true");
  });

  it("picks fresh tiles during continued wheel motion instead of waiting for the wheel to stop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => manifest })));
    const { frame, image } = open();
    await act(async () => undefined);
    fireEvent.wheel(frame, { deltaY: -200, clientX: 400, clientY: 300 });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    fireEvent.wheel(frame, { deltaY: -200, clientX: 400, clientY: 300 });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    fireEvent.wheel(frame, { deltaY: -200, clientX: 400, clientY: 300 });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(capture.requests.length).toBeGreaterThan(0);
    expect(screen.getByTestId("pdf").dataset.moving).toBe("true");
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("scale(");
    expect(screen.getByTestId("pdf").closest("[data-drawing-sheet-layer]")).toBeNull();
    expect(screen.getByTestId("pdf").parentElement).toBe(image.closest("[data-drawing-sheet-layer]")!.parentElement);
  });

  it("discovers tiles completed after the drawing opened and cancels retries on unmount", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValue({ ok: true, status: 200, json: async () => manifest });
    vi.stubGlobal("fetch", fetch);
    const { frame, unmount } = open();
    await act(async () => undefined);
    fireEvent.wheel(frame, { deltaY: -800, clientX: 400, clientY: 300 });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(capture.requests).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(capture.requests.length).toBeGreaterThan(0);
    const signal = (fetch.mock.calls[0]![1] as RequestInit).signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds missing-manifest retries and stops immediately on access failure", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const first = open();
    await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
    expect(fetch).toHaveBeenCalledTimes(9);
    first.unmount();
    fetch.mockResolvedValue({ ok: false, status: 403 });
    fetch.mockClear();
    open();
    await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
