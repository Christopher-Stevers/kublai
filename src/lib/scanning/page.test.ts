import { expect, it } from "vitest";
import { detectPage, project, stablePage, type Quad } from "./page";
function frame(clipped = false, text = true) {
  const w = 320,
    h = 400,
    data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v =
        x > (clipped ? -1 : 40) && x < 280 && y > 30 && y < 370 ? 235 : 45;
      if (
        text &&
        x > 65 &&
        x < 245 &&
        y > 65 &&
        y < 330 &&
        y % 18 < 3 &&
        x % 40 < 34
      )
        v = 30;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, w, h };
}
it("finds a whole page with printed lines and rejects clipped pages", () => {
  const f = frame(),
    r = detectPage(f.data, f.w, f.h);
  expect(r.quad).not.toBeNull();
  expect(r.sharpness).toBeGreaterThan(70);
  expect(r.quad![0].x).toBeCloseTo(41 / 320);
  expect(r.quad![2].y).toBeCloseTo(369 / 400);
  const blank = frame(false, false);
  expect(detectPage(blank.data, blank.w, blank.h).sharpness).toBe(0);
  const bad = frame(true);
  expect(detectPage(bad.data, bad.w, bad.h).quad).toBeNull();
});
it("rejects uniform backgrounds and motion", () => {
  const data = new Uint8ClampedArray(100 * 100 * 4).fill(240);
  expect(detectPage(data, 100, 100).quad).toBeNull();
  const a: Quad = [
    { x: 0.1, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  expect(stablePage(a, a)).toBe(true);
  expect(stablePage(null, a)).toBe(false);
  expect(stablePage(a, a.map((p) => ({ ...p, x: p.x + 0.03 })) as Quad)).toBe(
    false,
  );
});
it("projective rectification preserves all four corners and straight lines", () => {
  const q: Quad = [
    { x: 20, y: 30 },
    { x: 240, y: 50 },
    { x: 270, y: 380 },
    { x: 35, y: 350 },
  ];
  for (const [u, v, i] of [
    [0, 0, 0],
    [1, 0, 1],
    [1, 1, 2],
    [0, 1, 3],
  ]) {
    const p = project(q, u!, v!);
    expect(p.x).toBeCloseTo(q[i!]!.x);
    expect(p.y).toBeCloseTo(q[i!]!.y);
  }
  const a = project(q, 0.2, 0.4),
    b = project(q, 0.5, 0.4),
    c = project(q, 0.8, 0.4);
  expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeCloseTo(0);
});
