/** Synthetic camera frames of packing slips for scanner tests and benchmarks.
 * Deterministic per seed: varied surfaces, paper colours, perspective,
 * shadows, glare, blur, folded corners and fingers holding the page. */
import type { Point, Quad } from "./page";

export type Scene = {
  name: string;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Page corners in 0–1 frame coordinates, or null when no whole page is in view. */
  corners: Quad | null;
};

export type SceneOptions = {
  width: number;
  height: number;
  surface: (typeof SURFACES)[number];
  paper: "white" | "yellow" | "pink" | "grey";
  coverage: number;
  rotation: number;
  tilt: number;
  aspect: number;
  shadow: number;
  glare: boolean;
  blur: number;
  noise: number;
  dogEar: boolean;
  finger: boolean;
  dense: boolean;
  light: number;
  /** Push the page partly out of frame. */
  clip: boolean;
  /** No page at all. */
  empty: boolean;
};

export const SURFACES = [
  "wood",
  "concrete",
  "counter",
  "white",
  "clutter",
  "seat",
  "steel",
] as const;

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in roughly [0, 1]. */
function smoothNoise(x: number, y: number, s: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s),
    b = hash(ix + 1, iy, s),
    c = hash(ix, iy + 1, s),
    d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function sceneOptions(
  seed: number,
  overrides: Partial<SceneOptions> = {},
): SceneOptions {
  const r = random(seed);
  const portrait = r() < 0.8;
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  return {
    width: portrait ? 360 : 480,
    height: portrait ? 480 : 360,
    surface: pick(SURFACES),
    paper: pick(["white", "white", "white", "yellow", "pink", "grey"] as const),
    coverage: 0.3 + r() * 0.5,
    rotation: (r() - 0.5) * 0.7,
    tilt: r() * 0.16,
    aspect: pick([11 / 8.5, 11 / 8.5, 11 / 8.5, 5.5 / 8.5, 6 / 4]),
    shadow: r() < 0.5 ? 0.45 + r() * 0.4 : 1,
    glare: r() < 0.25,
    blur: Math.floor(r() * 3),
    noise: 2 + r() * 7,
    dogEar: r() < 0.2,
    finger: r() < 0.25,
    dense: r() < 0.5,
    // Camera auto-exposure keeps overall brightness in a narrow range.
    light: 0.8 + r() * 0.3,
    clip: false,
    empty: false,
    ...overrides,
  };
}

