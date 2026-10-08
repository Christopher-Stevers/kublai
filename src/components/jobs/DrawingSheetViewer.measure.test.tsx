import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPdfSheetScale } from "~/lib/pdf-sheet-scale";
import { loadSnapLines } from "~/lib/pdf-snap-lines";
import { writeSheetScale } from "~/lib/sheet-measure";
import {
  DrawingSheetViewer,
  type DrawingEditorProps,
} from "./DrawingSheetViewer";

vi.mock("~/lib/pdf-snap-lines", () => ({
  loadSnapLines: vi.fn(async () => []),
}));
vi.mock("~/lib/pdf-sheet-scale", () => ({
  readPdfSheetScale: vi.fn(async () => ({
    ok: false,
    reason: "none" as const,
  })),
}));

beforeEach(() => {
  vi.mocked(loadSnapLines).mockResolvedValue([]);
  vi.mocked(readPdfSheetScale).mockResolvedValue({ ok: false, reason: "none" });
  // Node 26 exposes an unavailable native localStorage in the test environment.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** An 800×600 frame holding a 1000×500 sheet, so the sheet is 800×400 and centred. */
function openSheet(
  sheetKey = "sheet-1",
  pdf?: { url: string; page: number } | null,
  editorProps: DrawingEditorProps = {},
) {
  const view = render(
    <DrawingSheetViewer
      src="/sheet.webp"
      alt="Sheet"
      sheetKey={sheetKey}
      pdf={pdf}
      {...editorProps}
    />,
  );
  const image = screen.getByAltText("Sheet");
  const frame = image.parentElement!.parentElement as HTMLDivElement;
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(image, "naturalHeight", {
    configurable: true,
    get: () => 500,
  });
  Object.defineProperty(frame, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(frame, "clientHeight", {
    configurable: true,
    get: () => 600,
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
    toJSON() {
      return {};
    },
  });
  fireEvent.load(image);
  return { ...view, frame };
}

function tap(frame: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(frame, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
  });
  fireEvent.pointerUp(frame, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
  });
}

describe("drawing measure", () => {
  it("keeps trace and dimension calibration unchanged until the shared save is accepted", () => {
    const sharedScale = { unit: "ft" as const, unitsPerSheetWidth: 100 };
    const onScaleChange = vi.fn(),
      onCreate = vi.fn();
    const storage = vi.spyOn(localStorage, "setItem");
    const { frame, rerender } = openSheet("controlled", undefined, {
      sharedScale,
      onScaleChange,
      onCreate,
      tool: "dimension",
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 0, 300);
    tap(frame, 400, 300);
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 0, 300);
    tap(frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    expect(onScaleChange).toHaveBeenCalledWith({
      unit: "ft",
      unitsPerSheetWidth: 200,
    });
    // The owner rejected the proposal and leaves the controlled prop unchanged.
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    // Changing the unit only changes how this device shows lengths.
    fireEvent.click(screen.getByRole("button", { name: "m" }));
    expect(screen.getByRole("button", { name: "m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("15.24 m");
    fireEvent.click(screen.getByRole("button", { name: "mm" }));
    expect(screen.getByRole("status")).toHaveTextContent("15240 mm");
    fireEvent.click(screen.getByRole("button", { name: "ft" }));
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    expect(onScaleChange).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    tap(frame, 200, 300);
    tap(frame, 600, 300);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dimension", scale: 100, unit: "ft" }),
    );
    rerender(
      <DrawingSheetViewer
        src="/sheet.webp"
        alt="Sheet"
        sheetKey="controlled"
        sharedScale={{ unit: "ft", unitsPerSheetWidth: 200 }}
        onCreate={onCreate}
        tool="dimension"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("status")).toHaveTextContent("100'-0\"");
  });

  it("treats a null shared scale as uncalibrated even when this device has a stored scale", () => {
    writeSheetScale("shared-null", { unit: "ft", unitsPerSheetWidth: 100 });
    const onCreate = vi.fn();
    const { frame } = openSheet("shared-null", undefined, {
      sharedScale: null,
      onCreate,
      tool: "dimension",
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 0, 300);
    tap(frame, 400, 300);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tap Set Scale to see the distance.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    tap(frame, 200, 300);
    tap(frame, 600, 300);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dimension" }),
    );
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty("scale", 100);
  });
  it("totals a traced path after the scale is taken from a known length", () => {
    const { frame } = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));

    // Dragging still pans and does not drop a point.
    fireEvent.pointerDown(frame, {
      clientX: 200,
      clientY: 300,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(frame, {
      clientX: 250,
      clientY: 300,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(frame, {
      clientX: 250,
      clientY: 300,
      button: 0,
      pointerId: 1,
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Set Scale: tap one end of a length you know.",
    );
    expect(frame.querySelectorAll("circle")).toHaveLength(0);

    // The full sheet width is 100 feet. The sheet runs from x=0 to x=800.
    tap(frame, 0, 300);
    tap(frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));

    // Half the sheet width, then the full sheet height (25 feet, because the sheet is twice as wide as it is tall).
    tap(frame, 0, 300);
    tap(frame, 400, 300);
    expect(screen.getByRole("status").textContent).toBe("50'-0\"");
    tap(frame, 400, 500);
    expect(screen.getByRole("status").textContent).toBe("75'-0\"");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("status").textContent).toBe("50'-0\"");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Tap each point along the path. Angles lock at 45° or 90°.",
    );
  });

  it("uses the scale saved for that drawing the next time it is opened", () => {
    const first = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(first.frame, 0, 300);
    tap(first.frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), {
      target: { value: "24'6\"" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    first.unmount();

    const second = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(second.frame, 0, 300);
    tap(second.frame, 800, 300);
    expect(screen.getByRole("status").textContent).toBe("24'-6\"");
    fireEvent.click(screen.getByRole("button", { name: "m" }));
    expect(screen.getByRole("status").textContent).toBe("7.47 m");
    fireEvent.click(screen.getByRole("button", { name: "in" }));
    expect(screen.getByRole("status").textContent).toBe(`294"`);
  });

  it("rejects a scale that is not a length", () => {
    const { frame } = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 0, 300);
    tap(frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), {
      target: { value: "about yea long" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    expect(
      screen.getByText("Enter a length in ft, like 24'6\"."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Total along the points/)).toBeNull();
  });

  it("snaps the scale line onto a line in the drawing", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
    ]);
    // The sheet's midline is screen y=300. These taps sit 12px off it.
    const { frame } = openSheet("sheet-snap", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/snap onto lines/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Set Scale: tap one end of a length you know. It snaps onto a line.",
    );
    fireEvent.pointerMove(frame, { clientX: 400, clientY: 312, buttons: 0 });
    expect(frame.querySelector('line[stroke="#22d3ee"]')).toBeTruthy();

    tap(frame, 0, 312);
    tap(frame, 800, 288);
    fireEvent.change(screen.getByLabelText("How long is this line?"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));

    tap(frame, 0, 312);
    tap(frame, 400, 288);
    expect(screen.getByRole("status").textContent).toBe("50'-0\"");
  });

  it("locks the second end of a scale square to the first end's line, in green", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([{ x1: 0, y1: 0.5, x2: 1, y2: 0.5 }]);
    const { frame } = openSheet("sheet-square", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/snap onto lines/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 400, 300);
    // Nearly straight up from a point on a horizontal line: locks at 90°.
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(frame.querySelector('polyline[stroke="#16a34a"]')).toBeTruthy();
    expect(screen.getByText("90°")).toBeInTheDocument();
    // Well off square or 45°: no lock.
    fireEvent.pointerMove(frame, { clientX: 520, clientY: 150, buttons: 0 });
    expect(frame.querySelector('polyline[stroke="#16a34a"]')).toBeNull();
    // Only two ends: a third tap changes nothing.
    tap(frame, 404, 150);
    tap(frame, 700, 100);
    expect(screen.getByLabelText("How long is this line?")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toBe("How long is this line?");
  });

  it("locks measuring segments square and at 45°, with or without PDF lines", () => {
    const { frame } = openSheet("trace-angles", undefined, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 400, 300);
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(screen.getByText("90°")).toBeInTheDocument();
    expect(frame.querySelector('polyline[stroke="#16a34a"]')?.getAttribute("points")).toBe("400,200 400,50");
    tap(frame, 408, 150);
    expect(screen.getByRole("status")).toHaveTextContent("18'-9\"");
    // The next segment locks relative to its own anchor, not the first point.
    fireEvent.pointerMove(frame, { clientX: 550, clientY: 308, buttons: 0 });
    expect(screen.getByText("45°")).toBeInTheDocument();
    fireEvent.pointerMove(frame, { clientX: 520, clientY: 330, buttons: 0 });
    expect(screen.queryByText("45°")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(screen.queryByText("90°")).toBeNull();
  });

  it("measures the exact intersection of an angle lock and a drawing line", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      { x1: 0, y1: 0.125, x2: 1, y2: 0.125 },
    ]);
    const { frame } = openSheet("trace-intersection", { url: "/plan.pdf", page: 1 }, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("snap onto lines"));
    tap(frame, 400, 312);
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 160, buttons: 0 });
    expect(frame.querySelector('line[stroke="#22d3ee"]')).toBeTruthy();
    expect(frame.querySelector('polyline[stroke="#16a34a"]')?.getAttribute("points")).toBe("400,200 400,50");
    tap(frame, 408, 160);
    expect(screen.getByRole("status")).toHaveTextContent("18'-9\"");
  });

  it("snaps the held measuring point while sliding and commits it on release", async () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    try {
      const { frame } = openSheet("trace-hold", undefined, {
        sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
      });
      fireEvent.click(screen.getByRole("button", { name: "Measure" }));
      tap(frame, 400, 300);
      fireEvent.pointerDown(frame, { clientX: 520, clientY: 220, pointerId: 1, button: 0, buttons: 1 });
      await waitFor(() => expect(frame.querySelector("canvas")).toBeTruthy());
      fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, pointerId: 1, buttons: 1 });
      expect(screen.getByText("90°")).toBeInTheDocument();
      fireEvent.pointerUp(frame, { clientX: 408, clientY: 150, pointerId: 1, button: 0, buttons: 0 });
      expect(screen.getByRole("status")).toHaveTextContent("18'-9\"");
      expect(frame.querySelector("canvas")).toBeNull();
      expect(screen.queryByText("90°")).toBeNull();
    } finally {
      context.mockRestore();
    }
  });

  it("restores the previous snapped reference line on Undo", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      // A 30° drawing line, in physical sheet coordinates.
      { x1: 0.25, y1: 0, x2: 0.75, y2: 1 / Math.sqrt(3) },
    ]);
    const { frame } = openSheet("trace-undo", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("snap onto lines"));
    tap(frame, 400, 300);
    tap(frame, 400, 100 + 200 / Math.sqrt(3));
    fireEvent.pointerMove(frame, { clientX: 300, clientY: 100 + 200 / Math.sqrt(3) + 100 * Math.sqrt(3), buttons: 0 });
    expect(screen.getByText("90°")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("90°")).toBeNull();
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(screen.getByText("90°")).toBeInTheDocument();
    // Undo the first point too: no anchor or old reference remains.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(screen.queryByText("90°")).toBeNull();
  });

  it("reads the printed scale and measures with it", async () => {
    vi.mocked(readPdfSheetScale).mockResolvedValue({
      ok: true,
      scale: { unit: "ft", unitsPerSheetWidth: 100, label: '1/4" = 1\'-0"' },
    });
    const { frame } = openSheet("sheet-read", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    fireEvent.click(screen.getByRole("button", { name: "Read the scale printed on this drawing instead" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/1\/4" = 1'-0"/);
    });
    tap(frame, 0, 300);
    tap(frame, 800, 300);
    expect(screen.getByRole("status").textContent).toBe("100'-0\"");
    expect(screen.getByText('1/4" = 1\'-0"')).toBeInTheDocument();
  });
});

