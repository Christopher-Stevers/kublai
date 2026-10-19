import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingSheetViewer, type DrawingEditorProps } from "./DrawingSheetViewer";
import { MARKUP_SHAKE_MS } from "./useDrawingEditor";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";

vi.mock("./DrawingComparisonLayer", () => ({ DrawingComparisonLayer: () => null }));
const sourceSheetId = "031060be-2d10-4c21-bda2-dd1619a1e280";
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal("ResizeObserver", class { observe() { return undefined; } disconnect() { return undefined; } });
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function open(props: DrawingEditorProps & { toolControls?: ComponentProps<typeof DrawingSheetViewer>["toolControls"];editMeasurementRequest?: {id:number;entityId:string}} = {}) {
  const view = render(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} {...props} />);
  const image = screen.getByAltText("Sheet");
  const frame = image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.parentElement!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  Object.defineProperties(frame, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  fireEvent.load(image);
  return { ...view, frame, image };
}
function tap(frame: Element, x: number, y: number, pointerId = 1) {
  fireEvent.pointerDown(frame, { clientX: x, clientY: y, pointerId, button: 0 });
  fireEvent.pointerUp(frame, { clientX: x, clientY: y, pointerId, button: 0 });
}
/** Hold still on a markup long enough to pick it up. */
async function hold() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, MARKUP_SHAKE_MS + 30)); });
}
function markup(data: Partial<DrawingMarkup> = {}): DrawingEntity {
  return { id: "markup", sheetId: sourceSheetId, kind: "markup", revision: 1, visibility: "published", authorId: "user", authorName: "Tim", createdAt: "", updatedAt: "", comments: [], data: { sourceSheetId, type: "rect", points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }], stroke: "#ef4444", width: 2, ...data } };
}

