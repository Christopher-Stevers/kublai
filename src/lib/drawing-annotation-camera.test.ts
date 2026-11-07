// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { paintDrawingAnnotationCamera } from "./drawing-annotation-camera";

describe("buffered annotation pan camera", () => {
  it("moves 120 pan frames without invalidating vector geometry, then rebases before exposing an edge", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const surface = document.createElement("div");
    surface.setAttribute("data-annotation-pan-surface", "");
    surface.append(svg);
    const fit = { width: 1000, height: 750 };
    const frame = { width: 1000, height: 800 };
    const set = vi.spyOn(svg, "setAttribute");
    const paint = (x: number, scale = 20) =>
      paintDrawingAnnotationCamera(svg, fit, frame, { x, y: 0, scale });
    paint(0);
    const initial = svg.getAttribute("viewBox");
    for (let x = 1; x <= 120; x++) paint(x);
    expect(set).toHaveBeenCalledTimes(1);
    expect(svg.getAttribute("viewBox")).toBe(initial);
    expect(surface.style.transform).toBe("translate3d(120px, 0px, 0)");
    // A point at sheet center stays at screen center + pan, across rebases.
    const screenX = () => {
      const [left, , width] = svg
        .getAttribute("viewBox")!
        .split(" ")
        .map(Number);
      const translation = Number(
        /translate3d\(([^p]+)/.exec(surface.style.transform)![1],
      );
      return (
        ((500 - left!) / width!) * parseFloat(surface.style.width) +
        parseFloat(surface.style.left) +
        translation
      );
    };
    expect(screenX()).toBeCloseTo(620);
    paint(380);
    expect(set).toHaveBeenCalledTimes(2);
    expect(surface.style.transform).toBe("translate3d(-192px, 0px, 0)");
    expect(screenX()).toBeCloseTo(880);
    paint(-900); // Long/flick jump cannot expose an empty edge.
    expect(screenX()).toBeCloseTo(-400);
    paint(-900, 50);
    expect(surface.style.transform).not.toContain("scale");
    expect(parseFloat(surface.style.width)).toBe(1768);
    expect(screenX()).toBeCloseTo(-400);
  });

  it("looks ahead on long drags and remains aligned when direction reverses", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const set = vi.spyOn(svg, "setAttribute");
    const fit = { width: 1000, height: 750 },
      frame = { width: 1000, height: 800 };
    const paint = (x: number) =>
      paintDrawingAnnotationCamera(svg, fit, frame, { x, y: 0, scale: 1 });
    paint(0);
    for (let x = 8; x <= 960; x += 8) paint(x);
    // Long drags reuse the guard band instead of repainting each frame.
    expect(set.mock.calls.length).toBeLessThanOrEqual(4);
    for (const x of [900, 700, 450, 200, -100, -600, 2000]) {
      paint(x);
      const [left, , width] = svg
        .getAttribute("viewBox")!
        .split(" ")
        .map(Number);
      const shift = Number(
        /translate3d\(([^p]+)/.exec(svg.style.transform)![1],
      );
      expect(Math.abs(shift)).toBeLessThanOrEqual(365);
      expect(
        ((500 - left!) / width!) * parseFloat(svg.style.width) +
          parseFloat(svg.style.left) +
          shift,
      ).toBeCloseTo(500 + x);
    }
  });

  it("rebases for resized frames and changed sheets", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const view = { x: 0, y: 0, scale: 1 };
    paintDrawingAnnotationCamera(
      svg,
      { width: 390, height: 600 },
      { width: 390, height: 600 },
      view,
    );
    expect(svg.style.width).toBe("780px");
    paintDrawingAnnotationCamera(
      svg,
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      view,
    );
    expect(svg.style.width).toBe("1400px");
    const before = svg.getAttribute("viewBox");
    paintDrawingAnnotationCamera(
      svg,
      { width: 800, height: 1200 },
      { width: 800, height: 600 },
      view,
    );
    expect(svg.getAttribute("viewBox")).not.toBe(before);
  });
});

it("keeps saved and active points aligned during pinch, reversal, pan, and sharp settle", () => {
  const fit = { width: 390, height: 292.5 },
    frame = { width: 390, height: 600 };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const surface = document.createElement("div");
  surface.setAttribute("data-annotation-pan-surface", "");
  surface.append(svg);
  const set = vi.spyOn(svg, "setAttribute");
  const views = Array.from({ length: 90 }, (_, i) => ({
    scale: 1 + 49 * Math.sin((Math.PI * i) / 89),
    x: i * 2.37,
    y: -i * 1.19,
  }));
  for (const view of views) {
    paintDrawingAnnotationCamera(svg, fit, frame, view, true);
    const [left, top, width, height] = svg
      .getAttribute("viewBox")!
      .split(" ")
      .map(Number);
    const shift = /translate3d\(([^p]+)px, ([^p]+)px/.exec(
      surface.style.transform,
    )!;
    const zoom = Number(
      /scale\(([^)]+)/.exec(surface.style.transform)?.[1] ?? 1,
    );
    for (const [x, y] of [
      [500, 375],
      [100, 40],
      [900, 730],
    ]) {
      expect(
        ((x! - left!) / width!) * parseFloat(surface.style.width) * zoom +
          parseFloat(surface.style.left) +
          Number(shift[1]),
      ).toBeCloseTo(195 + view.x + (x! - 500) * 0.39 * view.scale, 8);
      expect(
        ((y! - top!) / height!) * parseFloat(surface.style.height) * zoom +
          parseFloat(surface.style.top) +
          Number(shift[2]),
      ).toBeCloseTo(300 + view.y + (y! - 375) * 0.39 * view.scale, 8);
    }
    // Overscan must cover every visible pixel, even during zoom-out.
    const margin = -parseFloat(surface.style.left);
    expect(Number(shift[1])).toBeLessThanOrEqual(margin + 0.00001);
    expect(Number(shift[2])).toBeLessThanOrEqual(margin + 0.00001);
    expect(
      Number(shift[1]) + parseFloat(surface.style.width) * zoom,
    ).toBeGreaterThanOrEqual(frame.width + margin - 0.00001);
    expect(
      Number(shift[2]) + parseFloat(surface.style.height) * zoom,
    ).toBeGreaterThanOrEqual(frame.height + margin - 0.00001);
  }
  expect(set.mock.calls.length).toBeLessThan(views.length / 2);
  paintDrawingAnnotationCamera(svg, fit, frame, {
    scale: 50,
    x: 12.31,
    y: -23.45,
  });
  expect(surface.style.transform).not.toContain("scale");
});

it("caps high-density buffers independently of zoom, and allocates no active guard band", () => {
  vi.stubGlobal("devicePixelRatio", 3);
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const fit = { width: 1000, height: 750 },
      frame = { width: 1000, height: 800 };
    paintDrawingAnnotationCamera(svg, fit, frame, { scale: 50, x: 0, y: 0 });
    expect(
      parseFloat(svg.style.width) * parseFloat(svg.style.height) * 9,
    ).toBeLessThanOrEqual(16_000_001);
    const active = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    paintDrawingAnnotationCamera(
      active,
      fit,
      frame,
      { scale: 50, x: 0, y: 0 },
      false,
      false,
    );
    expect(active.style.width).toBe("1000px");
    expect(active.style.height).toBe("800px");
  } finally {
    vi.unstubAllGlobals();
  }
});
