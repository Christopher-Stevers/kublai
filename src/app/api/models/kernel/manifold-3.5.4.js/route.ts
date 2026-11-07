import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
let script: Promise<string> | undefined;
export async function GET() {
  script ??= readFile(
    path.join(process.cwd(), "node_modules/manifold-3d/manifold.js"),
    "utf8",
  ).catch((error) => {
    script = undefined;
    throw error;
  });
  return new Response(await script, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
