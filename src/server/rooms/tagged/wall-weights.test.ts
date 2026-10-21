import { describe, expect, it } from "vitest";

import { openSpaceMask } from "./wall-weights";

/**
 * 1000×700 page: a building with heavy walls. Top left is a big plant room
 * whose label sits in a pocket cut off by a light grey line; top right has
 * three small labelled closets; the rest is unlabelled open ground.
 */
function page() {
  const W = 1000, H = 700;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  const paint = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = (y * W + x) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
      }
  };
  const wall = (x0: number, y0: number, x1: number, y1: number) => paint(x0, y0, x1, y1, 0);
  wall(100, 100, 700, 105); wall(100, 395, 700, 400); wall(100, 100, 105, 400); wall(695, 100, 700, 400);
  wall(398, 100, 403, 400); // plant room / closets
  wall(100, 248, 403, 253); // plant room / open ground below
  wall(448, 100, 453, 150); wall(498, 100, 503, 150); wall(548, 100, 553, 150); wall(403, 148, 553, 153);
  paint(150, 106, 152, 247, 180); // housekeeping-pad line around the label
  const seeds = [
    { x: 125 / W, y: 175 / H },
    { x: 425 / W, y: 125 / H },
    { x: 475 / W, y: 125 / H },
    { x: 525 / W, y: 125 / H },
  ];
  return { rgba, W, H, seeds };
}

describe("openSpaceMask", () => {
  it("keeps a big plant room whose label a thin line cut off", async () => {
    const { rgba, W, H, seeds } = page();
    const { mask } = await openSpaceMask(rgba, W, H, seeds);
    expect(mask.data[175 * W + 300]).toBe(0);
    // Unlabelled open ground is still blocked off.
    expect(mask.data[320 * W + 250]).toBe(1);
    expect(mask.data[300 * W + 600]).toBe(1);
    expect(mask.data[50 * W + 50]).toBe(1);
  });
});
