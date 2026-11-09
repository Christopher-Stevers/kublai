import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  noteDrawingTransfer,
  resetDrawingNetworkForTest,
} from "~/lib/drawing-network";
import { useDrawingLoadOrder } from "./useDrawingLoadOrder";

function Sheet({ src }: { src: string }) {
  const image = useRef<HTMLImageElement>(null);
  const small = useRef<HTMLImageElement>(null);
  const order = useDrawingLoadOrder(src, image, small);
  return (
    <output data-slow={order.slow} data-hold={order.holdDetail}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={small} src="/small.webp" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={image} src={src} alt="Sheet" />
    </output>
  );
}
const read = (view: { container: HTMLElement }) => {
  const { slow, hold } = view.container.querySelector("output")!.dataset;
  return { slow: slow === "true", holdDetail: hold === "true" };
};
const timing = (entry: object | undefined) =>
  vi
    .spyOn(performance, "getEntriesByName")
    .mockReturnValue((entry ? [entry] : []) as PerformanceEntryList);
const load = (image: Element) =>
  act(() => void image.dispatchEvent(new Event("load")));

describe("drawing load order", () => {
  afterEach(() => {
    cleanup();
    resetDrawingNetworkForTest();
    vi.restoreAllMocks();
  });

  it("holds PDF detail until the first download shows a good signal", () => {
    // 76 KB in 150 ms.
    timing({
      transferSize: 76_300,
      encodedBodySize: 76_000,
      requestStart: 10,
      responseEnd: 160,
    });
    const view = render(<Sheet src="/floor-1.webp" />);
    expect(read(view)).toEqual({ slow: false, holdDetail: true });
    load(view.container.querySelector('img[alt=""]')!);
    expect(read(view)).toEqual({ slow: false, holdDetail: false });
  });

  it("on a weak signal holds PDF detail until the sheet image is in", () => {
    // 76 KB in 1.9 s.
    timing({
      transferSize: 76_300,
      encodedBodySize: 76_000,
      requestStart: 10,
      responseEnd: 1910,
    });
    const view = render(<Sheet src="/floor-1.webp" />);
    load(view.container.querySelector('img[alt=""]')!);
    expect(read(view)).toEqual({ slow: true, holdDetail: true });
    load(view.container.querySelector('img[alt="Sheet"]')!);
    expect(read(view)).toEqual({ slow: true, holdDetail: false });
    // The next sheet waits for its own image.
    view.rerender(<Sheet src="/floor-2.webp" />);
    expect(read(view).holdDetail).toBe(true);
  });

  it("stops holding when the sheet image cannot load", () => {
    timing(undefined);
    noteDrawingTransfer(76_000, 1900);
    const view = render(<Sheet src="/floor-1.webp" />);
    expect(read(view).holdDetail).toBe(true);
    act(
      () =>
        void view.container
          .querySelector('img[alt="Sheet"]')!
          .dispatchEvent(new Event("error")),
    );
    expect(read(view).holdDetail).toBe(false);
  });

  it("learns nothing from a copy out of the browser's cache", () => {
    timing({
      transferSize: 0,
      encodedBodySize: 76_000,
      requestStart: 10,
      responseEnd: 12,
    });
    const view = render(<Sheet src="/floor-1.webp" />);
    load(view.container.querySelector('img[alt=""]')!);
    expect(read(view)).toEqual({ slow: false, holdDetail: true });
    load(view.container.querySelector('img[alt="Sheet"]')!);
    expect(read(view).holdDetail).toBe(false);
  });
});
