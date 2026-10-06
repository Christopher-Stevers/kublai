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
import { DrawingSheetViewer } from "./DrawingSheetViewer";

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
) {
  const view = render(
    <DrawingSheetViewer
      src="/sheet.webp"
      alt="Sheet"
      sheetKey={sheetKey}
      pdf={pdf}
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
  it("totals a traced path after the scale is taken from a known length", () => {
    const { frame } = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));

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
      "Tap one end of a length you know on the drawing.",
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
      "Tap each point along the path.",
    );
  });

  it("uses the scale saved for that drawing the next time it is opened", () => {
    const first = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Meters" }));
    expect(screen.getByRole("status").textContent).toBe("7.47 m");
  });

  it("rejects a scale that is not a length", () => {
    const { frame } = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    tap(frame, 0, 300);
    tap(frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), {
      target: { value: "about yea long" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    expect(
      screen.getByText("Enter a length like 24'6\" or 7.5."),
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
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => {
      expect(
        screen.getByText("Couldn't read a scale from this drawing."),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "From a length" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Tap one end of a known length. It snaps onto a line.",
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

  it("reads the printed scale and measures with it", async () => {
    vi.mocked(readPdfSheetScale).mockResolvedValue({
      ok: true,
      scale: { unit: "ft", unitsPerSheetWidth: 100, label: '1/4" = 1\'-0"' },
    });
    const { frame } = openSheet("sheet-read", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/1\/4" = 1'-0"/);
    });
    tap(frame, 0, 300);
    tap(frame, 800, 300);
    expect(screen.getByRole("status").textContent).toBe("100'-0\"");
    expect(screen.getByText('1/4" = 1\'-0"')).toBeInTheDocument();
  });
});
