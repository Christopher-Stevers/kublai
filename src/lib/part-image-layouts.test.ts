import { expect, it } from "vitest";
import layouts from "./part-image-layouts.json";

it("keeps every audited crop within its original image", () => {
  expect(Object.keys(layouts).length).toBe(1467);
  for (const [url, layout] of Object.entries(layouts)) {
    const [x, y, width, height] = layout.box as [number, number, number, number];
    expect(url).toMatch(/^\/api\/catalogue\/images\//);
    expect(layout.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(x + width).toBeLessThanOrEqual(layout.width);
    expect(y + height).toBeLessThanOrEqual(layout.height);
  }
});
