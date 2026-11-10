import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  noteDrawingTransfer,
  resetDrawingNetworkForTest,
} from "~/lib/drawing-network";
import {
  useDrawingLoadOrder,
  type DrawingDetailPlan,
} from "./useDrawingLoadOrder";

function Sheet({ src, plan }: { src: string; plan?: DrawingDetailPlan }) {
  const image = useRef<HTMLImageElement>(null);
  const small = useRef<HTMLImageElement>(null);
  const order = useDrawingLoadOrder(src, image, small, plan);
  return (
    <output
      data-slow={order.slow}
      data-hold={order.holdDetail}
      data-image={order.holdImage}
      data-tiles={order.tiles}
      data-rest={order.restTiles}
    >
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

  it("starts a saved PDF immediately even on a weak signal before the preview loads", () => {
    noteDrawingTransfer(76_000, 1900);
    const view = render(<Sheet src="blob:preview" plan={{ pending: false, localPdf: true, imageMayWait: false, detailDone: false }} />);
    expect(read(view).holdDetail).toBe(false);
    expect(view.container.querySelector("output")!.dataset.image).toBe("false");
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

  const holds = (view: { container: HTMLElement }) => {
    const { hold, image } = view.container.querySelector("output")!.dataset;
    return { detail: hold === "true", image: image === "true" };
  };
  const smaller: DrawingDetailPlan = {
    pending: false,
    pdfBytes: 600_000,
    imageBytes: 1_300_000,
    imageMayWait: true,
    detailDone: false,
  };

  it("puts a smaller sheet PDF ahead of the sheet image on a weak signal", () => {
    noteDrawingTransfer(76_000, 1900);
    const view = render(<Sheet src="/floor-1.webp" plan={smaller} />);
    expect(holds(view)).toEqual({ detail: false, image: true });
    view.rerender(
      <Sheet src="/floor-1.webp" plan={{ ...smaller, detailDone: true }} />,
    );
    expect(holds(view)).toEqual({ detail: false, image: false });
    // The next sheet starts over.
    view.rerender(<Sheet src="/floor-2.webp" plan={smaller} />);
    expect(holds(view)).toEqual({ detail: false, image: true });
  });

  it("keeps the image first when it is the smaller download", () => {
    noteDrawingTransfer(76_000, 1900);
    for (const plan of [
      { ...smaller, pdfBytes: 2_000_000 },
      { ...smaller, imageBytes: null },
      { ...smaller, pdfBytes: undefined },
      { ...smaller, imageMayWait: false },
    ]) {
      const view = render(<Sheet src="/floor-1.webp" plan={plan} />);
      expect(holds(view)).toEqual({ detail: true, image: false });
      cleanup();
    }
  });

  it("holds both only until it knows where the sheet's PDF is read from", () => {
    const view = render(
      <Sheet src="/floor-1.webp" plan={{ ...smaller, pending: true }} />,
    );
    expect(holds(view)).toEqual({ detail: true, image: true });
    view.rerender(<Sheet src="/floor-1.webp" plan={smaller} />);
    expect(holds(view)).toEqual({ detail: false, image: true });
  });

  it("starts everything at once on a good signal", () => {
    noteDrawingTransfer(760_000, 500);
    const view = render(
      <Sheet src="/floor-1.webp" plan={{ ...smaller, pending: true }} />,
    );
    expect(holds(view)).toEqual({ detail: true, image: false });
    view.rerender(<Sheet src="/floor-1.webp" plan={smaller} />);
    expect(holds(view)).toEqual({ detail: false, image: false });
  });

  it("lets the image through when the signal turns out good", () => {
    const view = render(<Sheet src="/floor-1.webp" plan={smaller} />);
    expect(holds(view).image).toBe(true);
    act(() => noteDrawingTransfer(760_000, 500));
    expect(holds(view)).toEqual({ detail: false, image: false });
  });

  it("does not keep the image back forever for a stuck PDF", () => {
    vi.useFakeTimers();
    try {
      noteDrawingTransfer(76_000, 1900);
      const view = render(<Sheet src="/floor-1.webp" plan={smaller} />);
      act(() => void vi.advanceTimersByTime(60_000));
      expect(holds(view).image).toBe(true);
      // 600 KB at 8 KB/s.
      act(() => void vi.advanceTimersByTime(20_000));
      expect(holds(view)).toEqual({ detail: false, image: false });
    } finally {
      vi.useRealTimers();
    }
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

  describe("zooming in as the sheet opens", () => {
    const order = (view: { container: HTMLElement }) => {
      const { hold, image, tiles, rest } =
        view.container.querySelector("output")!.dataset;
      return [
        hold === "true" ? "pdf held" : "pdf",
        image === "true" ? "image held" : "image",
        tiles,
        rest === "true" ? "rest" : "no rest",
      ].join(", ");
    };
    // The image is the smaller download, so without a zoom it goes first.
    const sheet: DrawingDetailPlan = {
      pending: false,
      pdfBytes: 600_000,
      imageBytes: 300_000,
      imageMayWait: true,
      detailDone: false,
      hasTiles: true,
    };
    const show = (plan: DrawingDetailPlan, src = "/floor-1.webp") => (
      <Sheet src={src} plan={plan} />
    );

    it("loads the tiles on screen, then the PDF, then the image", () => {
      noteDrawingTransfer(76_000, 1900);
      const view = render(show(sheet));
      expect(order(view)).toBe("pdf held, image, view, rest");
      view.rerender(show({ ...sheet, zoomed: true }));
      expect(order(view)).toBe("pdf held, image held, view, rest");
      view.rerender(show({ ...sheet, zoomed: true, tilesReady: true }));
      expect(order(view)).toBe("pdf, image held, view, rest");
      // Panning to tiles that are not in yet does not stop the PDF again.
      view.rerender(show({ ...sheet, zoomed: true, tilesReady: false }));
      expect(order(view)).toBe("pdf, image held, view, rest");
      view.rerender(show({ ...sheet, zoomed: true, detailDone: true }));
      expect(order(view)).toBe("pdf, image, all, rest");
      // Zooming back out does not start over, and the next sheet does.
      view.rerender(show({ ...sheet, detailDone: true }));
      expect(order(view)).toBe("pdf, image, all, rest");
      view.rerender(show(sheet, "/floor-2.webp"));
      expect(order(view)).toBe("pdf held, image, view, rest");
    });

    it("puts a small sheet PDF ahead of the tiles", () => {
      noteDrawingTransfer(76_000, 1900);
      const view = render(
        show({
          ...sheet,
          pdfBytes: 150_000,
          imageBytes: 100_000,
          zoomed: true,
        }),
      );
      expect(order(view)).toBe("pdf, image held, none, rest");
    });

    it("goes straight to the PDF on a sheet without tiles", () => {
      noteDrawingTransfer(76_000, 1900);
      const view = render(show({ ...sheet, hasTiles: false, zoomed: true }));
      expect(order(view)).toBe("pdf, image held, none, rest");
    });

    it("starts the PDF beside the tiles on a fast link", () => {
      // 600 KB in half a second.
      noteDrawingTransfer(600_000, 500);
      const view = render(show({ ...sheet, zoomed: true }));
      expect(order(view)).toBe("pdf, image held, view, no rest");
      view.rerender(show({ ...sheet, zoomed: true, detailDone: true }));
      expect(order(view)).toBe("pdf, image, all, no rest");
    });

    it("applies on a middling link too, where the image would take the PDF's share", () => {
      // 76 KB in 400 ms: good, not fast.
      noteDrawingTransfer(76_000, 400);
      const view = render(show(sheet));
      expect(order(view)).toBe("pdf, image, view, rest");
      view.rerender(show({ ...sheet, zoomed: true }));
      expect(order(view)).toBe("pdf held, image held, view, rest");
      view.rerender(show({ ...sheet, zoomed: true, tilesReady: true }));
      expect(order(view)).toBe("pdf, image held, view, rest");
    });

    it("leaves the order alone for a zoom after the sheet has had time to load", () => {
      vi.useFakeTimers();
      try {
        noteDrawingTransfer(76_000, 1900);
        const view = render(show(sheet));
        act(() => void vi.advanceTimersByTime(3_000));
        view.rerender(show({ ...sheet, zoomed: true }));
        expect(order(view)).toBe("pdf held, image, view, rest");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not keep the PDF back for tiles that never come", () => {
      vi.useFakeTimers();
      try {
        noteDrawingTransfer(76_000, 1900);
        const view = render(show({ ...sheet, zoomed: true }));
        act(() => void vi.advanceTimersByTime(14_000));
        expect(order(view)).toBe("pdf held, image held, view, rest");
        act(() => void vi.advanceTimersByTime(1_500));
        expect(order(view)).toBe("pdf, image held, view, rest");
      } finally {
        vi.useRealTimers();
      }
    });

    it("holds nothing for a sheet kept on the device", () => {
      noteDrawingTransfer(76_000, 1900);
      const view = render(show({ ...sheet, localPdf: true, zoomed: true }));
      expect(order(view)).toBe("pdf, image, all, rest");
    });
  });
});