describe("drawing one-finger zoom", () => {
  function pointer(frame: HTMLElement, kind: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", y: number, id = 1, x = 400) {
    fireEvent[kind](frame, { clientX: x, clientY: y, pointerId: id, button: 0, buttons: kind === "pointerUp" ? 0 : 1 });
  }
  function scale(frame: HTMLElement) {
    return Number(frame.firstElementChild?.getAttribute("style")?.match(/scale\(([^)]+)\)/)?.[1] ?? 1);
  }
  it("zooms both ways while holding the second tap, then stops on release", async () => {
    const { frame } = openSheet();
    tap(frame, 400, 300);
    pointer(frame, "pointerDown", 300);
    pointer(frame, "pointerMove", 430);
    await waitFor(() => expect(scale(frame)).toBeGreaterThan(2));
    pointer(frame, "pointerMove", 350);
    await waitFor(() => expect(scale(frame)).toBeCloseTo(Math.exp(0.4)));
    pointer(frame, "pointerUp", 350);
    pointer(frame, "pointerMove", 500);
    await waitFor(() => expect(scale(frame)).toBeCloseTo(Math.exp(0.4)));
  });
  it("retains ordinary double-tap zoom on release", async () => {
    const { frame } = openSheet();
    tap(frame, 400, 300);
    tap(frame, 400, 300);
    await waitFor(() => expect(scale(frame)).toBeCloseTo(3));
  });
  it("cancels the held zoom without latching into the next drag", async () => {
    const { frame } = openSheet();
    tap(frame, 400, 300);
    pointer(frame, "pointerDown", 300);
    pointer(frame, "pointerMove", 400);
    pointer(frame, "pointerCancel", 400);
    await waitFor(() => expect(scale(frame)).toBeCloseTo(Math.exp(0.8)));
    pointer(frame, "pointerDown", 400);
    pointer(frame, "pointerMove", 450);
    pointer(frame, "pointerUp", 450);
    await waitFor(() => expect(scale(frame)).toBeCloseTo(Math.exp(0.8)));
  });
  it("hands a held zoom over to a two-finger pinch without jumping", async () => {
    const { frame } = openSheet();
    tap(frame, 400, 300);
    pointer(frame, "pointerDown", 300);
    pointer(frame, "pointerMove", 400);
    pointer(frame, "pointerDown", 400, 2, 500);
    pointer(frame, "pointerMove", 400, 2, 600);
    pointer(frame, "pointerUp", 400, 2, 600);
    pointer(frame, "pointerUp", 400);
    await waitFor(() => expect(scale(frame)).toBeCloseTo(Math.exp(0.8) * 2));
  });
});
