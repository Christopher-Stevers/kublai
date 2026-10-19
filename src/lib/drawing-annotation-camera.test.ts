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
    const paint = (x: number, scale = 20) => paintDrawingAnnotationCamera(svg, fit, frame, { x, y: 0, scale });
    paint(0);
    const initial = svg.getAttribute("viewBox");
    for (let x = 1; x <= 120; x++) paint(x);
    expect(set).toHaveBeenCalledTimes(1);
    expect(svg.getAttribute("viewBox")).toBe(initial);
    expect(surface.style.transform).toBe("translate3d(120px, 0px, 0)");
    // A point at sheet center stays at screen center + pan, across rebases.
    const screenX = () => {
      const [left, , width] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      const translation = Number(/translate3d\(([^p]+)/.exec(surface.style.transform)![1]);
      return (500 - left!) / width! * parseFloat(surface.style.width) + parseFloat(surface.style.left) + translation;
    };
    expect(screenX()).toBeCloseTo(620);
    paint(160);
    expect(set).toHaveBeenCalledTimes(2);
    expect(surface.style.transform).toBe("translate3d(-96px, 0px, 0)");
    expect(screenX()).toBeCloseTo(660);
    paint(-900); // Long/flick jump cannot expose an empty edge.
    expect(screenX()).toBeCloseTo(-400);
    paint(-900, 50);
    expect(surface.style.transform).not.toContain("scale");
    expect(parseFloat(surface.style.width)).toBe(1384);
    expect(screenX()).toBeCloseTo(-400);
  });

  it("looks ahead on long drags and remains aligned when direction reverses", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const set = vi.spyOn(svg, "setAttribute");
    const fit = { width: 1000, height: 750 }, frame = { width: 1000, height: 800 };
    const paint = (x: number) => paintDrawingAnnotationCamera(svg, fit, frame, { x, y: 0, scale: 1 });
    paint(0);
    for (let x = 8; x <= 960; x += 8) paint(x);
    // Previously initial paint + six rebases; the same memory now needs four.
    expect(set).toHaveBeenCalledTimes(5);
    for (const x of [900, 700, 450, 200, -100, -600, 2000]) {
      paint(x);
      const [left, , width] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      const shift = Number(/translate3d\(([^p]+)/.exec(svg.style.transform)![1]);
      expect(Math.abs(shift)).toBeLessThanOrEqual(144);
      expect((500 - left!) / width! * parseFloat(svg.style.width) - 192 + shift).toBeCloseTo(500 + x);
    }
  });

  it("rebases for resized frames and changed sheets", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const view = { x: 0, y: 0, scale: 1 };
    paintDrawingAnnotationCamera(svg, { width: 390, height: 600 }, { width: 390, height: 600 }, view);
    expect(svg.style.width).toBe("585px");
    paintDrawingAnnotationCamera(svg, { width: 800, height: 600 }, { width: 800, height: 600 }, view);
    expect(svg.style.width).toBe("1100px");
    const before = svg.getAttribute("viewBox");
    paintDrawingAnnotationCamera(svg, { width: 800, height: 1200 }, { width: 800, height: 600 }, view);
    expect(svg.getAttribute("viewBox")).not.toBe(before);
  });
});