describe("drawing annotation tools in the real viewer", () => {
  it.each(["rect", "dimension", "link"] as const)("Viewing pans over %s without selecting, editing, or opening it", async type => {
    const entity = markup({ type });
    const onSelect = vi.fn(), onUpdate = vi.fn(), onDelete = vi.fn(), onActivate = vi.fn(), onContextMenu = vi.fn(), onDone = vi.fn();
    const props = { tool: "viewing" as const, annotations: [entity], selectedId: entity.id, onSelect, onUpdate, onDelete, onActivate, onContextMenu, toolControls: { measureRequest: 0, pipeRequest: 0, onDone } };
    const { frame, image, container, rerender } = open(props);
    const target = container.querySelector('[data-annotation-id="markup"]')!;
    expect(target).not.toHaveAttribute("tabindex");
    expect(target).not.toHaveAttribute("role", "button");
    expect(target).not.toHaveClass("annotation-shake");
    expect(container.querySelector('[data-annotation-handle]')).toBeNull();
    const pointer = { pointerId: 1, pointerType: "touch", button: 0 };
    fireEvent.pointerDown(target, { ...pointer, clientX: 250, clientY: 250 });
    await hold();
    fireEvent.pointerMove(frame, { ...pointer, clientX: 330, clientY: 290 });
    fireEvent.pointerUp(frame, { ...pointer, clientX: 330, clientY: 290 });
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.keyDown(target, { key: " " });
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.contextMenu(target, { button: 2, clientX: 310, clientY: 220 });
    for (const callback of [onSelect, onUpdate, onDelete, onActivate, onContextMenu, onDone]) expect(callback).not.toHaveBeenCalled();
    expect(screen.queryByText(/Drag to draw/)).toBeNull();
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} {...props} tool="select" />);
    fireEvent.keyDown(target, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(entity.id);
  });
  it("finishes a path and returns the host to idle without adding the right-click position", () => {
    const onCreate = vi.fn(), onDone = vi.fn();
    const { frame } = open({ tool: "area", onCreate, toolControls: { measureRequest: 0, pipeRequest: 0, onDone } });
    tap(frame, 200, 200); tap(frame, 600, 200); tap(frame, 600, 400);
    const mouse = { button: 2, pointerType: "mouse", pointerId: 1, clientX: 300, clientY: 300 };
    fireEvent.pointerDown(frame, mouse);
    fireEvent.pointerUp(frame, mouse);
    expect(onCreate).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(frame, mouse)).toBe(false);
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ points: [{x:.25,y:.25},{x:.75,y:.25},{x:.75,y:.75}] }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Undo point" })).toBeNull();
  });
  it.each(["rect", "freehand", "text", "issue"] as const)("right-click exits %s without starting a new item", tool => {
    const onCreate = vi.fn(), onPoint = vi.fn(), onDone = vi.fn();
    const { frame } = open({ tool, onCreate, onPoint, toolControls: { measureRequest: 0, pipeRequest: 0, onDone } });
    const mouse = {button:2, pointerType:"mouse", pointerId:1, clientX:200, clientY:200};
    fireEvent.pointerDown(frame, mouse); fireEvent.pointerUp(frame, mouse); fireEvent.contextMenu(frame, mouse);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled(); expect(onPoint).not.toHaveBeenCalled();
  });
  it("offers the markup under a right-click while selecting, without finishing anything", () => {
    const entity = markup(), onContextMenu = vi.fn(), onDone = vi.fn(), onSelect = vi.fn();
    const { frame } = open({ tool: "select", annotations: [entity], onContextMenu, onSelect, toolControls: { measureRequest: 0, pipeRequest: 0, onDone } });
    const target = frame.querySelector(`[data-annotation-id="${entity.id}"]`)!;
    expect(fireEvent.contextMenu(target, { button: 2, clientX: 310, clientY: 220 })).toBe(false);
    expect(onContextMenu).toHaveBeenCalledExactlyOnceWith(entity.id, { x: 310, y: 220 });
    fireEvent.contextMenu(frame, { button: 2, clientX: 50, clientY: 60 });
    expect(onContextMenu).toHaveBeenLastCalledWith(null, { x: 50, y: 60 });
    expect(onDone).not.toHaveBeenCalled();
  });
  it("does not finish a tool when a toolbar control is right-clicked", () => {
    const onDone = vi.fn();
    const { frame } = open({ tool: "area", onCreate: vi.fn(), toolControls: {measureRequest:0,pipeRequest:0,onDone} });
    tap(frame,200,200);
    fireEvent.contextMenu(screen.getByRole("button", {name:"Undo point"}), {button:2});
    expect(onDone).not.toHaveBeenCalled();
  });

  it("keeps equipment-tag highlights translucent and unlabeled, with a full tap area and keyboard activation", () => {
    const entity = markup({ type: "link", text: "AHU-1", linkAppearance: "highlight", links: [{ label: "Manual", url: "https://example.com" }, { label: "Chat", url: "/dashboard/jobs/abc/chat" }] });
    const onActivate = vi.fn(), onSelect = vi.fn();
    const { container, rerender, frame } = open({ annotations: [entity], tool: "pan", onActivate, onSelect });
    const target = container.querySelector('[data-annotation-id="markup"]')!;
    expect(target.querySelector("text")).toBeNull();
    expect(target.querySelector('g[opacity="0.35"] rect')).toHaveAttribute("stroke", "none");
    const hit = target.querySelector('[data-link-hit-area]')!;
    expect(hit).toHaveAttribute("pointer-events", "all");
    expect(hit).toHaveAttribute("width", "250");
    tap(hit, 350, 250);
    fireEvent.keyDown(target, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(hit, { clientX: 350, clientY: 250, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 390, clientY: 280, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 390, clientY: 280, pointerId: 1, button: 0 });
    expect(onActivate).toHaveBeenCalledTimes(2);
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} annotations={[entity]} tool="select" onActivate={onActivate} onSelect={onSelect} />);
    fireEvent.keyDown(container.querySelector('[data-annotation-id="markup"]')!, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("markup");
  });
  it.each(["pan", "select", "rect", "cloud", "freehand", "dimension", "area", "text", "rfi", "issue"] as const)("middle-drag pans in %s without creating or selecting anything", tool => {
    const onCreate = vi.fn(), onSelect = vi.fn(), onUpdate = vi.fn(), onPoint = vi.fn();
    const { frame, image, container } = open({ tool, annotations: [markup()], selectedId: "markup", onCreate, onSelect, onUpdate, onPoint });
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    const mouse = { pointerId: 1, pointerType: "mouse", button: 1, buttons: 4 };
    fireEvent.pointerDown(shape, { ...mouse, clientX: 250, clientY: 250 });
    fireEvent.pointerMove(frame, { ...mouse, clientX: 330, clientY: 290 });
    fireEvent.pointerUp(frame, { ...mouse, buttons: 0, clientX: 330, clientY: 290 });
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
    for (const callback of [onCreate, onSelect, onUpdate, onPoint]) expect(callback).not.toHaveBeenCalled();
    expect(frame).not.toHaveClass("cursor-grabbing");
  });
  it("keeps existing path points when middle-panning over the draft toolbar, then resumes drawing", () => {
    const onCreate = vi.fn();
    const { frame, image } = open({ tool: "area", onCreate });
    tap(frame, 200, 200); tap(frame, 600, 200);
    const undo = screen.getByRole("button", { name: "Undo point" });
    const mouse = { pointerId: 1, pointerType: "mouse", button: 1, buttons: 4 };
    fireEvent.pointerDown(undo, { ...mouse, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(undo, { ...mouse, clientX: 480, clientY: 340 });
    fireEvent.pointerUp(undo, { ...mouse, buttons: 0, clientX: 480, clientY: 340 });
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
    expect(onCreate).not.toHaveBeenCalled();
    tap(frame, 680, 440);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }] }));
  });
  it.each(["pointerCancel", "lostPointerCapture"] as const)("releases middle-pan on %s and restores the active tool", cancellation => {
    const onCreate = vi.fn();
    const { frame } = open({ tool: "rect", onCreate });
    fireEvent.pointerDown(frame, { pointerId: 1, pointerType: "mouse", button: 1, clientX: 250, clientY: 250 });
    fireEvent[cancellation](frame, { pointerId: 1 });
    expect(frame).not.toHaveClass("cursor-grabbing");
    fireEvent.pointerDown(frame, { pointerId: 1, button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(frame, { pointerId: 1, button: 0, clientX: 600, clientY: 400 });
    expect(onCreate).toHaveBeenCalledOnce();
  });
  it("creates normalized rectangle geometry in the same transformed sheet as the image", () => {
    const onCreate = vi.fn();
    const { frame } = open({ tool: "rect", onCreate, style: { stroke: "#2563eb", width: 3, fill: "#ffffff" } });
    fireEvent.pointerDown(frame, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ sourceSheetId, type: "rect", points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }], stroke: "#2563eb", fill: "#ffffff" }));
    expect(screen.getByLabelText("Drawing annotations").parentElement).toBe(frame);
    expect(screen.getByLabelText("Drawing annotations").closest('[data-drawing-sheet-layer]')).toBeNull();
  });
  it("supports tap-to-tap dimensions with the calibrated scale attached", () => {
    const onCreate = vi.fn();
    const { frame } = open({ tool: "dimension", onCreate, sharedScale: { unit: "ft", unitsPerSheetWidth: 100 } });
    tap(frame, 200, 300); tap(frame, 600, 300);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ type: "dimension", scale: 100, unit: "ft", points: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }] }));
  });
  it("keeps polygon drafts local with undo, finish, and cancel", () => {
    const onCreate = vi.fn();
    const { frame } = open({ tool: "area", onCreate });
    tap(frame, 100, 200); tap(frame, 500, 200);
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    tap(frame, 500, 400);
    fireEvent.click(screen.getByRole("button", { name: "Undo point" }));
    expect(onCreate).not.toHaveBeenCalled();
    tap(frame, 300, 400);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onCreate).toHaveBeenCalledOnce();
    tap(frame, 300, 300);
    fireEvent.click(screen.getByRole("button", { name: "Cancel drawing" }));
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(onCreate).toHaveBeenCalledOnce();
  });
  it("aborts a pen gesture when a second finger starts zooming, without saving accidental marks", () => {
    const onCreate = vi.fn();
    const { frame } = open({ tool: "freehand", onCreate });
    fireEvent.pointerDown(frame, { clientX: 200, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 250, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerDown(frame, { clientX: 500, clientY: 300, pointerId: 2, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 550, clientY: 300, pointerId: 2, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 550, clientY: 300, pointerId: 2, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 250, clientY: 300, pointerId: 1, button: 0 });
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("draws a simplified freehand stroke and sends text and RFI anchors to parent forms", () => {
    const onCreate = vi.fn();
    const { frame, unmount } = open({ tool: "freehand", onCreate });
    fireEvent.pointerDown(frame, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    for (let x = 220; x <= 600; x += 20) fireEvent.pointerMove(frame, { clientX: x, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 200, pointerId: 1, button: 0 });
    expect((onCreate.mock.calls[0]![0] as DrawingMarkup).points).toHaveLength(2);
    unmount();
    const text = open({ tool: "text", onCreate }); tap(text.frame, 400, 300); text.unmount();
    expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ type: "text", points: [{ x: 0.5, y: 0.5 }] }));
    const onPoint = vi.fn(); const pin = open({ tool: "rfi", onPoint }); tap(pin.frame, 400, 300);
    expect(onPoint).toHaveBeenCalledWith("rfi", { x: 0.5, y: 0.5 });
  });
  it("selects and moves an existing markup, with resize handles and keyboard deletion", async () => {
    const onSelect = vi.fn(), onUpdate = vi.fn(), onDelete = vi.fn();
    const { frame, container } = open({ tool: "select", annotations: [markup()], selectedId: "markup", onSelect, onUpdate, onDelete });
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith("markup", expect.objectContaining({ points: [{ x: 0.35, y: 0.35 }, { x: 0.6, y: 0.6 }] }));
    expect(container.querySelectorAll("[data-annotation-handle]")).toHaveLength(4);
    fireEvent.keyDown(window, { key: "Delete" }); expect(onDelete).toHaveBeenCalledWith("markup");
  });
  it.each(["move", "resize"] as const)("moves an unfilled selected rectangle through its interior in %s mode", async selectionMode => {
    const onUpdate = vi.fn();
    const { frame, container } = open({ tool: "select", selectionMode, annotations: [markup()], selectedId: "markup", onUpdate });
    const body = container.querySelector('[data-annotation-move-area]')!;
    expect(body).not.toBeNull();
    expect(body.getAttribute("pointer-events")).toBe("all");
    expect(body.getAttribute("fill")).toBe("transparent");
    fireEvent.pointerDown(body, { clientX: 300, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    fireEvent.pointerMove(frame, { clientX: 380, clientY: 290, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 380, clientY: 290, pointerId: 1, button: 0 });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith("markup", expect.objectContaining({ points: [{ x: 0.35, y: 0.35 }, { x: 0.6, y: 0.6 }] }));
  });
  it("keeps markup interiors free for panning or read-only inspection", () => {
    const entity = markup();
    const { container, rerender } = open({ tool: "pan", annotations: [entity], selectedId: entity.id, onUpdate: vi.fn() });
    expect(container.querySelector('[data-annotation-move-area]')).toBeNull();
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} tool="select" annotations={[entity]} selectedId={entity.id} onSelect={vi.fn()} />);
    expect(container.querySelector('[data-annotation-move-area]')).toBeNull();
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} tool="select" annotations={[entity]} selectedId={entity.id} onUpdate={vi.fn()} canEditAnnotation={() => false} />);
    expect(container.querySelector('[data-annotation-move-area]')).toBeNull();
  });
  it("selects an ordinary markup immediately and still pans during the shake", async () => {
    const onSelect = vi.fn(), onUpdate = vi.fn();
    const { frame, image, container } = open({ annotations: [markup()], onSelect, onUpdate });
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    // Selection is immediate; edits wait for the shake.
    tap(shape, 250, 250);
    expect(onSelect).toHaveBeenCalledWith("markup");
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    // Held: it shakes now, and is selected on release.
    expect(container.querySelector('[data-annotation-id="markup"]')).toHaveClass("annotation-shake");
    expect(onSelect).toHaveBeenCalledWith("markup");
    fireEvent.pointerUp(frame, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("markup");
    onSelect.mockClear();
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it("selects immediately without moving the markup when selection changes the viewer layout", async () => {
    const onUpdate = vi.fn();
    const onSelect = vi.fn(() => {
      // The selection toolbar occupies part of the viewer. A stationary
      // pointer then maps to a different normalized sheet position.
      Object.defineProperty(frame, "clientHeight", { value: 250, configurable: true });
      fireEvent.load(image);
    });
    const { frame, image, container } = open({ tool: "select", annotations: [markup({ type: "text", text: "Note", points: [{ x: 0.25, y: 0.25 }] })], onSelect, onUpdate });
    const note = container.querySelector('[data-annotation-id="markup"] text')!;
    fireEvent.pointerDown(note, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(frame.clientHeight).toBe(250);
    fireEvent.pointerUp(frame, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(frame.clientHeight).toBe(250);
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it("selects a held saved measurement without continuing its run", async () => {
    const onSelect = vi.fn(), onUpdate = vi.fn();
    const run = markup({
      type: "dimension",
      parents: [null, 0],
      points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }],
      unit: "m",
      scale: 100,
    });
    const { frame, container } = open({ annotations: [run], onSelect, onUpdate });
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(0);
    const hit = container.querySelector('[data-annotation-id="markup"] path, [data-annotation-id="markup"] polyline')!;
    fireEvent.pointerDown(hit, { clientX: 300, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    fireEvent.pointerUp(frame, { clientX: 300, clientY: 250, pointerId: 1, button: 0 });
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it("resumes a saved measurement only after an explicit Edit request", () => {
    const run = markup({type:"dimension",parents:[null,0],points:[{x:.25,y:.25},{x:.5,y:.25}],unit:"m",scale:100});
    const onSelect=vi.fn();
    const {frame}=open({annotations:[run],onSelect,onUpdate:vi.fn(),editMeasurementRequest:{id:1,entityId:"markup"}});
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
  it("pans instead of moving when a drag starts on a markup without a hold", () => {
    const onSelect = vi.fn(), onUpdate = vi.fn();
    const { frame, image, container } = open({ tool: "select", annotations: [markup()], selectedId: "markup", onSelect, onUpdate });
    const shape = container.querySelector('[data-annotation-id="markup"] rect:not([data-annotation-move-area])')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
  });
  it("moves an initially unselected markup and selects it after its single commit", async () => {
    const events: string[] = [];
    const onSelect = vi.fn(() => { events.push("select"); });
    const onUpdate = vi.fn(() => { events.push("update"); });
    const { frame, container } = open({ tool: "select", annotations: [markup()], onSelect, onUpdate });
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith("markup", expect.objectContaining({ points: [{ x: 0.35, y: 0.35 }, { x: 0.6, y: 0.6 }] }));
    expect(events).toEqual(["select", "update"]);
  });
  it("selects a read-only markup immediately despite permission rerenders", async () => {
    const onSelect = vi.fn(), onUpdate = vi.fn();
    const { frame, container, rerender } = open({ tool: "select", annotations: [markup()], onSelect, onUpdate, canEditAnnotation: () => false });
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    expect(onSelect).toHaveBeenCalledWith("markup");
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} tool="select" annotations={[markup()]} canEditAnnotation={() => false} onSelect={onSelect} onUpdate={onUpdate} />);
    fireEvent.pointerUp(frame, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it("resizes all points of a long pen stroke and commits only once on release", async () => {
    const points = Array.from({ length: 220 }, (_, index) => ({ x: 0.25 + index / 219 * 0.25, y: 0.25 + index / 219 * 0.25 }));
    const onUpdate = vi.fn();
    const { frame, container } = open({ tool: "select", annotations: [markup({ type: "freehand", points })], selectedId: "markup", onUpdate });
    expect(container.querySelectorAll("[data-annotation-handle]")).toHaveLength(4);
    await hold();
    const handle = container.querySelector('[data-annotation-handle="se"] rect')!;
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 480, clientY: 340, pointerId: 1, button: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.pointerMove(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    expect(onUpdate).toHaveBeenCalledOnce();
    const data = onUpdate.mock.calls[0]![1] as DrawingMarkup;
    expect(data.points).toHaveLength(220);
    expect(data.points[0]).toEqual({ x: 0.25, y: 0.25 });
    expect(data.points[219]).toEqual({ x: 0.75, y: 0.75 });
    expect(data.points[100]!.x).toBeCloseTo(0.25 + 100 / 219 * 0.5);
  });
  it("keeps vertex editing available for a calibrated dimension", async () => {
    const onUpdate = vi.fn();
    const { frame, container } = open({ tool: "select", annotations: [markup({ type: "dimension", scale: 100, unit: "ft" })], selectedId: "markup", onUpdate });
    await hold();
    const handle = container.querySelector('[data-annotation-handle="1"] circle')!;
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    expect(onUpdate).toHaveBeenCalledWith("markup", expect.objectContaining({ points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }], scale: 100, unit: "ft" }));
  });
  it("resizes a text note's box through visible corner handles, keeping its text", async () => {
    const onUpdate = vi.fn();
    const { frame, container } = open({ tool: "select", annotations: [markup({ type: "text", text: "Note", points: [{ x: 0.25, y: 0.25 }] })], selectedId: "markup", onUpdate });
    await hold();
    const handle = container.querySelector('[data-annotation-handle="se"] rect')!;
    const x = (Number(handle.getAttribute("x")) + Number(handle.getAttribute("width")) / 2) * 0.8;
    const y = 100 + (Number(handle.getAttribute("y")) + Number(handle.getAttribute("height")) / 2) * 0.8;
    fireEvent.pointerDown(handle, { clientX: x, clientY: y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: x + 80, clientY: y + 40, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: x + 80, clientY: y + 40, pointerId: 1, button: 0 });
    expect(onUpdate).toHaveBeenCalledOnce();
    const data = onUpdate.mock.calls[0]![1] as DrawingMarkup;
    expect(data.textBox!.width).toBeGreaterThan(0);
    expect(data.textBox!.height).toBeGreaterThan(0);
    expect(data.text).toBe("Note");
    expect(data.points[0]!.x).toBe(0.25);
  });
  it("drops a move preview if permissions are revoked before release", async () => {
    const onUpdate = vi.fn();
    const entity = markup();
    const { frame, container, rerender } = open({ tool: "select", annotations: [entity], selectedId: entity.id, onUpdate });
    const shape = container.querySelector('[data-annotation-id="markup"] rect:not([data-annotation-move-area])')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    await hold();
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    await waitFor(() => expect(shape.getAttribute("x")).toBe("350"));
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} tool="select" annotations={[entity]} selectedId={entity.id} canEditAnnotation={() => false} onUpdate={onUpdate} />);
    expect(shape.getAttribute("x")).toBe("250");
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it("hides handles in Move mode and never previews or commits another user's read-only markup", () => {
    const onUpdate = vi.fn(), onDelete = vi.fn();
    const { frame, container, rerender } = open({ tool: "select", selectionMode: "move", annotations: [markup()], selectedId: "markup", onUpdate, onDelete });
    expect(container.querySelectorAll("[data-annotation-handle]")).toHaveLength(0);
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} tool="select" annotations={[markup()]} selectedId="markup" canEditAnnotation={() => false} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(container.querySelectorAll("[data-annotation-handle]")).toHaveLength(0);
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(shape.getAttribute("x")).toBe("250");
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
  it.each(["pointercancel", "second finger"])("abandons an uncommitted resize on %s", async cancellation => {
    const onUpdate = vi.fn();
    const { frame, container } = open({ tool: "select", annotations: [markup()], selectedId: "markup", onUpdate });
    await hold();
    const handle = container.querySelector('[data-annotation-handle="se"] rect')!;
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 480, clientY: 340, pointerId: 1, button: 0 });
    if (cancellation === "pointercancel") fireEvent.pointerCancel(frame, { pointerId: 1 });
    else {
      fireEvent.pointerDown(frame, { clientX: 550, clientY: 350, pointerId: 2, button: 0 });
      fireEvent.pointerUp(frame, { clientX: 550, clientY: 350, pointerId: 2, button: 0 });
    }
    fireEvent.pointerUp(frame, { clientX: 480, clientY: 340, pointerId: 1, button: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    expect(shape.getAttribute("width")).toBe("250");
  });
  it("opens a link on an intentional tap and hides annotation layers without mutating their data", () => {
    const onActivate = vi.fn(); const entity = markup({ type: "link", href: "https://example.com/drawing" });
    const { container, rerender } = open({ tool: "pan", annotations: [entity], onActivate });
    tap(container.querySelector('[data-annotation-id="markup"] rect')!, 250, 250);
    expect(onActivate).toHaveBeenCalledWith(entity.data);
    rerender(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} annotations={[entity]} hideAnnotations />);
    expect(container.querySelector("[data-annotation-id]")).toBeNull();
  });
});
