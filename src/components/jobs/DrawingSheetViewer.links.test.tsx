import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingSheetViewer } from "./DrawingSheetViewer";
import { readDrawingPdfLinks } from "~/lib/drawing-pdf-links";
import type { ComponentProps } from "react";
vi.mock("~/lib/drawing-pdf-links", () => ({ readDrawingPdfLinks: vi.fn() }));
vi.mock("./DrawingPdfLayer", () => ({ DrawingPdfLayer: () => null }));
vi.mock("./DrawingComparisonLayer", () => ({
  DrawingComparisonLayer: () => null,
}));
vi.mock("~/lib/pdf-sheet-scale", () => ({
  readPdfSheetScale: async () => null,
}));
const link = { left: 0.25, top: 0.25, right: 0.5, bottom: 0.5, page: 2 };
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() { return undefined; }
      disconnect() { return undefined; }
    },
  );
  HTMLElement.prototype.setPointerCapture = () => undefined;
  vi.mocked(readDrawingPdfLinks).mockResolvedValue([link]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function open(
  props: Partial<ComponentProps<typeof DrawingSheetViewer>> = {},
) {
  const onPdfLink = vi.fn();
  const defaults = {
    src: "/sheet.webp",
    alt: "Sheet",
    pdf: { url: "/fixture.pdf", page: 1 },
    onPdfLink,
  };
  const view = render(<DrawingSheetViewer {...defaults} {...props} />);
  const image = screen.getByAltText("Sheet");
  const frame = image.closest<HTMLElement>(
    "[data-drawing-sheet-layer]",
  )!.parentElement!;
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 500 },
  });
  Object.defineProperties(frame, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  fireEvent.load(image);
  await waitFor(() =>
    expect(readDrawingPdfLinks).toHaveBeenCalledWith(defaults.pdf),
  );
  return { ...view, frame, image, onPdfLink, defaults };
}
const point = { clientX: 300, clientY: 250, pointerId: 1, button: 0 };
function tap(frame: Element) {
  fireEvent.pointerDown(frame, point);
  fireEvent.pointerUp(frame, point);
}
describe("PDF hyperlinks directly on drawings", () => {
  it("opens retained links without using search and supplies matching keyboard link regions", async () => {
    const { frame, onPdfLink, image } = await open();
    const region = await screen.findByRole("link", { name: "Open PDF page 2" });
    expect(region).toHaveAttribute("x", "250");
    expect(region).toHaveAttribute("y", "125");
    expect(region.closest("svg")?.parentElement).toBe(
      image.closest("[data-drawing-sheet-layer]"),
    );
    tap(frame);
    expect(onPdfLink).toHaveBeenCalledExactlyOnceWith(link);
    fireEvent.keyDown(region, { key: "Enter" });
    expect(onPdfLink).toHaveBeenCalledTimes(2);
  });
  it("pans across a link without following it, even if the drag returns to its start", async () => {
    const { frame, onPdfLink, image } = await open();
    fireEvent.pointerDown(frame, point);
    fireEvent.pointerMove(frame, { ...point, clientX: 380, clientY: 290 });
    expect(
      image.closest<HTMLElement>("[data-drawing-sheet-layer]")!.style.transform,
    ).toContain("translate3d(80px, 40px, 0)");
    fireEvent.pointerMove(frame, point);
    fireEvent.pointerUp(frame, point);
    expect(onPdfLink).not.toHaveBeenCalled();
  });
  it("cancels link taps during pinch gestures and pointer cancellation", async () => {
    const { frame, onPdfLink } = await open();
    fireEvent.pointerDown(frame, point);
    fireEvent.pointerDown(frame, { ...point, pointerId: 2, clientX: 500 });
    fireEvent.pointerUp(frame, { ...point, pointerId: 2, clientX: 500 });
    fireEvent.pointerUp(frame, point);
    fireEvent.pointerDown(frame, point);
    fireEvent.pointerCancel(frame, point);
    fireEvent.pointerUp(frame, point);
    expect(onPdfLink).not.toHaveBeenCalled();
  });
  it("lets annotation tools work over the original link region", async () => {
    const onCreate = vi.fn();
    const { frame, onPdfLink } = await open({ tool: "text", onCreate });
    expect(screen.queryByRole("link")).toBeNull();
    tap(frame);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onPdfLink).not.toHaveBeenCalled();
  });
  it("discards links from the previous source immediately and ignores a late parse after navigation", async () => {
    const { rerender, defaults } = await open();
    await screen.findByRole("link");
    let release!: (value: (typeof link)[]) => void;
    vi.mocked(readDrawingPdfLinks).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    rerender(
      <DrawingSheetViewer
        {...defaults}
        pdf={{ url: "/second.pdf", page: 1 }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<DrawingSheetViewer {...defaults} pdf={null} />);
    release([link]);
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  });
  it.each(["measure", "pipe"] as const)(
    "keeps PDF links inactive in %s mode",
    async (mode) => {
      const { rerender, defaults, frame, onPdfLink } = await open();
      await screen.findByRole("link");
      rerender(
        <DrawingSheetViewer
          {...defaults}
          toolControls={{
            measureRequest: 0,
            pipeRequest: 0,
            modeRequest: { id: 1, mode },
          }}
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      tap(frame);
      expect(onPdfLink).not.toHaveBeenCalled();
    },
  );
});
