import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingSheetViewer, type DrawingEditorProps } from "./DrawingSheetViewer";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";

vi.mock("./DrawingComparisonLayer", () => ({ DrawingComparisonLayer: () => null }));
const sourceSheetId = "031060be-2d10-4c21-bda2-dd1619a1e280";
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal("ResizeObserver", class { observe() { return undefined; } disconnect() { return undefined; } });
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function open(props: DrawingEditorProps = {}) {
  const view = render(<DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey={sourceSheetId} {...props} />);
  const image = screen.getByAltText("Sheet");
  const frame = image.parentElement!.parentElement!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  Object.defineProperties(frame, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  fireEvent.load(image);
  return { ...view, frame, image };
}
function tap(frame: Element, x: number, y: number, pointerId = 1) {
  fireEvent.pointerDown(frame, { clientX: x, clientY: y, pointerId, button: 0 });
  fireEvent.pointerUp(frame, { clientX: x, clientY: y, pointerId, button: 0 });
}
function markup(data: Partial<DrawingMarkup> = {}): DrawingEntity {
  return { id: "markup", sheetId: sourceSheetId, kind: "markup", revision: 1, visibility: "published", authorId: "user", authorName: "Tim", createdAt: "", updatedAt: "", comments: [], data: { sourceSheetId, type: "rect", points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }], stroke: "#ef4444", width: 2, ...data } };
}

describe("drawing annotation tools in the real viewer", () => {
  it("creates normalized rectangle geometry in the same transformed sheet as the image", () => {
    const onCreate = vi.fn();
    const { frame, image } = open({ tool: "rect", onCreate, style: { stroke: "#2563eb", width: 3, fill: "#ffffff" } });
    fireEvent.pointerDown(frame, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 600, clientY: 400, pointerId: 1, button: 0 });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ sourceSheetId, type: "rect", points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }], stroke: "#2563eb", fill: "#ffffff" }));
    expect(screen.getByLabelText("Drawing annotations").parentElement).toBe(image.parentElement);
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
  it("selects and moves an existing markup, with endpoint handles and keyboard deletion", () => {
    const onSelect = vi.fn(), onUpdate = vi.fn(), onDelete = vi.fn();
    const { frame, container } = open({ tool: "select", annotations: [markup()], selectedId: "markup", onSelect, onUpdate, onDelete });
    const shape = container.querySelector('[data-annotation-id="markup"] rect')!;
    fireEvent.pointerDown(shape, { clientX: 250, clientY: 250, pointerId: 1, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 330, clientY: 290, pointerId: 1, button: 0 });
    expect(onSelect).toHaveBeenCalledWith("markup");
    expect(onUpdate).toHaveBeenCalledWith("markup", expect.objectContaining({ points: [{ x: 0.35, y: 0.35 }, { x: 0.6, y: 0.6 }] }));
    expect(container.querySelectorAll("[data-annotation-handle]")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "Delete" }); expect(onDelete).toHaveBeenCalledWith("markup");
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