export function renderScene(
  seed: number,
  overrides: Partial<SceneOptions> = {},
): Scene {
  const o = sceneOptions(seed, overrides);
  const r = random(seed * 7 + 3);
  const { width: w, height: h } = o;
  // Page rectangle in frame pixels, rotated, then each corner nudged for perspective.
  const frameArea = w * h * o.coverage;
  let pw = Math.sqrt(frameArea / o.aspect),
    ph = pw * o.aspect;
  const fit = Math.min(
    1,
    (w * 0.84) /
      (Math.abs(Math.cos(o.rotation)) * pw +
        Math.abs(Math.sin(o.rotation)) * ph),
    (h * 0.84) /
      (Math.abs(Math.sin(o.rotation)) * pw +
        Math.abs(Math.cos(o.rotation)) * ph),
  );
  if (!o.clip) {
    pw *= fit;
    ph *= fit;
  }
  const cx = w / 2 + (r() - 0.5) * w * 0.08,
    cy = h / 2 + (r() - 0.5) * h * 0.08;
  const cos = Math.cos(o.rotation),
    sin = Math.sin(o.rotation);
  let corners = (
    [
      [-pw / 2, -ph / 2],
      [pw / 2, -ph / 2],
      [pw / 2, ph / 2],
      [-pw / 2, ph / 2],
    ] as const
  ).map(([x, y]) => ({
    x: cx + x * cos - y * sin + (r() - 0.5) * o.tilt * pw,
    y: cy + x * sin + y * cos + (r() - 0.5) * o.tilt * ph,
  })) as Quad;
  if (o.clip) {
    // Slide the page so one or two corners leave the frame.
    const dx = (r() < 0.5 ? -1 : 1) * w * (0.25 + r() * 0.2),
      dy = r() < 0.5 ? (r() - 0.5) * h * 0.5 : 0;
    corners = corners.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
  }
  const inverse = invert(corners);
  const paper: Record<SceneOptions["paper"], [number, number, number]> = {
    white: [244, 244, 240],
    yellow: [246, 234, 165],
    pink: [244, 205, 214],
    grey: [218, 222, 226],
  };
  const ink: [number, number, number] = [35, 38, 48];
  // Text layout in page coordinates.
  const rows: Array<{ v: number; words: Array<[number, number]> }> = [];
  const step = o.dense ? 0.022 : 0.04;
  for (let v = 0.12; v < 0.9; v += step * (0.8 + r() * 0.6)) {
    const words: Array<[number, number]> = [];
    const end = 0.3 + r() * 0.62;
    for (let u = 0.08; u < end; ) {
      const len = 0.03 + r() * 0.09;
      words.push([u, Math.min(end, u + len)]);
      u += len + 0.015 + r() * 0.02;
    }
    rows.push({ v, words });
  }
  const table =
    r() < 0.6 ? { top: 0.35 + r() * 0.1, bottom: 0.7 + r() * 0.15 } : null;
  const headerBar = r() < 0.25;
  const pageColor = (u: number, v: number): [number, number, number] | null => {
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    if (o.dogEar && u + (1 - v) > 1.9) return null;
    const base = paper[o.paper];
    if (o.dogEar && u + (1 - v) > 1.84)
      return base.map((c) => c * 0.8) as [number, number, number];
    if (headerBar && v > 0.03 && v < 0.08 && u > 0.05 && u < 0.95) return ink;
    if (u > 0.08 && u < 0.24 && v > 0.04 && v < 0.1) return [30, 60, 140];
    if (table && u > 0.06 && u < 0.94 && v > table.top && v < table.bottom) {
      const lw = 0.0025;
      if (
        Math.abs(v - table.top) < lw ||
        Math.abs(v - table.bottom) < lw ||
        Math.abs(u - 0.06) < 0.003 ||
        Math.abs(u - 0.94) < 0.003 ||
        Math.abs(u - 0.6) < 0.003 ||
        Math.abs(u - 0.75) < 0.003
      )
        return ink;
    }
    for (const row of rows)
      if (v > row.v && v < row.v + step * 0.45)
        for (const [a, b] of row.words) if (u > a && u < b) return ink;
    return base;
  };
  const surface = (x: number, y: number): [number, number, number] => {
    const n = hash(x, y, seed) - 0.5;
    switch (o.surface) {
      case "wood": {
        const grain =
          0.8 +
          0.2 * Math.sin(y * 0.18 + 4 * smoothNoise(x * 0.02, y * 0.05, seed));
        return [128 * grain + n * 10, 84 * grain + n * 8, 52 * grain + n * 6];
      }
      case "concrete": {
        const v =
          128 + 40 * (smoothNoise(x * 0.03, y * 0.03, seed) - 0.5) + n * 30;
        return [v, v, v - 4];
      }
      case "counter":
        return [192 + n * 12, 190 + n * 12, 184 + n * 12];
      case "white": {
        const v = 214 + 10 * smoothNoise(x * 0.01, y * 0.01, seed) + n * 6;
        return [v, v, v - 3];
      }
      case "clutter": {
        const block = hash(Math.floor(x / 70), Math.floor(y / 55), seed);
        const v = 70 + block * 150;
        return [
          v * (0.6 + hash(Math.floor(x / 70), 1, seed) * 0.6),
          v,
          v * (0.6 + hash(1, Math.floor(y / 55), seed) * 0.6),
        ];
      }
      case "seat": {
        const weave = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 8 : -8;
        return [46 + weave + n * 14, 46 + weave + n * 14, 54 + weave + n * 14];
      }
      case "steel": {
        const v = 150 + 25 * smoothNoise(x * 0.004, y * 0.2, seed) + n * 10;
        return [v - 4, v, v + 6];
      }
    }
  };
  const finger = o.finger
    ? (() => {
        const side = Math.floor(r() * 4),
          a = corners[side]!,
          b = corners[(side + 1) % 4]!,
          t = 0.3 + r() * 0.4;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          rx: w * 0.05,
          ry: w * 0.09,
        };
      })()
    : null;
  const shadowAngle = r() * Math.PI * 2,
    shadowOffset = (r() - 0.5) * 0.6;
  const glare = o.glare
    ? {
        x: cx + (r() - 0.5) * pw * 0.6,
        y: cy + (r() - 0.5) * ph * 0.6,
        s: w * 0.08,
      }
    : null;

  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let cr = 0,
        cg = 0,
        cb = 0;
      // 2×2 supersampling for anti-aliased page edges.
      for (const [sx, sy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ] as const) {
        const px = x + sx,
          py = y + sy;
        const uv = apply(inverse, px, py);
        let c = o.empty ? null : pageColor(uv.x, uv.y);
        c ??= surface(x, y);
        cr += c[0] / 4;
        cg += c[1] / 4;
        cb += c[2] / 4;
      }
      if (
        finger &&
        ((x - finger.x) / finger.rx) ** 2 + ((y - finger.y) / finger.ry) ** 2 <
          1
      ) {
        cr = 205;
        cg = 150;
        cb = 125;
      }
      let k = o.light;
      if (o.shadow < 1) {
        const d =
          ((x / w - 0.5) * Math.cos(shadowAngle) +
            (y / h - 0.5) * Math.sin(shadowAngle) -
            shadowOffset) *
          14;
        k *= o.shadow + (1 - o.shadow) / (1 + Math.exp(-d));
      }
      let add = 0;
      if (glare)
        add =
          70 *
          Math.exp(
            -((x - glare.x) ** 2 + (y - glare.y) ** 2) / (2 * glare.s ** 2),
          );
      const i = (y * w + x) * 3;
      rgb[i] = cr * k * 1.03 + add;
      rgb[i + 1] = cg * k + add;
      rgb[i + 2] = cb * k * 0.93 + add;
    }
  const blurred = o.blur ? boxBlur(rgb, w, h, o.blur) : rgb;
  const data = new Uint8ClampedArray(w * h * 4);
  const rn = random(seed * 13 + 1);
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < 3; k++)
      data[i * 4 + k] =
        blurred[i * 3 + k]! + (rn() + rn() + rn() - 1.5) * o.noise;
    data[i * 4 + 3] = 255;
  }
  const inside = corners.every(
    (p) => p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h,
  );
  return {
    name: `${seed}:${o.surface}/${o.paper}${o.shadow < 1 ? "/shadow" : ""}${o.glare ? "/glare" : ""}${o.dogEar ? "/dog-ear" : ""}${o.finger ? "/finger" : ""}${o.blur ? `/blur${o.blur}` : ""}${o.clip ? "/clipped" : ""}${o.empty ? "/empty" : ""}`,
    data,
    width: w,
    height: h,
    corners:
      o.empty || !inside
        ? null
        : (corners.map((p) => ({ x: p.x / w, y: p.y / h })) as Quad),
  };
}

type Matrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
/** Frame pixel → page (u, v), by inverting the unit-square projection. */
function invert(q: Quad): Matrix {
  const [p0, p1, p2, p3] = q;
  const dx = p0.x - p1.x + p2.x - p3.x,
    dy = p0.y - p1.y + p2.y - p3.y;
  const den = (p1.x - p2.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p2.y);
  const g = (dx * (p3.y - p2.y) - (p3.x - p2.x) * dy) / den,
    hh = ((p1.x - p2.x) * dy - dx * (p1.y - p2.y)) / den;
  const m: Matrix = [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + hh * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + hh * p3.y,
    p0.y,
    g,
    hh,
    1,
  ];
  const [A, B, C, D, E, F, G, H, I] = m;
  const det = A * (E * I - F * H) - B * (D * I - F * G) + C * (D * H - E * G);
  return [
    (E * I - F * H) / det,
    (C * H - B * I) / det,
    (B * F - C * E) / det,
    (F * G - D * I) / det,
    (A * I - C * G) / det,
    (C * D - A * F) / det,
    (D * H - E * G) / det,
    (B * G - A * H) / det,
    (A * E - B * D) / det,
  ];
}
function apply(m: Matrix, x: number, y: number): Point {
  const z = m[6] * x + m[7] * y + m[8];
  return {
    x: (m[0] * x + m[1] * y + m[2]) / z,
    y: (m[3] * x + m[4] * y + m[5]) / z,
  };
}
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length),
    out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let d = -r; d <= r; d++)
          s += src[(y * w + Math.min(w - 1, Math.max(0, x + d))) * 3 + k]!;
        tmp[(y * w + x) * 3 + k] = s / (2 * r + 1);
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let d = -r; d <= r; d++)
          s += tmp[(Math.min(h - 1, Math.max(0, y + d)) * w + x) * 3 + k]!;
        out[(y * w + x) * 3 + k] = s / (2 * r + 1);
      }
  return out;
}
