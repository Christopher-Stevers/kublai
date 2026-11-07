import { createCanvas, ImageData } from "@napi-rs/canvas";
/** Estimate dominant orthogonal wall frame from ink; no reference geometry is read. */
export function inkWallAngle(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const scale = Math.min(1, 800 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  const source = createCanvas(width, height);
  source
    .getContext("2d")
    .putImageData(new ImageData(rgba, width, height), 0, 0);
  const small = createCanvas(w, h),
    ctx = small.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const dark = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    return data[i]! + data[i + 1]! + data[i + 2]! < 540;
  };
  const points: Array<[number, number]> = [];
  for (let y = 24; y < h - 24; y += 2)
    for (let x = 24; x < w - 24; x += 2) if (dark(x, y)) points.push([x, y]);
  if (points.length < 50) return 0;
  const step = Math.max(1, Math.ceil(points.length / 1500));
  const scores = new Float64Array(90);
  for (let degree = 0; degree < 90; degree++) {
    const angle = (degree * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    for (let i = 0; i < points.length; i += step) {
      const [x, y] = points[i]!;
      for (const [dx, dy] of [
        [c, s],
        [-s, c],
      ]) {
        let hits = 0;
        for (const d of [-24, -12, 12, 24]) {
          const px = x + dx! * d,
            py = y + dy! * d;
          if (
            dark(px, py) ||
            dark(px - dy!, py + dx!) ||
            dark(px + dy!, py - dx!)
          )
            hits++;
        }
        if (hits >= 3) scores[degree] = scores[degree]! + hits;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 90; i++) if (scores[i]! > scores[best]!) best = i;
  // A weak angle signal should not rotate an already orthogonal drawing.
  if (scores[best]! < scores[0]! * 1.12) return 0;
  return ((best > 45 ? best - 90 : best) * Math.PI) / 180;
}
export function rotateWallImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  angle: number,
) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const w = Math.ceil(Math.abs(width * c) + Math.abs(height * s)),
    h = Math.ceil(Math.abs(width * s) + Math.abs(height * c));
  const source = createCanvas(width, height);
  source
    .getContext("2d")
    .putImageData(new ImageData(rgba, width, height), 0, 0);
  const target = createCanvas(w, h),
    ctx = target.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-angle);
  ctx.drawImage(source, -width / 2, -height / 2);
  const forward = (p: { x: number; y: number }) => ({
    x:
      (c * (p.x * width - width / 2) +
        s * (p.y * height - height / 2) +
        w / 2) /
      w,
    y:
      (-s * (p.x * width - width / 2) +
        c * (p.y * height - height / 2) +
        h / 2) /
      h,
  });
  const inverse = (p: { x: number; y: number }) => ({
    x: (c * (p.x * w - w / 2) - s * (p.y * h - h / 2) + width / 2) / width,
    y: (s * (p.x * w - w / 2) + c * (p.y * h - h / 2) + height / 2) / height,
  });
  return {
    rgba: ctx.getImageData(0, 0, w, h).data,
    width: w,
    height: h,
    forward,
    inverse,
  };
}
