import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
let wasm: Promise<Buffer> | undefined;
export async function GET() {
  wasm ??= readFile(
    path.join(process.cwd(), "node_modules/web-ifc/web-ifc.wasm"),
  ).catch((error) => {
    wasm = undefined;
    throw error;
  });
  return new Response(new Uint8Array(await wasm), {
    headers: {
      "Content-Type": "application/wasm",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
