import { brotliCompressSync, constants } from "node:zlib";
const quality = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };
export const compress = (bytes: Uint8Array) =>
  brotliCompressSync(bytes, quality);
export function quantize13(value: number, min: number, span: number) {
  return Math.max(0, Math.min(8191, Math.round(((value - min) / span) * 8191)));
}
function variable(value: number, out: number[]) {
  let n = value >>> 0;
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
}
function delta(value: number, out: number[]) {
  variable(((value << 1) ^ (value >> 31)) >>> 0, out);
}
export function encodeSpatialPaths(
  list: any,
  names: Record<number, string>,
  width: number,
  height: number,
) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [],
    records: any[] = [],
    meshes = new Map<string, number>(),
    buffers: Uint8Array[] = [];
  const multiply = (a: number[], b: number[]) => [
    a[0]! * b[0]! + a[2]! * b[1]!,
    a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!,
    a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
    a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
  ];
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names[list.fnArray[i]],
      args = list.argsArray[i];
    if (name === "save") stack.push([...matrix]);
    else if (name === "restore") matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (name === "transform") matrix = multiply(matrix, args);
    else if (name === "constructPath") {
      const commands: any[] = [],
        points: number[][] = [];
      for (const raw of args[1] ?? []) {
        if (!raw) continue;
        const p = Array.from(raw) as number[];
        for (let j = 0; j < p.length; ) {
          const op = p[j++]!,
            n = op === 0 || op === 1 ? 1 : op === 2 ? 3 : op === 3 ? 2 : 0,
            command = [op];
          for (let k = 0; k < n; k++) {
            const x = p[j++]!,
              y = p[j++]!,
              world = [
                matrix[0]! * x + matrix[2]! * y + matrix[4]!,
                matrix[1]! * x + matrix[3]! * y + matrix[5]!,
              ];
            points.push(world);
            command.push(...world);
          }
          commands.push(command);
        }
      }
      if (!points.length) continue;
      const xs = points.map((p) => p[0]!),
        ys = points.map((p) => p[1]!),
        bbox = [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ];
      // Cross-tile geometry stays in its containing ancestor; no unsafe clipping.
      let level = 0,
        tx = 0,
        ty = 0;
      for (let candidate = 1; candidate <= 3; candidate++) {
        const n = 2 ** candidate,
          x0 = Math.floor((bbox[0]! / width) * n),
          x1 = Math.floor((bbox[2]! / width) * n),
          y0 = Math.floor((bbox[1]! / height) * n),
          y1 = Math.floor((bbox[3]! / height) * n);
        if (x0 !== x1 || y0 !== y1 || x0 < 0 || y0 < 0 || x0 >= n || y0 >= n)
          break;
        level = candidate;
        tx = x0;
        ty = y0;
      }
      const n = 2 ** level,
        tile = [(tx * width) / n, (ty * height) / n, width / n, height / n],
        bytes: number[] = [];
      let px = 0,
        py = 0;
      for (const command of commands) {
        bytes.push(command[0]);
        for (let j = 1; j < command.length; j += 2) {
          const x = quantize13(command[j], tile[0]!, tile[2]!),
            y = quantize13(command[j + 1], tile[1]!, tile[3]!);
          delta(x - px, bytes);
          delta(y - py, bytes);
          px = x;
          py = y;
        }
      }
      const raw = Uint8Array.from(bytes),
        key = Buffer.from(raw).toString("base64");
      let mesh = meshes.get(key);
      if (mesh === undefined) {
        mesh = buffers.length;
        meshes.set(key, mesh);
        buffers.push(raw);
      }
      records.push({
        operator: i,
        paint: args[0],
        tile: [level, tx, ty],
        mesh,
        coarseVisible:
          Math.hypot(
            ((bbox[2]! - bbox[0]!) / width) * 512,
            ((bbox[3]! - bbox[1]!) / width) * 512,
          ) >=
          1 / 3,
      });
    }
  }
  const meshBytes = Buffer.concat(
    buffers.map((bytes) => {
      const prefix: number[] = [];
      variable(bytes.length, prefix);
      return Buffer.concat([Buffer.from(prefix), bytes]);
    }),
  );
  const full = Buffer.concat([Buffer.from(JSON.stringify(records)), meshBytes]);
  const coarseRecords = records.filter((r) => r.coarseVisible),
    used = new Set(coarseRecords.map((r) => r.mesh));
  const coarse = Buffer.concat([
    Buffer.from(JSON.stringify(coarseRecords)),
    ...buffers.filter((_, i) => used.has(i)).map((bytes) => Buffer.from(bytes)),
  ]);
  return {
    pathCount: records.length,
    uniqueMeshes: buffers.length,
    coarsePaths: coarseRecords.length,
    geometryBrotliBytes: compress(full).length,
    coarseGeometryBrotliBytes: compress(coarse).length,
    limitations: [
      "style/clip/layer records excluded",
      "glyph/image resource payloads excluded",
      "coarse culling not fidelity approved",
      "mesh reuse includes no symbol placement transform",
    ],
  };
}
