import { execFile } from "node:child_process";
import path from "node:path";
import { dilate, erode, type Mask } from "./raster-rooms";

export type RasterStep = { kind: "erode" | "dilate"; radius: number };
type Engine = "auto" | "rust" | "typescript";
const MAX_PIXELS = 25_000_000;
const MIN_NATIVE_PIXELS = 262_144;
const TIMEOUT_MS = 15_000;
let busy = false;
let warned = false;

function validate(mask: Mask, steps: readonly RasterStep[]) {
  if (
    !Number.isInteger(mask.width) ||
    !Number.isInteger(mask.height) ||
    mask.width < 1 ||
    mask.height < 1 ||
    mask.width > 8192 ||
    mask.height > 8192 ||
    mask.width * mask.height > MAX_PIXELS ||
    mask.data.length !== mask.width * mask.height ||
    steps.length < 1 ||
    steps.length > 16 ||
    steps.some(
      (s) =>
        !["erode", "dilate"].includes(s.kind) ||
        !Number.isInteger(s.radius) ||
        s.radius < 0 ||
        s.radius > 256,
    )
  )
    throw new Error("Invalid raster request");
}

export function rasterTypeScript(
  mask: Mask,
  steps: readonly RasterStep[],
): Mask {
  validate(mask, steps);
  return steps.reduce(
    (out, step) => (step.kind === "dilate" ? dilate : erode)(out, step.radius),
    mask,
  );
}

/** One request per child; no network, shell, files, or customer identifiers. */
export async function rasterRust(
  mask: Mask,
  steps: readonly RasterStep[],
): Promise<Mask> {
  validate(mask, steps);
  if (busy) throw new Error("Raster worker busy");
  busy = true;
  try {
    const header = Buffer.alloc(16 + steps.length * 8);
    header.write("FMR1");
    header.writeUInt32LE(mask.width, 4);
    header.writeUInt32LE(mask.height, 8);
    header.writeUInt32LE(steps.length, 12);
    steps.forEach((step, i) => {
      header.writeUInt32LE(step.kind === "dilate" ? 1 : 0, 16 + i * 8);
      header.writeUInt32LE(step.radius, 20 + i * 8);
    });
    const binary = path.join(
      process.cwd(),
      "native/room-raster/target/release/foreman-room-raster",
    );
    const output = await new Promise<Buffer>((resolve, reject) => {
      // prlimit bounds the native child's address space and CPU independently
      // of Node. It also inherits the existing detection worker's cgroup.
      const child = execFile(
        "/usr/bin/prlimit",
        ["--as=201326592", "--cpu=10:11", "--nofile=16:16", "--", binary],
        {
          encoding: "buffer",
          maxBuffer: mask.data.length + 12,
          timeout: TIMEOUT_MS,
          killSignal: "SIGKILL",
          windowsHide: true,
          env: { PATH: "/usr/bin:/bin", LANG: "C", NODE_ENV: "production" },
        },
        (error, stdout) =>
          error ? reject(new Error("Raster worker failed")) : resolve(stdout),
      );
      child.stdin?.on("error", () => {
        /* execFile reports the child failure. */
      });
      child.stdin?.write(header);
      child.stdin?.end(mask.data);
    });
    if (
      output.length !== mask.data.length + 12 ||
      output.toString("ascii", 0, 4) !== "FMR1" ||
      output.readUInt32LE(4) !== mask.width ||
      output.readUInt32LE(8) !== mask.height
    ) {
      throw new Error("Invalid raster worker response");
    }
    return {
      width: mask.width,
      height: mask.height,
      data: output.subarray(12),
    };
  } finally {
    busy = false;
  }
}

/** Retains the original implementation for small inputs, unsupported hosts,
 * disabled native mode, or a bounded worker failure. Never changes detection rules. */
export async function rasterMorphology(
  mask: Mask,
  steps: readonly RasterStep[],
  engine?: Engine,
): Promise<Mask> {
  validate(mask, steps);
  const selected =
    engine ??
    (process.env.FOREMAN_RASTER_ENGINE === "typescript"
      ? "typescript"
      : "auto");
  if (
    selected === "typescript" ||
    (selected === "auto" && mask.data.length < MIN_NATIVE_PIXELS)
  )
    return rasterTypeScript(mask, steps);
  const start = performance.now();
  try {
    const result = await rasterRust(mask, steps);
    if (selected === "auto")
      console.info(
        `[room-raster] engine=rust pixels=${mask.data.length} steps=${steps.length} ms=${Math.round(performance.now() - start)}`,
      );
    return result;
  } catch (error) {
    if (selected === "rust") throw error;
    if (!warned) {
      warned = true;
      console.warn("[room-raster] native worker unavailable; using TypeScript");
    }
    return rasterTypeScript(mask, steps);
  }
}

export function closeOpenSteps(
  closeRadius: number,
  openRadius: number,
): RasterStep[] {
  return [
    { kind: "dilate", radius: closeRadius },
    { kind: "erode", radius: closeRadius },
    { kind: "erode", radius: openRadius },
    { kind: "dilate", radius: openRadius },
  ];
}
