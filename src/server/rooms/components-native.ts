import { execFile } from "node:child_process";
import path from "node:path";
import { freeComponents, type Mask } from "./raster-rooms";

let busy = false;
/** Bounded native free-space labeling. Detection thresholds and IDs stay unchanged. */
export async function freeComponentsNative(
  mask: Mask,
  engine: "auto" | "rust" | "typescript" = "auto",
) {
  const { width, height, data } = mask;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    data.length !== width * height ||
    data.length > 25_000_000
  )
    throw new Error("Invalid component mask");
  if (
    engine === "typescript" ||
    (engine === "auto" &&
      (process.env.FOREMAN_RASTER_ENGINE === "typescript" ||
        data.length < 262_144 ||
        busy))
  )
    return freeComponents(mask);
  if (busy) throw new Error("Component worker busy");
  busy = true;
  try {
    const header = Buffer.alloc(16);
    header.write("FRC1");
    header.writeUInt32LE(width, 4);
    header.writeUInt32LE(height, 8);
    const result = await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        "/usr/bin/prlimit",
        [
          "--as=536870912",
          "--cpu=10:11",
          "--nofile=16:16",
          "--",
          path.join(
            process.cwd(),
            "native/room-raster/target/release/foreman-room-raster",
          ),
        ],
        {
          encoding: "buffer",
          timeout: 15_000,
          killSignal: "SIGKILL",
          maxBuffer: 24 + data.length * 12,
          env: { PATH: "/usr/bin:/bin", LANG: "C", NODE_ENV: "production" },
        },
        (error, stdout) =>
          error
            ? reject(new Error("Component worker failed"))
            : resolve(stdout),
      );
      child.stdin?.on("error", () => {
        /* execFile reports failure */
      });
      child.stdin?.write(header);
      child.stdin?.end(data);
    });
    if (
      result.length < 24 ||
      result.toString("ascii", 0, 4) !== "FRC1" ||
      result.readUInt32LE(4) !== width ||
      result.readUInt32LE(8) !== height
    )
      throw new Error("Invalid component response");
    const count = result.readUInt32LE(12);
    if (
      count < 1 ||
      count > data.length + 1 ||
      result.length !== 16 + data.length * 4 + count * 8
    )
      throw new Error("Invalid component response length");
    const labels = new Int32Array(data.length);
    for (let i = 0; i < labels.length; i++)
      labels[i] = result.readInt32LE(16 + i * 4);
    const sizes: number[] = [],
      touchesBorder: boolean[] = [];
    for (let i = 0; i < count; i++) {
      const offset = 16 + data.length * 4 + i * 8;
      sizes.push(result.readUInt32LE(offset));
      touchesBorder.push(result.readUInt32LE(offset + 4) === 1);
    }
    return { labels, sizes, touchesBorder };
  } catch (error) {
    if (engine === "rust") throw error;
    console.warn(
      "[room-components] native worker unavailable; using TypeScript",
    );
    return freeComponents(mask);
  } finally {
    busy = false;
  }
}
