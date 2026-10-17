export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // clockwise from top left
export function detectPage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const gray = new Uint8Array(width * height);
  let brightness = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(
      data[i * 4]! * 0.299 +
        data[i * 4 + 1]! * 0.587 +
        data[i * 4 + 2]! * 0.114,
    );
    brightness += gray[i]!;
  }
  brightness /= gray.length;
  const seen = new Uint8Array(gray.length),
    queue = new Int32Array(gray.length);
  let best: number[] = [];
  const threshold = Math.max(100, Math.min(210, brightness + 28));
  for (let start = 0; start < gray.length; start++) {
    if (seen[start] || gray[start]! < threshold) continue;
    let head = 0,
      tail = 1;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % width;
      for (const n of [
        x ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width,
      ]) {
        if (n >= 0 && n < gray.length && !seen[n] && gray[n]! >= threshold) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (tail > best.length) best = Array.from(queue.subarray(0, tail));
  }
  if (best.length < gray.length * 0.2)
    return { brightness, quad: null, sharpness: 0 };
  const points = best.map((i) => ({ x: i % width, y: Math.floor(i / width) }));
  const extreme = (score: (p: Point) => number) =>
    points.reduce((a, b) => (score(a) < score(b) ? a : b));
  const quad: Quad = [
    extreme((p) => p.x + p.y),
    extreme((p) => p.y - p.x),
    extreme((p) => -p.x - p.y),
    extreme((p) => p.x - p.y),
  ];
  const area =
    Math.abs(
      quad.reduce((sum, p, i) => {
        const q = quad[(i + 1) % 4]!;
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2;
  // Refuse clipped pages, narrow slivers and non-page bright regions.
  if (
    quad.some(
      (p) => p.x < 4 || p.y < 4 || p.x > width - 5 || p.y > height - 5,
    ) ||
    area < width * height * 0.2 ||
    best.length / area < 0.72 ||
    quad.some(
      (p, i) =>
        Math.hypot(p.x - quad[(i + 1) % 4]!.x, p.y - quad[(i + 1) % 4]!.y) <
        Math.min(width, height) * 0.2,
    )
  )
    return { brightness, quad: null, sharpness: 0 };
  let edges = 0,
    count = 0;
  for (const i of best)
    if (
      quad.every((a, k) => {
        const b = quad[(k + 1) % 4]!;
        const x = i % width,
          y = Math.floor(i / width);
        return (
          Math.abs((b.x - a.x) * (a.y - y) - (a.x - x) * (b.y - a.y)) /
            Math.hypot(b.x - a.x, b.y - a.y) >
          5
        );
      }) &&
      i > width &&
      i < gray.length - width &&
      i % width > 0 &&
      i % width < width - 1
    ) {
      const lap =
        gray[i - 1]! +
        gray[i + 1]! +
        gray[i - width]! +
        gray[i + width]! -
        4 * gray[i]!;
      edges += lap * lap;
      count++;
    }
  return {
    brightness,
    quad: quad.map((p) => ({ x: p.x / width, y: p.y / height })) as Quad,
    sharpness: edges / Math.max(1, count),
  };
}
export function stablePage(a: Quad | null, b: Quad) {
  return (
    !!a && a.every((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y) < 0.012)
  );
}
// Projective map from a unit square into the detected quadrilateral.
export function project(quad: Quad, u: number, v: number): Point {
  const [a, b, c, d] = quad;
  const dx = a.x - b.x + c.x - d.x,
    dy = a.y - b.y + c.y - d.y;
  const den = (b.x - c.x) * (d.y - c.y) - (d.x - c.x) * (b.y - c.y);
  const g =
    Math.abs(den) < 1e-8 ? 0 : (dx * (d.y - c.y) - (d.x - c.x) * dy) / den;
  const h =
    Math.abs(den) < 1e-8 ? 0 : ((b.x - c.x) * dy - dx * (b.y - c.y)) / den;
  const z = g * u + h * v + 1;
  return {
    x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / z,
    y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / z,
  };
}
export async function scanPage(
  video: HTMLVideoElement,
  quad: Quad,
): Promise<string> {
  const source = document.createElement("canvas");
  const scale = Math.min(
    1,
    2600 / Math.max(video.videoWidth, video.videoHeight),
  );
  source.width = Math.round(video.videoWidth * scale);
  source.height = Math.round(video.videoHeight * scale);
  const ctx = source.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, source.width, source.height);
  const input = ctx.getImageData(0, 0, source.width, source.height);
  const q = quad.map((p) => ({
    x: p.x * source.width,
    y: p.y * source.height,
  })) as Quad;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const output = document.createElement("canvas");
  output.width = Math.round(
    Math.max(distance(q[0], q[1]), distance(q[3], q[2])),
  );
  output.height = Math.round(
    Math.max(distance(q[0], q[3]), distance(q[1], q[2])),
  );
  const out = output.getContext("2d")!,
    pixels = out.createImageData(output.width, output.height);
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const p = project(q, x / (output.width - 1), y / (output.height - 1));
      const px = Math.max(0, Math.min(source.width - 2, p.x)),
        py = Math.max(0, Math.min(source.height - 2, p.y)),
        ix = Math.floor(px),
        iy = Math.floor(py),
        fx = px - ix,
        fy = py - iy;
      const at = (xx: number, yy: number, k: number) =>
        input.data[(yy * source.width + xx) * 4 + k]!;
      // Gentle tonal correction, retaining color and faint marks; no destructive binary threshold.
      for (let k = 0; k < 3; k++) {
        const value =
          at(ix, iy, k) * (1 - fx) * (1 - fy) +
          at(ix + 1, iy, k) * fx * (1 - fy) +
          at(ix, iy + 1, k) * (1 - fx) * fy +
          at(ix + 1, iy + 1, k) * fx * fy;
        pixels.data[(y * output.width + x) * 4 + k] = Math.max(
          0,
          Math.min(255, ((value - 8) * 255) / 237),
        );
      }
      pixels.data[(y * output.width + x) * 4 + 3] = 255;
    }
    if (y % 100 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  out.putImageData(pixels, 0, 0);
  return output.toDataURL("image/jpeg", 0.94);
}
export async function scanPdf(pages: string[]) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const image of pages) {
    const jpg = await pdf.embedJpg(image);
    const w = 612,
      h = (w * jpg.height) / jpg.width;
    const page = pdf.addPage([w, h]);
    page.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
  }
  const bytes = await pdf.save();
  if (bytes.length > 49 * 1024 * 1024)
    throw Error("This scan is too large. Save fewer pages in one PDF.");
  return new File([new Uint8Array(bytes)], "Packing slip.pdf", {
    type: "application/pdf",
  });
}
