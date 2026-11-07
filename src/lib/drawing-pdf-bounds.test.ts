import { act } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completedPdfBounds, preparePdfBounds } from "./drawing-pdf-bounds";
let resolve: () => void, reject: (error: Error) => void;
const bounds = {
  isEmpty: () => false,
  minX: () => 0,
  minY: () => 0,
  maxX: () => 1,
  maxY: () => 1,
};
function fixture() {
  const task = {
    promise: new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    cancel: vi.fn(() => reject(new Error("Canceled"))),
    onContinue: null as null | ((next: () => void) => void),
  };
  const page = {
    recordedBBoxes: null,
    getViewport: ({ scale }: { scale: number }) => ({
      width: 2000 * scale,
      height: 1000 * scale,
    }),
    render: vi.fn((_options: Record<string, unknown>) => task),
  };
  return { page: page as unknown as PDFPageProxy, task, render: page.render };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
it("shares bounded full-page preparation, pauses during motion and publishes only completed bounds", async () => {
  const { page, render, task } = fixture();
  let settled = false;
  const ready = vi.fn(),
    other = vi.fn();
  const stop = preparePdfBounds(page, ready, () => settled);
  await advance(500);
  expect(render).not.toHaveBeenCalled();
  settled = true;
  await advance(250);
  expect(render).toHaveBeenCalledOnce();
  const canvas = render.mock.calls[0]![0] as unknown as {
    canvas: HTMLCanvasElement;
  };
  expect(canvas.canvas.width).toBe(768);
  expect(canvas.canvas.height).toBe(384);
  const stopOther = preparePdfBounds(page, other, () => true);
  expect(render).toHaveBeenCalledOnce();
  stop();
  expect(task.cancel).not.toHaveBeenCalled();
  expect(completedPdfBounds(page)).toBeUndefined();
  page.recordedBBoxes = bounds;
  await act(async () => {
    resolve();
    await Promise.resolve();
  });
  expect(completedPdfBounds(page)).toBe(bounds);
  expect(ready).not.toHaveBeenCalled();
  expect(other).toHaveBeenCalledOnce();
  expect(canvas.canvas.width).toBe(0);
  stopOther();
});
it("cancels abandoned and stalled work and never trusts partial bounds", async () => {
  const { page, task } = fixture();
  const ready = vi.fn();
  const stop = preparePdfBounds(page, ready, () => true);
  await advance(200);
  page.recordedBBoxes = bounds;
  await advance(5000);
  expect(task.cancel).toHaveBeenCalled();
  expect(completedPdfBounds(page)).toBeUndefined();
  expect(ready).not.toHaveBeenCalled();
  stop();
  const second = fixture();
  const close = preparePdfBounds(second.page, ready, () => true);
  close();
  await advance(1000);
  expect(second.render).not.toHaveBeenCalled();
});
