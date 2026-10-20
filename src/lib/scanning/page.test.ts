import { expect, it } from "vitest";
import {
  averageQuad,
  cornerShift,
  detectPage,
  evenLighting,
  locatePage,
  project,
  rectifyPage,
  type Quad,
} from "./page";
import { renderScene } from "./test-scenes";

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
const error = (a: Quad, b: Quad, w: number, h: number) =>
  Math.max(
    ...a.map((p, i) => Math.hypot((p.x - b[i]!.x) * w, (p.y - b[i]!.y) * h)),
  );

it("finds a whole page with printed lines and rejects clipped pages", () => {
  const f = frame(),
    r = detectPage(f.data, f.w, f.h);
  expect(r.quad).not.toBeNull();
  expect(r.sharpness).toBeGreaterThan(0);
  expect(r.quad![0].x).toBeCloseTo(41 / 320, 2);
  expect(r.quad![2].y).toBeCloseTo(370 / 400, 2);
  const blank = frame(false, false);
  expect(detectPage(blank.data, blank.w, blank.h).sharpness).toBe(0);
  const bad = frame(true);
  const clipped = detectPage(bad.data, bad.w, bad.h);
  expect(clipped.quad).toBeNull();
  expect(clipped.clipped).toBe(true);
});

it("finds pages in varied camera scenes to within 2% of their corners", () => {
  let found = 0,
    total = 0;
  for (let seed = 1; seed <= 60; seed++) {
    if (seed % 5 === 0) continue;
    const scene = renderScene(seed);
    const { quad } = detectPage(scene.data, scene.width, scene.height);
    total++;
    const long = Math.max(scene.width, scene.height);
    if (
      quad &&
      error(quad, scene.corners!, scene.width, scene.height) < long * 0.02
    )
      found++;
  }
  // 20% with the previous detector; about 80% now.
  expect(found / total).toBeGreaterThan(0.75);
}, 30_000);

it("does not report a page when none, or only part of one, is in view", () => {
  for (const seed of [5, 15, 25, 35]) {
    const scene = renderScene(seed, { empty: true });
    expect(detectPage(scene.data, scene.width, scene.height).quad).toBeNull();
  }
  for (const seed of [10, 20, 30, 40]) {
    const scene = renderScene(seed, { clip: true });
    expect(detectPage(scene.data, scene.width, scene.height).quad).toBeNull();
  }
  const data = new Uint8ClampedArray(100 * 100 * 4).fill(240);
  expect(detectPage(data, 100, 100).quad).toBeNull();
});

it("measures and averages outline movement", () => {
  const a: Quad = [
    { x: 0.1, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const b = a.map((p) => ({ ...p, x: p.x + 0.03 })) as Quad;
  expect(cornerShift(a, a)).toBe(0);
  expect(cornerShift(null, a)).toBe(Infinity);
  expect(cornerShift(a, b)).toBeCloseTo(0.03);
  expect(averageQuad([a, b])[1].x).toBeCloseTo(0.815);
});

it("refines a preview outline against the full-resolution frame", () => {
  const scene = renderScene(3, { width: 720, height: 960, blur: 0 });
  const truth = scene.corners!;
  const rough = truth.map((p, i) => ({
    x: p.x + (i % 2 ? 0.007 : -0.006),
    y: p.y + (i < 2 ? 0.005 : -0.006),
  })) as Quad;
  const pixels = { data: scene.data, width: scene.width, height: scene.height };
  expect(error(rough, truth, 720, 960)).toBeGreaterThan(5);
  expect(error(locatePage(pixels, rough), truth, 720, 960)).toBeLessThan(2);
});

it("flattens the page and evens out a shadow", async () => {
  const f = frame(false, false);
  // Shade the lower half of the page as a hand shadow would.
  for (let y = 200; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      for (let k = 0; k < 3; k++) f.data[(y * f.w + x) * 4 + k]! *= 0.6;
  const quad: Quad = [
    { x: 41 / 320, y: 31 / 400 },
    { x: 280 / 320, y: 31 / 400 },
    { x: 280 / 320, y: 370 / 400 },
    { x: 41 / 320, y: 370 / 400 },
  ];
  const page = await rectifyPage(
    { data: f.data, width: f.w, height: f.h },
    quad,
  );
  expect(page.width).toBeCloseTo(239, -1);
  expect(page.height).toBeCloseTo(339, -1);
  const at = (x: number, y: number) =>
    page.data[
      (Math.round(y * page.height) * page.width + Math.round(x * page.width)) *
        4
    ]!;
  expect(at(0.5, 0.2)).toBeGreaterThan(225);
  expect(at(0.5, 0.8)).toBeGreaterThan(225);

  const dim = {
    data: new Uint8ClampedArray(64 * 64 * 4).fill(150),
    width: 64,
    height: 64,
  };
  dim.data[(32 * 64 + 32) * 4] = 40;
  evenLighting(dim);
  expect(dim.data[0]).toBeGreaterThan(225);
  expect(dim.data[(32 * 64 + 32) * 4]).toBeLessThan(80);
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
