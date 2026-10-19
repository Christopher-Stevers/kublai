import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingLineOverlayLayer } from "./DrawingLineOverlayLayer";
import { loadPdfDocument } from "~/lib/pdf-client";
import { defaultOverlayInk } from "~/lib/drawing-overlay-stack";
vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn() }));
let opened: string[], held: number, maximumHeld: number, fail: boolean;
const written = new WeakMap<HTMLCanvasElement, number[]>();
class TestImage {
  naturalWidth = 2;
  naturalHeight = 1;
  crossOrigin = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private address = "";
  get src() {
    return this.address;
  }
  set src(value: string) {
    this.address = value;
    opened.push(value);
    held++;
    maximumHeld = Math.max(maximumHeld, held);
    queueMicrotask(() =>
      value === "/third.png" && fail ? this.onerror?.() : this.onload?.(),
    );
  }
  removeAttribute() {
    held--;
    this.address = "";
  }
}
beforeEach(() => {
  opened = [];
  held = 0;
  maximumHeld = 0;
  fail = false;
  vi.stubGlobal("Image", TestImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let data = new Uint8ClampedArray(this.width * this.height * 4);
      return {
        fillRect: () => {
          data = new Uint8ClampedArray(this.width * this.height * 4);
          data.fill(255);
        },
        drawImage: (image: TestImage) => {
          for (let i = 0; i < data.length; i += 4) {
            const ink = image.src === "/first.png" ? i === 0 : i === 4;
            data[i] = data[i + 1] = data[i + 2] = ink ? 0 : 255;
            data[i + 3] = 255;
          }
        },
        getImageData: () => ({ data }),
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: (image: { data: Uint8ClampedArray }) =>
          written.set(this, [...image.data]),
      } as unknown as CanvasRenderingContext2D;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const props = {
  first: { src: "/first.png" },
  second: { src: "/second.png" },
  styles: [defaultOverlayInk(0), defaultOverlayInk(1)] as [
    ReturnType<typeof defaultOverlayInk>,
    ReturnType<typeof defaultOverlayInk>,
  ],
  additional: [
    {
      source: { src: "/third.png" },
      style: defaultOverlayInk(2),
      alignment: { x: 0, y: 0, scale: 1 },
    },
  ],
  alignment: { x: 0, y: 0, scale: 1 },
  fit: { width: 2, height: 1 },
  frameSize: { width: 0, height: 0 },
  view: { scale: 1, x: 0, y: 0 },
  dpr: 1,
};
function overview(container: HTMLElement) {
  return container.querySelector<HTMLCanvasElement>("[data-overlay-overview]")!;
}
describe("multi-drawing raster pipeline", () => {
  it("streams real raster callbacks one source at a time, blackens B/C matches, and recolours without loading again", async () => {
    const view = render(<DrawingLineOverlayLayer {...props} />);
    await waitFor(() =>
      expect(written.get(overview(view.container))).toEqual([
        220, 38, 38, 255, 0, 0, 0, 255,
      ]),
    );
    expect(maximumHeld).toBe(1);
    expect(held).toBe(0);
    const count = opened.length;
    view.rerender(
      <DrawingLineOverlayLayer
        {...props}
        styles={[{ color: "#ff00ff", opacity: 1 }, defaultOverlayInk(1)]}
      />,
    );
    await waitFor(() =>
      expect(written.get(overview(view.container))).toEqual([
        255, 0, 255, 255, 0, 0, 0, 255,
      ]),
    );
    expect(opened).toHaveLength(count);
  });
  it("does not fetch a hidden additional layer", async () => {
    fail = true;
    const view = render(
      <DrawingLineOverlayLayer
        {...props}
        additional={[
          { ...props.additional[0]!, style: { color: "#16a34a", opacity: 0 } },
        ]}
      />,
    );
    await waitFor(() =>
      expect(written.get(overview(view.container))).toEqual([
        220, 38, 38, 255, 8, 145, 178, 255,
      ]),
    );
    expect(opened).not.toContain("/third.png");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reports a failed layer and retries the complete stack", async () => {
    fail = true;
    const view = render(<DrawingLineOverlayLayer {...props} />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not open"),
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry overlay" }));
    await waitFor(() =>
      expect(written.get(overview(view.container))).toEqual([
        220, 38, 38, 255, 0, 0, 0, 255,
      ]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

it("retries failed PDF detail on reconnect and follows gestures in screen pixels", async () => {
  const pdf = vi.mocked(loadPdfDocument);
  pdf.mockRejectedValue(new Error("Offline"));
  const paintRef = { current: null as ((view: { scale: number; x: number; y: number }) => void) | null };
  const view = render(<DrawingLineOverlayLayer {...props} screenSpace paintRef={paintRef}
    first={{ src: "/first.png", pdf: { url: "/first.pdf", page: 1 } }}
    frameSize={{ width: 2, height: 1 }} />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load drawing detail"));
  const detail = view.container.querySelector<HTMLCanvasElement>("[data-overlay-detail]")!;
  expect(detail.style.visibility).toBe("hidden");
  expect(overview(view.container).style.visibility).toBe("visible");
  pdf.mockResolvedValue({ getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 2 * scale, height: scale }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  }) } as never);
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(detail.style.visibility).toBe("visible"));
  expect(screen.queryByRole("alert")).toBeNull();
  const before = Number(detail.style.transform.match(/translate3d\(([-.\d]+)px/)![1]);
  act(() => paintRef.current?.({ scale: 1, x: 7, y: 0 }));
  expect(Number(detail.style.transform.match(/translate3d\(([-.\d]+)px/)![1])).toBeCloseTo(before + 7);
  expect(detail.style.width).toMatch(/px$/);
  expect(held).toBe(0);
  pdf.mockReset();
});
