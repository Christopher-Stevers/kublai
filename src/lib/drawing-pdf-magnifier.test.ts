import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrawingPdfMagnifier } from "./drawing-pdf-magnifier";
import { loadPdfDocument } from "./pdf-client";
vi.mock("./pdf-client", () => ({ loadPdfDocument: vi.fn() }));
const pending: {
  resolve: () => void;
  reject: (e: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
}[] = [];
const render = vi.fn(
  (_options: {
    canvas: HTMLCanvasElement;
    viewport: { width: number; height: number };
    transform: number[];
  }) => {
    let resolve!: () => void, reject!: (e: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const cancel = vi.fn(() => reject(new Error("cancelled")));
    pending.push({ resolve, reject, cancel });
    return { promise, cancel };
  },
);
const page = {
  getViewport: ({ scale }: { scale: number }) => ({
    width: 1000 * scale,
    height: 500 * scale,
  }),
  render,
};
const crop = { left: 0.4, top: 0.3, width: 0.02, height: 0.04, pixels: 400 };
let lens: DrawingPdfMagnifier;
const ready = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  pending.length = 0;
  render.mockClear();
  ready.mockClear();
  vi.mocked(loadPdfDocument)
    .mockReset()
    .mockResolvedValue({ getPage: async () => page } as unknown as Awaited<
      ReturnType<typeof loadPdfDocument>
    >);
  lens = new DrawingPdfMagnifier({ url: "/plan.pdf", page: 2 }, ready);
});
afterEach(() => {
  lens.dispose();
  vi.useRealTimers();
});
const tick = () => vi.advanceTimersByTimeAsync(50);
it("renders at lens density with only a lens-sized backing canvas", async () => {
  expect(lens.request(crop)).toBeNull();
  await tick();
  const options = render.mock.calls[0]![0];
  expect(options.canvas.width).toBe(400);
  expect(options.canvas.height).toBe(400);
  expect(options.viewport.width).toBe(20000);
  expect(options.transform).toEqual([1, 0, 0, 1, -8000, -3000]);
  pending[0]!.resolve();
  await tick();
  expect(lens.request(crop)).toBe(options.canvas);
  expect(ready).toHaveBeenCalledOnce();
  await tick();
  expect(render).toHaveBeenCalledOnce();
});
it("does not display a delayed crop for a different aim or zoom", async () => {
  lens.request(crop);
  await tick();
  const next = { ...crop, left: 0.6, width: 0.01, height: 0.02 };
  lens.request(next);
  pending[0]!.resolve();
  await tick();
  expect(ready).not.toHaveBeenCalled();
  expect(lens.request(next)).toBeNull();
  pending[1]!.resolve();
  await tick();
  expect(lens.request(next)).not.toBeNull();
  expect(ready).toHaveBeenCalledOnce();
});
it("keeps a cached aim authoritative when the pointer returns during another render", async () => {
  lens.request(crop);
  await tick();
  pending[0]!.resolve();
  await tick();
  const cached = lens.request(crop);
  lens.request({ ...crop, left: 0.7 });
  await tick();
  expect(lens.request(crop)).toBe(cached);
  pending[1]!.resolve();
  await tick();
  expect(lens.request(crop)).toBe(cached);
  expect(ready).toHaveBeenCalledOnce();
});
it("uses the latest aim after PDF loading and bounds canvas memory", async () => {
  let resolve!: (doc: Awaited<ReturnType<typeof loadPdfDocument>>) => void;
  vi.mocked(loadPdfDocument).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  lens.request(crop);
  await tick();
  const latest = { ...crop, left: -0.01, pixels: 9000 };
  lens.request(latest);
  resolve({ getPage: async () => page } as unknown as Awaited<
    ReturnType<typeof loadPdfDocument>
  >);
  await tick();
  expect(render.mock.calls[0]![0].canvas.width).toBe(1536);
  expect(render.mock.calls[0]![0].transform[4]).toBe(768);
});
it("cancels work on closing or changing sheets and never publishes stale detail", async () => {
  lens.request(crop);
  await tick();
  const canvas = render.mock.calls[0]![0].canvas;
  lens.dispose();
  await tick();
  expect(pending[0]!.cancel).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
  expect(ready).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledOnce();
});
it("leaves fallback available after a failure and retries without a busy loop", async () => {
  lens.request(crop);
  await tick();
  pending[0]!.reject(new Error("offline"));
  await tick();
  expect(lens.request(crop)).toBeNull();
  expect(ready).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2900);
  expect(render).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(150);
  expect(render).toHaveBeenCalledTimes(2);
});
