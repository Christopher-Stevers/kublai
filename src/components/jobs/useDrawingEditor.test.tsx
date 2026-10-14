import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARKUP_HOLD_MS,
  useDrawingEditor,
  type DrawingEditorProps,
} from "./useDrawingEditor";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";

let frames: Map<number, FrameRequestCallback>;
let sequence: number;
beforeEach(() => {
  sequence = 0;
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const flush = () =>
  act(() => {
    const batch = [...frames.values()];
    frames.clear();
    for (const callback of batch) callback(16);
  });
const entity: DrawingEntity = {
  id: "mark",
  sheetId: "sheet",
  kind: "markup",
  revision: 1,
  visibility: "published",
  authorId: "tim",
  authorName: "Tim",
  createdAt: "",
  updatedAt: "",
  comments: [],
  data: {
    sourceSheetId: "sheet",
    type: "freehand",
    stroke: "#ff0000",
    width: 2,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
    ],
  },
};
function target() {
  const element = document.createElement("div");
  element.dataset.annotationId = entity.id;
  return element;
}
const open = (props: DrawingEditorProps) =>
  renderHook(
    (current: DrawingEditorProps) => useDrawingEditor(current, 0.5, 1000),
    { initialProps: props },
  );

describe("drawing input and frame scheduling", () => {
  it("retains a fast pen corner and release endpoint even before the preview frame", () => {
    const onCreate = vi.fn();
    const { result } = open({
      tool: "freehand",
      sourceSheetId: "sheet",
      onCreate,
    });
    act(() => {
      result.current.down({ x: 0.1, y: 0.1 }, null);
      result.current.move({ x: 0.5, y: 0.1 });
      result.current.move({ x: 0.5, y: 0.5 });
    });
    expect(frames.size).toBe(1);
    act(() => {
      result.current.up({ x: 0.7, y: 0.5 });
    });
    expect(onCreate).toHaveBeenCalledOnce();
    const saved = onCreate.mock.calls[0]![0] as DrawingMarkup;
    expect(saved.points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.5 },
    ]);
    expect(frames.size).toBe(0);
    flush();
    expect(result.current.draft?.points).toEqual([]);
  });
  it("previews the latest drag once per frame, then commits the exact release position once", () => {
    const onUpdate = vi.fn();
    const { result } = open({
      tool: "select",
      annotations: [entity],
      onUpdate,
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Hold still long enough to pick the markup up, then drag it.
    act(() => {
      result.current.down({ x: 0.2, y: 0.2 }, target());
      vi.advanceTimersByTime(MARKUP_HOLD_MS);
    });
    vi.useRealTimers();
    act(() => {
      for (let i = 1; i <= 100; i++)
        result.current.move({ x: 0.2 + i / 1000, y: 0.3 });
    });
    expect(result.current.editing).toBeNull();
    expect(frames.size).toBe(1);
    flush();
    expect(result.current.editing?.data.points[0]?.x).toBeCloseTo(0.3, 12);
    expect(result.current.editing?.data.points[0]?.y).toBeCloseTo(0.3, 12);
    act(() => {
      result.current.move({ x: 0.35, y: 0.35 });
      result.current.up({ x: 0.4, y: 0.4 });
    });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect((onUpdate.mock.calls[0]![1] as DrawingMarkup).points[0]).toEqual({
      x: 0.4,
      y: 0.4,
    });
    expect(frames.size).toBe(0);
    expect(result.current.editing).toBeNull();
  });
  it.each(["permission", "revision", "source", "cancel", "unmount"])(
    "does not resurrect or save a queued preview after %s changes",
    (reason) => {
      const onUpdate = vi.fn();
      const props: DrawingEditorProps = {
        tool: "select",
        sourceSheetId: "sheet",
        annotations: [entity],
        onUpdate,
      };
      const { result, rerender, unmount } = open(props);
      act(() => {
        result.current.down({ x: 0.2, y: 0.2 }, target());
        result.current.move({ x: 0.4, y: 0.4 });
      });
      if (reason === "permission")
        rerender({ ...props, canEditAnnotation: () => false });
      if (reason === "revision")
        rerender({ ...props, annotations: [{ ...entity, revision: 2 }] });
      if (reason === "source") rerender({ ...props, sourceSheetId: "another" });
      if (reason === "cancel") act(() => result.current.cancelGesture());
      if (reason === "unmount") unmount();
      flush();
      if (reason !== "unmount") {
        expect(result.current.editing).toBeNull();
        act(() => {
          result.current.up({ x: 0.4, y: 0.4 });
        });
      }
      expect(onUpdate).not.toHaveBeenCalled();
    },
  );
});
