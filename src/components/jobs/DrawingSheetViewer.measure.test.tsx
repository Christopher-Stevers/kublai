import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPdfSheetScale } from "~/lib/pdf-sheet-scale";
import { loadSnapLines } from "~/lib/pdf-snap-lines";
import { writeSheetScale } from "~/lib/sheet-measure";
import { MEASURE_COLOR_KEY } from "~/lib/sheet-measure-color";
import { drawingMarkupSchema, type DrawingEntity } from "~/lib/drawing-workspace";
import { drawingMeasurement } from "~/lib/drawing-annotation-geometry";
import {
  DrawingSheetViewer,
  type DrawingEditorProps,
} from "./DrawingSheetViewer";
import { DrawingCompare } from "./DrawingCompare";
import { SNAPSHOT_FREEZE_EVENT } from "~/lib/snapshot-source";

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
  toolControls?: ComponentProps<typeof DrawingSheetViewer>["toolControls"],
) {
  const view = render(
    <DrawingSheetViewer
      src="/sheet.webp"
      alt="Sheet"
      sheetKey={sheetKey}
      pdf={pdf}
      {...editorProps}
      toolControls={toolControls}
    />,
  );
  const image = screen.getByAltText("Sheet");
  const frame = image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.parentElement as HTMLDivElement;
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

// Units are one button that opens a menu of m, mm, in and ft.
function chooseUnit(unit: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Units: / }), { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: unit }));
}

