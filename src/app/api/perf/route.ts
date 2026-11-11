import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseSpeedPayload } from "~/lib/speed-telemetry";

export async function POST(request: Request) {
  // The normal application middleware requires a signed-in session. Also reject
  // cross-origin submissions and cap the body before parsing it.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let body = "";
  const decoder = new TextDecoder();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4096) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    body += decoder.decode(value, { stream: true });
  }
  let metrics;
  try {
    metrics = parseSpeedPayload(JSON.parse(body));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!metrics) return new Response(null, { status: 400 });
  const event = JSON.stringify({
    receivedAt: new Date().toISOString(),
    ...metrics,
  });
  const logDir =
    process.env.PERF_LOG_DIR ?? path.join(process.cwd(), "data", "perf");
  if (process.env.PERF_LOG_BACKEND !== "console") {
    await mkdir(logDir, { recursive: true });
    await appendFile(
      path.join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
      event + "\n",
      { mode: 0o600 },
    );
  } else {
    // Existing Worker deployments have no persistent writable filesystem.
    console.info("[speed-field]", event);
  }
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
