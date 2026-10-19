import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DrawingMeasureRunSvg } from "./DrawingMeasureRunSvg";

afterEach(cleanup);
it.each([1, 12])("keeps endpoint fades local without clipping thick or horizontal runs (width %s)", width => {
  const { container } = render(<svg><DrawingMeasureRunSvg
    data={{ sourceSheetId: "sheet", type: "dimension", stroke: "#16a34a", width,
      points: [{ x: 0.2, y: 0.4 }, { x: 0.25, y: 0.4 }], parents: [null, 0] }}
    aspect={0.75} screenPixelSize={0.1} sheetPixelSize={1}
    sharedScale={{ unit: "m", unitsPerSheetWidth: 100 }}
  /></svg>);
  const mask = container.querySelector("mask")!;
  const x = Number(mask.getAttribute("x")), y = Number(mask.getAttribute("y"));
  const w = Number(mask.getAttribute("width")), h = Number(mask.getAttribute("height"));
  const halo = container.querySelector('g[mask] path')!;
  const radius = Number(halo.getAttribute("stroke-width")) / 2;
  expect(x).toBeLessThan(200 - radius);
  expect(x + w).toBeGreaterThan(250 + radius);
  expect(y).toBeLessThan(300 - radius);
  expect(y + h).toBeGreaterThan(300 + radius);
  expect(w).toBeLessThan(100);
  expect(h).toBeLessThan(20);
  expect(container.querySelector('[data-measurement-segment]')).toHaveTextContent("5 m");
  const rect = mask.querySelector("rect")!;
  for (const name of ["x", "y", "width", "height"]) {
    expect(rect.getAttribute(name)).toBe(mask.getAttribute(name));
  }
});