describe("drawing measure", () => {

  it.each(["idle", "pipe"] as const)("saves the measured run when the host switches to %s alongside an annotation tool change", mode => {
    const onCreate = vi.fn();
    const onMode = vi.fn();
    const props = { src: "/sheet.webp", alt: "Sheet", sheetKey: "sheet-1", onCreate, sharedScale: { unit: "m" as const, unitsPerSheetWidth: 100 } };
    const controls = (id: number, mode: "idle" | "measure" | "pipe") => ({ measureRequest: 0, pipeRequest: 0, modeRequest: { id, mode }, onMode });
    const view = openSheet("sheet-1", undefined, props, controls(0, "idle"));
    view.rerender(<DrawingSheetViewer {...props} tool="pan" toolControls={controls(1, "measure")} />);
    tap(view.frame, 200, 300);
    tap(view.frame, 600, 300);
    view.rerender(<DrawingSheetViewer {...props} tool={mode === "idle" ? "line" : "pan"} toolControls={controls(2, mode)} />);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ type: "dimension", parents: [null, 0], scale: 100, unit: "m" });
    expect(onMode).toHaveBeenLastCalledWith({ measuring: false, pipe: mode === "pipe" });
    expect(screen.queryByRole("button", { name: "Set Scale" })).toBeNull();
    view.rerender(<DrawingSheetViewer {...props} tool="pan" toolControls={controls(3, "measure")} />);
    expect(onMode).toHaveBeenLastCalledWith({ measuring: true, pipe: false });
    expect(view.frame.querySelectorAll("[data-measure-node]")).toHaveLength(0);
    view.rerender(<DrawingSheetViewer {...props} tool="pan" toolControls={controls(4, "idle")} />);
    expect(onMode).toHaveBeenLastCalledWith({ measuring: false, pipe: false });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it.each(["overlay", "difference", "wipe", "side-by-side"])("uses the host bottom controls without an extra idle bar in %s comparisons", mode => {
    const first = { id: "one", name: "Original", imageUrl: "/first.webp" };
    const second = { id: "two", name: "Revision", imageUrl: "/second.webp" };
    const onMode = vi.fn();
    const view = render(<DrawingCompare first={first} second={second} toolControls={{ measureRequest: 0, pipeRequest: 0, onMode }} />);
    fireEvent.change(screen.getByLabelText("Comparison mode"), { target: { value: mode } });
    expect(screen.queryByRole("region", { name: "Drawing tool options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pipe system" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Measure" })).toBeNull();

    view.rerender(<DrawingCompare first={first} second={second} toolControls={{ measureRequest: 1, pipeRequest: 0, onMode }} />);
    // The host bar's Measure button is Done: the strip has none of its own.
    expect(screen.queryAllByRole("button", { name: "Done" })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Set Scale" })).toBeEnabled();
    expect(onMode).toHaveBeenLastCalledWith({ measuring: true, pipe: false });

    view.rerender(<DrawingCompare first={first} second={second} toolControls={{ measureRequest: 1, pipeRequest: 1, onMode }} />);
    expect(screen.getAllByRole("region", { name: "Pipe system selection" })).toHaveLength(1);
    expect(onMode).toHaveBeenLastCalledWith({ measuring: false, pipe: true });
  });
  it.each([false, true])("redos undone points with icon-only buttons (calibration: %s)", calibration => {
    const { frame } = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    if (calibration) fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300);
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo.textContent).toBe("");
    expect(redo.textContent).toBe("");
    expect(redo).toBeDisabled();
    fireEvent.click(undo);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(0);
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(1);
    expect(redo).toBeDisabled();
  });
  it.each([false, true])("middle-pan preserves measurement nodes, including while setting scale (%s)", calibration => {
    const { frame } = openSheet();
    const image = screen.getByAltText("Sheet");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    if (calibration) fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300);
    const nodes = () => [...frame.querySelectorAll("[data-measure-node]")].map(node => node.innerHTML);
    const before = nodes();
    const mouse = { pointerId: 1, pointerType: "mouse", button: 1, buttons: 4 };
    fireEvent.pointerDown(frame, { ...mouse, clientX: 200, clientY: 300 });
    fireEvent.pointerMove(frame, { ...mouse, clientX: 280, clientY: 340 });
    fireEvent.pointerUp(frame, { ...mouse, buttons: 0, clientX: 280, clientY: 340 });
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
    expect(nodes()).toEqual(before);
    tap(frame, 680, 340);
    expect(nodes()).toHaveLength(2);
  });
  it("creates a named measurement layer and includes it in the validated saved markup", () => {
    const onCreate = vi.fn();
    const { frame } = openSheet("0391aed4-7773-47ec-9141-09df373ec008", undefined, { onCreate, measurementLayers: ["Plumbing"] });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Measurement layer: General" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Plumbing" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Measurement layer: Plumbing" }), { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox", { name: "New measurement layer" }), { target: { value: "  Cold water  " } });
    fireEvent.submit(screen.getByRole("textbox", { name: "New measurement layer" }).closest("form")!);
    expect(screen.getByRole("button", { name: "Measurement layer: Cold water" })).toBeInTheDocument();
    tap(frame, 200, 300); tap(frame, 600, 300);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(drawingMarkupSchema.parse(onCreate.mock.calls[0]![0]).layer).toBe("Cold water");
  });
  it("saves Done as a persistent coloured dimension with converted units, and starts a fresh run", () => {
    const source = "0391aed4-7773-47ec-9141-09df373ec008";
    const onCreate = vi.fn();
    const { frame, unmount } = openSheet(source, undefined, {
      sourceSheetId: source, sharedScale: { unit: "ft", unitsPerSheetWidth: 100 }, onCreate,
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300); tap(frame, 600, 300);
    chooseUnit("mm");
    fireEvent.click(screen.getByRole("button", { name: /^Measuring color:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Neon cyan" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCreate).toHaveBeenCalledOnce();
    const saved = drawingMarkupSchema.parse(onCreate.mock.calls[0]![0]);
    expect(saved).toMatchObject({ sourceSheetId: source, type: "dimension", unit: "mm", scale: 30480, stroke: "#00ffff", parents: [null, 0] });
    expect(drawingMeasurement(saved, .5)).toBe("15240.00 mm");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCreate).toHaveBeenCalledOnce();
    unmount();
    const entity: DrawingEntity = { id: "saved-measure", sheetId: source, kind: "markup", data: saved, revision: 1, visibility: "private", authorId: "tim", authorName: "Tim", createdAt: "", updatedAt: "", comments: [] };
    const reopened = openSheet(source, undefined, { annotations: [entity], sharedScale: { unit: "ft", unitsPerSheetWidth: 200 } });
    expect(reopened.frame.querySelector('[data-annotation-id="saved-measure"]')).toHaveTextContent("15240 mm");
  });

  it.each([1, 2, 16])("keeps completed run line and label styling at %s× zoom, including reopening", (zoom) => {
    const source = "0391aed4-7773-47ec-9141-09df373ec008";
    const onCreate = vi.fn();
    const sharedScale = { unit: "ft" as const, unitsPerSheetWidth: 100 };
    const view = openSheet(source, undefined, { sharedScale, onCreate });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(view.frame, 200, 300); tap(view.frame, 600, 300);
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    tap(view.frame, 400, 300); tap(view.frame, 400, 180);
    fireEvent.click(screen.getByRole("button", { name: /^Measuring color:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Neon cyan" }));
    if (zoom !== 1) fireEvent.wheel(view.frame, { clientX: 400, clientY: 300, deltaY: -Math.log(zoom) / 0.0015 });
    const activeLine = view.frame.querySelector('[data-measure-path]')!;
    const activeLabel = view.frame.querySelector('[data-measure-length]')!;
    const angleLabels = Array.from(view.frame.querySelectorAll('[data-measure-angle] text')).map(label => ({
      text: label.textContent, font: Number(label.getAttribute("font-size")) * zoom,
      halo: Number(label.getAttribute("stroke-width")) * zoom,
    }));
    expect(angleLabels).toHaveLength(1);
    const expected = {
      width: Number(activeLine.getAttribute("stroke-width")) * zoom,
      font: Number(activeLabel.getAttribute("font-size")) * zoom,
      halo: Number(activeLabel.getAttribute("stroke-width")) * zoom,
      offset: Number(activeLabel.getAttribute("y")) * zoom,
      weight: activeLabel.getAttribute("font-weight"),
      fill: activeLabel.getAttribute("fill"),
      stroke: activeLabel.getAttribute("stroke"),
      anchor: activeLabel.getAttribute("text-anchor"),
      text: activeLabel.textContent,
    };
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const entity: DrawingEntity = { id: "style-run", sheetId: source, kind: "markup", data: drawingMarkupSchema.parse(onCreate.mock.calls[0]![0]), revision: 1, visibility: "private", authorId: "tim", authorName: "Tim", createdAt: "", updatedAt: "", comments: [] };
    view.rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={source} sharedScale={sharedScale} annotations={[entity]} onCreate={onCreate} />);
    const check = (frame: HTMLElement, screenScale: number) => {
      const line = frame.querySelector('[data-saved-measure-path]')!;
      const label = frame.querySelector('[data-measurement-segment] text')!;
      expect(Number(line.getAttribute("stroke-width")) * screenScale).toBeCloseTo(expected.width);
      expect(Number(label.getAttribute("font-size")) * screenScale).toBeCloseTo(expected.font);
      expect(Number(label.getAttribute("stroke-width")) * screenScale).toBeCloseTo(expected.halo);
      expect(Number(label.getAttribute("y")) * screenScale).toBeCloseTo(expected.offset);
      expect(label.getAttribute("font-weight")).toBe(expected.weight);
      expect(label.getAttribute("fill")).toBe(expected.fill);
      expect(label.getAttribute("stroke")).toBe(expected.stroke);
      expect(label.getAttribute("text-anchor")).toBe(expected.anchor);
      expect(label.textContent).toBe(expected.text);
      expect(frame.querySelectorAll('[data-saved-measure-node]')).toHaveLength(4);
      const savedAngles = Array.from(frame.querySelectorAll('[data-saved-measure-angle] text'));
      expect(savedAngles).toHaveLength(angleLabels.length);
      savedAngles.forEach((label, index) => {
        expect(label.textContent).toBe(angleLabels[index]!.text);
        expect(Number(label.getAttribute("font-size")) * screenScale).toBeCloseTo(angleLabels[index]!.font);
        expect(Number(label.getAttribute("stroke-width")) * screenScale).toBeCloseTo(angleLabels[index]!.halo);
      });
    };
    check(view.frame, .8 * zoom);
    view.unmount();
    const reopened = openSheet(source, undefined, { sharedScale, annotations: [entity] });
    if (zoom !== 1) fireEvent.wheel(reopened.frame, { clientX: 400, clientY: 300, deltaY: -Math.log(zoom) / 0.0015 });
    check(reopened.frame, .8 * zoom);
  });

  it("saves a branched run as one markup without counting a jump from the end of the trunk", () => {
    const onCreate = vi.fn();
    const { frame } = openSheet("0391aed4-7773-47ec-9141-09df373ec008", undefined, { sharedScale: { unit: "ft", unitsPerSheetWidth: 100 }, onCreate });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300); tap(frame, 600, 300);
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    tap(frame, 400, 300); tap(frame, 400, 180);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCreate).toHaveBeenCalledOnce();
    const saved = drawingMarkupSchema.parse(onCreate.mock.calls[0]![0]);
    expect(saved.parents).toEqual([null, 2, 0, 2]);
    expect(drawingMeasurement(saved, .5)).toBe("65'-0\"");
  });

  it("does not create a markup from calibration, an empty run or a single point", () => {
    const onCreate = vi.fn();
    const { frame } = openSheet("0391aed4-7773-47ec-9141-09df373ec008", undefined, { sharedScale: null, onCreate, onScaleChange: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300); tap(frame, 600, 300);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps the measuring and calibration controls below the drawing gesture surface", () => {
    const { frame } = openSheet("footer-measuring", undefined, {
      onScaleChange: vi.fn(),
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    const footer = screen.getByRole("region", { name: "Drawing tool options" });
    expect(frame.contains(footer)).toBe(false);
    expect(frame.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.contains(screen.getByRole("button", { name: "Done" }))).toBe(true);
    const points = frame.querySelector('[data-measure-path]')?.getAttribute("points");
    const color = screen.getByRole("button", { name: /^Measuring color:/ });
    fireEvent.pointerDown(color, { clientX: 200, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerUp(color, { clientX: 200, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.click(color);
    expect(footer.contains(screen.getByRole("button", { name: "Neon cyan" }))).toBe(true);
    expect(frame.querySelector('[data-measure-path]')).toHaveAttribute("points", points!);
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    expect(footer.contains(screen.getByLabelText("How long is this line?"))).toBe(true);
  });

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
    chooseUnit("m");
    expect(screen.getByRole("button", { name: "Units: m" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("15.24 m");
    chooseUnit("mm");
    expect(screen.getByRole("status")).toHaveTextContent("15240 mm");
    chooseUnit("ft");
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
    tap(frame, 200, 300);
    tap(frame, 600, 300);
    expect(screen.getByRole("status")).toHaveTextContent("100'-0\"");
  });

  it("retains calibration after a failed shared save and waits for a successful retry", async () => {
    let finish!: (saved: boolean) => void;
    const onScaleChange = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const { frame, rerender } = openSheet("scale-retry", undefined, { sharedScale: null, onScaleChange });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 0, 300); tap(frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), { target: { value: "200" } });
    const apply = screen.getByRole("button", { name: "Use this length" });
    fireEvent.click(apply); fireEvent.click(apply);
    expect(onScaleChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Saving scale");
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => finish(false));
    expect(screen.getByRole("alert")).toHaveTextContent("Scale was not saved");
    expect(screen.getByLabelText("How long is this line?")).toHaveValue("200");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    fireEvent.click(apply);
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey="scale-retry" sharedScale={{ unit: "ft", unitsPerSheetWidth: 200 }} onScaleChange={onScaleChange} />);
    await act(async () => finish(true));
    expect(screen.queryByLabelText("How long is this line?")).not.toBeInTheDocument();
    tap(frame, 200, 300); tap(frame, 600, 300);
    expect(screen.getByRole("status")).toHaveTextContent("100'-0\"");
  });

  it("keeps calibration editable when its owner blocks a save", () => {
    const { frame } = openSheet("blocked-scale", undefined, { sharedScale: null, onScaleChange: () => { throw new Error("Save your sheet details first."); } });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 0, 300); tap(frame, 800, 300);
    fireEvent.change(screen.getByLabelText("How long is this line?"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Save your sheet details first");
    expect(screen.getByLabelText("How long is this line?")).toHaveValue("200");
  });

  it("does not offer shared calibration without permission to save it", () => {
    openSheet("read-only-scale", undefined, { sharedScale: null });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("button", { name: "Set Scale" })).toBeDisabled();
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
    // No scale yet: no total, and no instructions either.
    expect(screen.getByRole("status")).toHaveTextContent("");
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
    expect(screen.queryByText(/Set Scale: tap one end/)).toBeNull();
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
    expect(screen.getByRole("status").textContent).toBe("");
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
    chooseUnit("m");
    expect(screen.getByRole("status").textContent).toBe("7.47 m");
    chooseUnit("in");
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
      expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    expect(screen.queryByText(/Set Scale: tap one end/)).toBeNull();
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

  it("locks the second end of a scale square to the first end's line", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([{ x1: 0, y1: 0.5, x2: 1, y2: 0.5 }]);
    const { frame } = openSheet("sheet-square", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => {
      expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 400, 300);
    // Nearly straight up from a point on a horizontal line: locks at 90°.
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(frame.querySelector('polyline[data-measure-path][data-angle-locked="true"]')).toBeTruthy();
    expect(screen.getByText("90°")).toBeInTheDocument();
    // Well off square or 45°: no lock.
    fireEvent.pointerMove(frame, { clientX: 520, clientY: 150, buttons: 0 });
    expect(frame.querySelector('polyline[data-measure-path][data-angle-locked="true"]')).toBeNull();
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
    expect(frame.querySelector('polyline[data-measure-path][data-angle-locked="true"]')?.getAttribute("points")).toBe("400,200 400,50");
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
    await waitFor(() => expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy());
    tap(frame, 400, 312);
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 160, buttons: 0 });
    expect(frame.querySelector('line[stroke="#22d3ee"]')).toBeTruthy();
    expect(frame.querySelector('polyline[data-measure-path][data-angle-locked="true"]')?.getAttribute("points")).toBe("400,200 400,50");
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
      expect(frame.querySelector('[data-measure-angle][data-active-angle="true"]')).toBeNull();
      expect(frame.querySelector('[data-measure-angle]')).toHaveTextContent("90°");
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
    await waitFor(() => expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy());
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

  it("does not let an angle lock move a precise endpoint more than 18 screen pixels", () => {
    const { frame } = openSheet("bounded-angle", undefined, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 500);
    // Under 4° off square, but a 26px correction would move it too far.
    fireEvent.pointerMove(frame, { clientX: 226, clientY: 100, buttons: 0 });
    expect(screen.queryByText("90°")).toBeNull();
    tap(frame, 226, 100);
    const coordinates = frame.querySelector('polyline[data-measure-path]')?.getAttribute("points")?.split(/[ ,]/).map(Number);
    expect(coordinates?.slice(0, 2)).toEqual([200, 400]);
    expect(coordinates?.[2]).toBeCloseTo(226, 9);
    expect(coordinates?.[3]).toBe(0);
  });

  it("selects the line under the finger instead of a nearby line chosen at the anchor", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      { x1: 0, y1: 0.525, x2: 1, y2: 0.525 },
    ]);
    const { frame } = openSheet("precise-neighbor", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy());
    tap(frame, 400, 300);
    tap(frame, 600, 310);
    expect(frame.querySelector('polyline[data-measure-path]')?.getAttribute("points")).toBe("400,200 600,210");
  });

  it("hides scale guidance and the printed-scale link while calibrating", () => {
    const { frame } = openSheet("sheet-read", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    expect(screen.queryByText(/Set Scale: tap one end/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Read the scale printed on this drawing instead" })).toBeNull();
    tap(frame, 0, 300);
    expect(screen.queryByText(/Tap the other end/)).toBeNull();
    expect(readPdfSheetScale).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});

describe("dimensions along measuring segments", () => {
  const labels = (frame: HTMLElement) => [...frame.querySelectorAll("[data-measure-length]")].map((node) => node.textContent);

  it("labels every segment at its midpoint and follows the selected units", () => {
    const { frame } = openSheet("segment-labels", undefined, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    tap(frame, 400, 460);
    expect(labels(frame)).toEqual(["25'-0\"", "20'-0\""]);
    const nodes = frame.querySelectorAll("[data-measure-length]");
    expect(nodes[0]?.parentElement?.getAttribute("transform")).toBe("translate(300 200) rotate(0)");
    expect(nodes[1]?.parentElement?.getAttribute("transform")).toBe("translate(400 280) rotate(90)");
    chooseUnit("mm");
    expect(labels(frame)).toEqual(["7620 mm", "6096 mm"]);
    chooseUnit("in");
    expect(labels(frame)).toEqual(['300"', '240"']);
    chooseUnit("m");
    expect(labels(frame)).toEqual(["7.62 m", "6.1 m"]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(labels(frame)).toEqual(["7.62 m"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(labels(frame)).toEqual([]);
  });

  it("updates both dimension labels while dragging a middle node", () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    try {
      const { frame } = openSheet("moving-labels", undefined, { sharedScale: { unit: "ft", unitsPerSheetWidth: 100 } });
      fireEvent.click(screen.getByRole("button", { name: "Measure" }));
      tap(frame, 200, 300);
      tap(frame, 400, 300);
      tap(frame, 400, 460);
      fireEvent.pointerDown(frame, { clientX: 400, clientY: 300, pointerId: 1, button: 0, buttons: 1 });
      fireEvent.pointerMove(frame, { clientX: 500, clientY: 300, pointerId: 1, buttons: 1 });
      expect(labels(frame)).toEqual(["37'-6\"", "23'-7\""]);
      expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(3);
      fireEvent.pointerUp(frame, { clientX: 500, clientY: 300, pointerId: 1, button: 0, buttons: 0 });
      expect(labels(frame)).toEqual(["37'-6\"", "23'-7\""]);
    } finally { context.mockRestore(); }
  });

  it("shows the known Set Scale length as it is typed, without saving early", () => {
    const onScaleChange = vi.fn();
    const { frame } = openSheet("known-length-label", undefined, { sharedScale: null, onScaleChange });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300);
    tap(frame, 600, 300);
    expect(labels(frame)).toEqual(["Enter length"]);
    chooseUnit("mm");
    fireEvent.change(screen.getByLabelText("How long is this line?"), { target: { value: "7500" } });
    expect(labels(frame)).toEqual(["7500 mm"]);
    expect(onScaleChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("How long is this line?"), { target: { value: "bad length" } });
    expect(labels(frame)).toEqual(["Enter length"]);
    fireEvent.change(screen.getByLabelText("How long is this line?"), { target: { value: "2.4 m" } });
    expect(labels(frame)).toEqual(["2400 mm"]);
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    expect(onScaleChange).toHaveBeenCalledWith({ unit: "m", unitsPerSheetWidth: 4.8 });
  });

  it("labels a preview segment and asks for a scale when the distance is unknown", () => {
    const { frame } = openSheet("unscaled-label", undefined, { sharedScale: null });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300);
    fireEvent.pointerMove(frame, { clientX: 400, clientY: 300, buttons: 0 });
    expect(labels(frame)).toEqual(["Set scale"]);
    tap(frame, 400, 300);
    expect(labels(frame)).toEqual(["Set scale"]);
  });
});

describe("dragging existing measuring nodes", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  function startTrace() {
    const { frame } = openSheet("node-drag", undefined, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    return frame;
  }
  function down(frame: HTMLElement, x: number, y: number, id = 1) {
    fireEvent.pointerDown(frame, { clientX: x, clientY: y, pointerId: id, button: 0, buttons: 1 });
  }
  function move(frame: HTMLElement, x: number, y: number, id = 1) {
    fireEvent.pointerMove(frame, { clientX: x, clientY: y, pointerId: id, buttons: 1 });
  }
  function up(frame: HTMLElement, x: number, y: number, id = 1) {
    fireEvent.pointerUp(frame, { clientX: x, clientY: y, pointerId: id, button: 0, buttons: 0 });
  }
  function points(frame: HTMLElement) {
    return frame.querySelector('polyline[data-measure-path]')?.getAttribute("points");
  }

  it("drags a middle point, updating both segments and the total without adding a node", () => {
    const frame = startTrace();
    tap(frame, 600, 300);
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    down(frame, 408, 302); // Generous touch target around the middle X.
    move(frame, 400, 450);
    expect(points(frame)).toBe("200,200 400,350 600,200");
    expect(screen.getByRole("status")).toHaveTextContent("62'-6\"");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(3);
    up(frame, 400, 450);
    expect(points(frame)).toBe("200,200 400,350 600,200");
    expect(frame.querySelector("canvas")).toBeNull();
    expect(frame.firstElementChild?.getAttribute("style")).toContain("scale(1)");
  });

  it("drags the first and last nodes, with angle locking against their neighbor", () => {
    const frame = startTrace();
    down(frame, 200, 300);
    move(frame, 408, 150);
    expect(screen.getByText("90°")).toBeInTheDocument();
    up(frame, 408, 150);
    expect(points(frame)).toBe("400,50 400,200");
    expect(screen.getByRole("status")).toHaveTextContent("18'-9\"");
    down(frame, 400, 300);
    move(frame, 600, 150);
    up(frame, 600, 150);
    expect(points(frame)).toBe("400,50 600,50");
    expect(screen.getByRole("status")).toHaveTextContent("25'-0\"");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    // Tapping a point without moving does not add or change a point.
    tap(frame, 600, 150);
    expect(points(frame)).toBe("400,50 600,50");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
  });

  it("snaps a dragged node to the exact angle/line intersection", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      { x1: 0, y1: 0.125, x2: 1, y2: 0.125 },
    ]);
    const { frame } = openSheet("node-lines", { url: "/plan.pdf", page: 1 }, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy());
    tap(frame, 400, 312);
    tap(frame, 600, 312);
    down(frame, 600, 300);
    move(frame, 408, 160);
    expect(screen.getByText("90°")).toBeInTheDocument();
    expect(frame.querySelector('line[stroke="#22d3ee"]')).toBeTruthy();
    up(frame, 408, 160);
    expect(points(frame)).toBe("400,200 400,50");
    expect(screen.getByRole("status")).toHaveTextContent("18'-9\"");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
  });

  it("lets either Set Scale endpoint move before saving the corrected scale", () => {
    const onScaleChange = vi.fn();
    const { frame } = openSheet("scale-node-drag", undefined, { sharedScale: null, onScaleChange });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300);
    tap(frame, 600, 300);
    down(frame, 200, 300);
    move(frame, 100, 300);
    up(frame, 100, 300);
    down(frame, 600, 300);
    move(frame, 500, 300);
    up(frame, 500, 300);
    expect(points(frame)).toBe("100,200 500,200");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    expect(onScaleChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("How long is this line?"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this length" }));
    expect(onScaleChange).toHaveBeenCalledWith({ unit: "ft", unitsPerSheetWidth: 200 });
  });

  it("restores the original point on pointer cancellation", () => {
    const frame = startTrace();
    down(frame, 400, 300);
    move(frame, 600, 300);
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    fireEvent.pointerCancel(frame, { pointerId: 1 });
    expect(points(frame)).toBe("200,200 400,200");
    expect(screen.getByRole("status")).toHaveTextContent("25'-0\"");
    expect(frame.querySelector("canvas")).toBeNull();
    tap(frame, 600, 300);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(3);
  });

  it("abandons a node drag for a two-finger pinch without altering the trace", async () => {
    const frame = startTrace();
    down(frame, 400, 300);
    move(frame, 500, 300);
    down(frame, 600, 300, 2);
    expect(points(frame)).toBe("200,200 400,200");
    move(frame, 650, 300, 2);
    up(frame, 650, 300, 2);
    up(frame, 500, 300);
    await waitFor(() => expect(frame.firstElementChild?.getAttribute("style")).toContain("scale(1.5)"));
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("25'-0\"");
  });

  it("finds a node in screen coordinates after zooming", () => {
    const frame = startTrace();
    fireEvent.wheel(frame, { clientX: 400, clientY: 300, deltaY: -Math.log(2) / 0.0015 });
    // The first node is now at screen x=0, still grabbable 18px away.
    down(frame, 18, 302);
    move(frame, 110, 400);
    up(frame, 110, 400);
    const coordinates = points(frame)?.split(/[ ,]/).map(Number);
    expect(coordinates).toHaveLength(4);
    expect(coordinates![0]).toBeCloseTo(255);
    expect(coordinates!.slice(1)).toEqual([250, 400, 200]);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    const scale = frame.firstElementChild?.getAttribute("style")?.match(/scale\(([^)]+)\)/)?.[1];
    expect(Number(scale)).toBeCloseTo(2);
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
  it("freezes an animated zoom before capturing a snapshot", async () => {
    const { frame } = openSheet();
    tap(frame, 400, 300);
    tap(frame, 400, 300);
    fireEvent(window, new Event(SNAPSHOT_FREEZE_EVENT));
    const frozen = scale(frame);
    await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
    expect(scale(frame)).toBe(frozen);
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

describe("measuring colors", () => {
  const choose = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: /^Measuring color:/ }));
    fireEvent.click(screen.getByRole("button", { name }));
  };

  it("recolors an existing trace, nodes, and lengths without changing geometry, including angle locks", () => {
    const { frame } = openSheet("color-trace", undefined, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    const points = frame.querySelector("[data-measure-path]")?.getAttribute("points");
    const drawingLayer = screen.getByAltText("Sheet").closest<HTMLElement>('[data-drawing-sheet-layer]')!;
    const transform = drawingLayer.style.transform;
    fireEvent.wheel(screen.getByRole("button", { name: /^Measuring color:/ }), { deltaY: 80 });
    expect(drawingLayer.style.transform).toBe(transform);
    choose("Neon yellow");
    expect(frame.querySelector("[data-measure-path]")).toHaveAttribute("stroke", "#ffff00");
    expect(frame.querySelector("[data-measure-path]")).toHaveAttribute("points", points!);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    expect(frame.querySelector('[data-measure-node] line[stroke="#ffff00"]')).toBeTruthy();
    expect(frame.querySelector("[data-measure-length]")).toHaveAttribute("fill", "#ffff00");
    expect(frame.querySelector("[data-measure-length]")).toHaveAttribute("stroke", "#111827");
    expect(screen.getByRole("status")).toHaveTextContent("25'-0\"");
    fireEvent.pointerMove(frame, { clientX: 408, clientY: 150, buttons: 0 });
    expect(screen.getByText("90°")).toBeInTheDocument();
    expect(frame.querySelector('[data-measure-path][data-angle-locked="true"]')).toHaveAttribute("stroke", "#ffff00");
  });

  it("uses custom colors for scale and trace and remembers the choice on another sheet", () => {
    const { frame } = openSheet("color-scale");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Scale" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    fireEvent.click(screen.getByRole("button", { name: /^Measuring color:/ }));
    fireEvent.change(screen.getByLabelText("Custom measuring color"), { target: { value: "#00ff88" } });
    expect(frame.querySelector("[data-measure-path]")).toHaveAttribute("stroke", "#00ff88");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    expect(localStorage.getItem(MEASURE_COLOR_KEY)).toBe("#00ff88");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    expect(frame.querySelector("[data-measure-path]")).toHaveAttribute("stroke", "#00ff88");
    cleanup();
    const next = openSheet("another-color-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("button", { name: "Measuring color: Custom" })).toBeInTheDocument();
    tap(next.frame, 200, 300);
    tap(next.frame, 400, 300);
    expect(next.frame.querySelector("[data-measure-path]")).toHaveAttribute("stroke", "#00ff88");
  });

  it("still changes color and measures when browser preference storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Storage blocked"); },
      setItem: () => { throw new Error("Storage blocked"); },
    });
    const { frame } = openSheet("no-color-storage", undefined, {
      sharedScale: { unit: "ft", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("button", { name: "Measuring color: Orange" })).toBeInTheDocument();
    choose("Neon pink");
    tap(frame, 200, 300);
    tap(frame, 400, 300);
    expect(frame.querySelector("[data-measure-path]")).toHaveAttribute("stroke", "#ff00cc");
    expect(screen.getByRole("status")).toHaveTextContent("25'-0\"");
  });
});


describe("relative measuring angles and drafting arcs", () => {
  it("starts relative to a rotated PDF line, then uses the last measurement despite another PDF line under its end", async () => {
    const slope = Math.tan(Math.PI / 6);
    const endY = 300 - 100 * Math.sqrt(3);
    vi.mocked(loadSnapLines).mockResolvedValue([
      { x1: 0.1, y1: 0.5 - 0.8 * slope, x2: 0.9, y2: 0.5 + 0.8 * slope },
      { x1: 0.55, y1: (endY - 100) / 400, x2: 0.7, y2: (endY - 100) / 400 },
    ]);
    const { frame } = openSheet("relative-angles", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy());
    tap(frame, 400, 300);
    fireEvent.pointerMove(frame, { clientX: 500, clientY: endY, buttons: 0 });
    expect(frame.querySelector('[data-measure-path]')).toHaveAttribute("data-angle-locked", "true");
    expect(frame.querySelector('[data-measure-angle][data-active-angle="true"]')).toHaveTextContent("90°");
    expect(frame.querySelector('[data-angle-arc]')?.getAttribute("d")).toMatch(/ A /);
    tap(frame, 500, endY);
    // A 30° outgoing segment is square to our -60° measurement, but not to
    // the horizontal PDF line on which the second node landed.
    const nextY = endY + 150 * slope;
    fireEvent.pointerMove(frame, { clientX: 650, clientY: nextY + 4, buttons: 0 });
    expect(frame.querySelector('[data-measure-path]')).toHaveAttribute("data-angle-locked", "true");
    expect(frame.querySelector('[data-measure-angle][data-active-angle="true"]')).toHaveTextContent("90°");
    tap(frame, 650, nextY);
    expect(frame.querySelectorAll('[data-measure-angle]')).toHaveLength(2);
    expect(frame.querySelectorAll('[data-active-angle="true"]')).toHaveLength(0);
    // A 45° change of direction has a 135° inside corner. The arc and label
    // show that actual interior angle rather than marking a 135° arc as 45°.
    fireEvent.pointerMove(frame, {
      clientX: 650 + 120 * Math.cos(75 * Math.PI / 180),
      clientY: nextY + 120 * Math.sin(75 * Math.PI / 180), buttons: 0,
    });
    expect(frame.querySelector('[data-measure-path]')).toHaveAttribute("data-angle-locked", "true");
    expect(frame.querySelector('[data-measure-angle][data-active-angle="true"]')).toHaveTextContent("135°");
  });

  it("keeps arcs at the corner, updates them while moving a node, and removes them with cleared measurements", () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    try {
      const { frame } = openSheet("corner-arcs");
      fireEvent.click(screen.getByRole("button", { name: "Measure" }));
      tap(frame, 200, 300);
      tap(frame, 400, 300);
      tap(frame, 400, 460);
      const corner = frame.querySelector('[data-measure-angle="1"]');
      expect(corner).toHaveTextContent("90°");
      const original = corner?.querySelector('path[data-angle-arc]')?.getAttribute("d");
      fireEvent.pointerDown(frame, { clientX: 400, clientY: 300, pointerId: 1, button: 0 });
      fireEvent.pointerMove(frame, { clientX: 450, clientY: 350, pointerId: 1, buttons: 1 });
      expect(frame.querySelectorAll('[data-measure-node]')).toHaveLength(3);
      expect(frame.querySelector('[data-measure-angle="1"] path[data-angle-arc]')?.getAttribute("d")).not.toBe(original);
      fireEvent.pointerCancel(frame, { pointerId: 1 });
      expect(frame.querySelector('[data-measure-angle="1"] path[data-angle-arc]')).toHaveAttribute("d", original!);
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(frame.querySelector('[data-measure-angle]')).toBeNull();
    } finally { context.mockRestore(); }
  });
});

describe("Gap branching in Measure", () => {
  const source = "0391aed4-7773-47ec-9141-09df373ec008";
  const savedRun = (): Extract<DrawingEntity, { kind: "markup" }> => ({ id: "existing-run", sheetId: source, kind: "markup", data: drawingMarkupSchema.parse({ sourceSheetId: source, type: "dimension", points: [{ x: .25, y: .5 }, { x: .75, y: .5 }], parents: [null, 0], scale: 100, unit: "ft", stroke: "#00ffff", width: 2 }), revision: 1, visibility: "private", authorId: "tim", authorName: "Tim", createdAt: "", updatedAt: "", comments: [] });

  it("gaps into a saved run directly after Measure and updates the same markup using its saved scale", () => {
    const entity = savedRun(), onCreate = vi.fn(), onUpdate = vi.fn();
    const { frame } = openSheet(source, undefined, { annotations: [entity], sharedScale: { unit: "m", unitsPerSheetWidth: 200 }, onCreate, onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("button", { name: "Branch" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    tap(frame, 400, 300);
    expect(frame.querySelectorAll('[data-measure-node]')).toHaveLength(3);
    expect(frame.querySelector('[data-annotation-id="existing-run"]')).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    tap(frame, 400, 180);
    expect(screen.getByRole("status")).toHaveTextContent("65'-0\"");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0]![0]).toBe(entity.id);
    const updated = drawingMarkupSchema.parse(onUpdate.mock.calls[0]![1]);
    expect(updated).toMatchObject({ parents: [null, 2, 0, 2], unit: "ft", scale: 100, stroke: "#00ffff" });
    expect(drawingMeasurement(updated, .5)).toBe("65'-0\"");
    expect(entity.data.points).toHaveLength(2);
  });

  it("cancels an adopted saved run with Escape or Clear without changing the saved markup", () => {
    const entity = savedRun(), onUpdate = vi.fn();
    const { frame } = openSheet(source, undefined, { annotations: [entity], onUpdate });
    for (const action of ["Escape", "Clear"]) {
      if (action === "Escape") fireEvent.click(screen.getByRole("button", { name: "Measure" }));
      fireEvent.click(screen.getByRole("button", { name: "Branch" }));
      tap(frame, 400, 300); tap(frame, 400, 180);
      if (action === "Escape") { fireEvent.keyDown(window, { key: "Escape" }); fireEvent.click(screen.getByRole("button", { name: "Measure" })); }
      else fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(frame.querySelectorAll('[data-measure-node]')).toHaveLength(0);
      expect(frame.querySelector('[data-annotation-id="existing-run"]')).not.toBeNull();
    }
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("uses restored directions for angles without snapping new branch points onto a synthesized PDF line", async () => {
    const entity = savedRun();
    entity.data.points = [{ x: .3, y: .3 }, { x: .5, y: .3 }];
    entity.data.angleReferences = [{ x: 0, y: 1 }, null];
    const { frame } = openSheet(source, { url: "/plan.pdf", page: 1 }, { annotations: [entity], onUpdate: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(loadSnapLines).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    tap(frame, 240, 220); tap(frame, 258, 340);
    expect(frame.querySelector('[data-measure-path]')!.getAttribute("d")).toContain("L258,240");
    expect(frame.querySelector('[data-measure-angle]')).toHaveTextContent("90°");
  });

  it("does not gap into read-only or hidden runs and discards a stale adopted revision", () => {
    const entity = savedRun(), onUpdate = vi.fn();
    const view = openSheet(source, undefined, { annotations: [entity], onUpdate, canEditAnnotation: () => false });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("button", { name: "Branch" })).toBeDisabled();
    view.rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={source} annotations={[entity]} onUpdate={onUpdate} hideAnnotations />);
    expect(screen.getByRole("button", { name: "Branch" })).toBeDisabled();
    view.rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={source} annotations={[entity]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole("button", { name: "Branch" })); tap(view.frame, 400, 300);
    view.rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={source} annotations={[{ ...entity, revision: 2 }]} onUpdate={onUpdate} />);
    expect(view.frame.querySelectorAll('[data-measure-node]')).toHaveLength(0);
    expect(screen.getByRole("note")).toHaveTextContent("measurement changed");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("creates a node on an existing segment, preserves the trunk, and measures only the new branch", () => {
    const { frame } = openSheet("gap-run", undefined, { sharedScale: { unit: "ft", unitsPerSheetWidth: 100 } });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByRole("button", { name: "Branch" })).toBeDisabled();
    tap(frame, 200, 300); tap(frame, 600, 300);
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    tap(frame, 400, 305);
    expect(screen.getByRole("button", { name: "Branch" })).toHaveAttribute("aria-pressed", "false");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(3);
    expect(frame.querySelector('[data-measure-node="2"]')).toHaveAttribute("data-measure-active", "true");
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    tap(frame, 400, 180);
    expect(screen.getByRole("status")).toHaveTextContent("65'-0\"");
    const geometry = frame.querySelector("[data-measure-path]")!.getAttribute("d")!;
    expect(geometry).toContain("M400,200L600,200");
    expect(geometry).toContain("M200,200L400,200");
    expect(geometry).toContain("M400,200L400,80");
    expect(geometry).not.toContain("M600,200L400,200");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("status")).toHaveTextContent("50'-0\"");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(frame.querySelector("[data-measure-path]")).toHaveAttribute("points", "200,200 600,200");
    tap(frame, 720, 300);
    expect(screen.getByRole("status")).toHaveTextContent("65'-0\"");
  });
  it("does not create gap nodes on blank taps, canceled pointers, panning, or pinching", () => {
    const { frame } = openSheet("gap-gestures", undefined, { sharedScale: { unit: "m", unitsPerSheetWidth: 100 } });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300); tap(frame, 600, 300);
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    tap(frame, 400, 450);
    expect(screen.getByRole("note")).toHaveTextContent("Tap an existing measured segment");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    fireEvent.pointerDown(frame, { clientX: 400, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerCancel(frame, { pointerId: 1 });
    fireEvent.pointerDown(frame, { clientX: 400, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 440, clientY: 340, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 440, clientY: 340, pointerId: 1, button: 0 });
    fireEvent.pointerDown(frame, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerDown(frame, { clientX: 500, clientY: 300, pointerId: 2, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 500, clientY: 300, pointerId: 2, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Branch" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("50 m");
  });
  it("reuses a trunk endpoint, supports another branch, and clears branch state with the run", () => {
    const { frame } = openSheet("gap-endpoint", undefined, { sharedScale: { unit: "m", unitsPerSheetWidth: 100 } });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(frame, 200, 300); tap(frame, 600, 300);
    fireEvent.click(screen.getByRole("button", { name: "Branch" })); tap(frame, 200, 300);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    tap(frame, 200, 380);
    expect(screen.getByRole("status")).toHaveTextContent("60 m");
    fireEvent.click(screen.getByRole("button", { name: "Branch" })); tap(frame, 400, 300); tap(frame, 400, 220);
    expect(screen.getByRole("status")).toHaveTextContent("70 m");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Branch" })).toBeDisabled();
  });
});

it("places a short first branch instead of grabbing the new gap node", () => {
  const { frame } = openSheet("gap-short", undefined, { sharedScale: { unit: "ft", unitsPerSheetWidth: 100 } });
  fireEvent.click(screen.getByRole("button", { name: "Measure" }));
  tap(frame, 200, 300); tap(frame, 600, 300);
  fireEvent.click(screen.getByRole("button", { name: "Branch" })); tap(frame, 400, 300);
  tap(frame, 400, 286);
  expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(4);
  expect(screen.getByRole("status")).toHaveTextContent("51'-9\"");
});

it("finishes a measurement through the host completion callback and clears selection", () => {
  const onCreate = vi.fn(), onMeasurementComplete = vi.fn(), onSelect = vi.fn();
  const { frame } = openSheet("sheet-1", undefined, {
    sourceSheetId: "sheet-1", sharedScale: { unit: "m", unitsPerSheetWidth: 100 },
    onCreate, onMeasurementComplete, onSelect,
  });
  fireEvent.click(screen.getByRole("button", { name: "Measure" }));
  tap(frame, 200, 300);
  tap(frame, 600, 300);
  onSelect.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onMeasurementComplete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "dimension" }), undefined);
  expect(onCreate).not.toHaveBeenCalled();
  expect(onSelect).toHaveBeenCalledWith(null);
});

describe("adaptive measurement magnifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const advance = (ms: number) => { void act(() => vi.advanceTimersByTime(ms)); };
  const points = (frame: HTMLElement) => frame.querySelector("[data-measure-path]")?.getAttribute("points");
  const zoom = (frame: HTMLElement) => Number(frame.querySelector("[data-measure-loupe-zoom]")?.getAttribute("data-measure-loupe-zoom"));
  const pointer = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: "touch", buttons: 1, button: 0 });
  function start() {
    const view = openSheet("precision");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    tap(view.frame, 200, 300);
    return view;
  }
  function hold(frame: HTMLElement) {
    fireEvent.pointerDown(frame, pointer(520, 220));
    advance(260);
    expect(zoom(frame)).toBe(2.5);
    advance(400);
    expect(zoom(frame)).toBeGreaterThan(2.5);
    expect(zoom(frame)).toBeLessThan(10);
    advance(600);
    expect(zoom(frame)).toBe(10);
  }

  it("keeps the finely adjusted position on release, including a final pointerup delta", () => {
    const { frame } = start();
    hold(frame);
    fireEvent.pointerMove(frame, pointer(528, 224));
    expect(points(frame)).toBe("200,200 522,121");
    advance(80);
    fireEvent.pointerUp(frame, { ...pointer(530, 224), buttons: 0 });
    expect(points(frame)).toBe("200,200 522.5,121");
    expect(frame.querySelector("[data-measure-loupe-zoom]")).toBeNull();
    advance(2000);
    expect(points(frame)).toBe("200,200 522.5,121");
  });

  it("returns to direct finger placement on a faster swipe, and resets the next hold", () => {
    const { frame } = start();
    hold(frame);
    fireEvent.pointerMove(frame, pointer(528, 224));
    advance(16);
    fireEvent.pointerMove(frame, pointer(608, 264));
    expect(zoom(frame)).toBe(2.5);
    expect(points(frame)).toBe("200,200 608,164");
    fireEvent.pointerUp(frame, { ...pointer(608, 264), buttons: 0 });
    expect(points(frame)).toBe("200,200 608,164");
    fireEvent.pointerDown(frame, pointer(700, 230));
    advance(260);
    expect(zoom(frame)).toBe(2.5);
  });

  it("preserves an existing node under an off-centre touch and saves its fine adjustment", () => {
    const { frame } = start();
    tap(frame, 520, 220);
    fireEvent.pointerDown(frame, pointer(532, 224));
    advance(1000);
    expect(zoom(frame)).toBe(10);
    fireEvent.pointerMove(frame, pointer(540, 228));
    expect(points(frame)).toBe("200,200 522,121");
    const visible = points(frame);
    advance(100);
    fireEvent.pointerUp(frame, { ...pointer(540, 228), buttons: 0 });
    expect(points(frame)).toBe(visible);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
  });

  it("keeps an initial line snap steady, but narrows snapping reach for fine adjustments", async () => {
    vi.mocked(loadSnapLines).mockResolvedValue([{ x1: 0, y1: 0.3, x2: 1, y2: 0.3 }]);
    const { frame } = openSheet("precise-snapping", { url: "/plan.pdf", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(document.querySelector('[data-snapping="ready"]')).toBeTruthy();
    tap(frame, 200, 300);
    fireEvent.pointerDown(frame, pointer(520, 230));
    advance(260);
    advance(1000);
    expect(points(frame)).toBe("200,200 520,120");
    fireEvent.pointerMove(frame, pointer(528, 230));
    expect(points(frame)).toBe("200,200 522,120");
    advance(160);
    fireEvent.pointerMove(frame, pointer(528, 238));
    expect(points(frame)).toBe("200,200 522,120");
    advance(160);
    fireEvent.pointerMove(frame, pointer(528, 254));
    expect(points(frame)).toBe("200,200 522,126");
    fireEvent.pointerUp(frame, { ...pointer(528, 254), buttons: 0 });
    expect(points(frame)).toBe("200,200 522,126");
  });

  it.each(["cancel", "lost capture", "pinch"])("abandons precision safely on %s", (reason) => {
    const { frame, unmount } = start();
    tap(frame, 520, 220);
    fireEvent.pointerDown(frame, pointer(520, 220));
    advance(1000);
    fireEvent.pointerMove(frame, pointer(528, 224));
    expect(points(frame)).toBe("200,200 522,121");
    if (reason === "cancel") fireEvent.pointerCancel(frame, pointer(528, 224));
    else if (reason === "lost capture") fireEvent.lostPointerCapture(frame, pointer(528, 224));
    else fireEvent.pointerDown(frame, { ...pointer(640, 320), pointerId: 2 });
    advance(1000);
    expect(points(frame)).toBe("200,200 520,120");
    expect(frame.querySelector("[data-measure-loupe-zoom]")).toBeNull();
    unmount();
    advance(2000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
