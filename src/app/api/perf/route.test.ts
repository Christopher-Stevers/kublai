import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { POST } from "./route";
const payload = {
  version: 1,
  build: "test-build",
  screen: "job",
  device: "phone",
  link: "fast",
  metrics: [{ name: "inp", durationMs: 21 }],
};
function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/perf", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
it("rejects cross-origin, oversized and content-bearing payloads", async () => {
  expect(
    (await POST(request(payload, "https://unrelated.invalid"))).status,
  ).toBe(403);
  expect((await POST(request({ ...payload, content: "private" }))).status).toBe(
    400,
  );
  expect((await POST(request("x".repeat(5000)))).status).toBe(413);
});
it("appends only anonymous schema to an isolated daily file", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "speed-telemetry-test-"),
  );
  const previous = process.env.PERF_LOG_DIR;
  process.env.PERF_LOG_DIR = directory;
  try {
    expect((await POST(request(payload))).status).toBe(204);
    const names = await readdir(directory);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
    const saved: unknown = JSON.parse(
      await readFile(path.join(directory, names[0]!), "utf8"),
    );
    expect(saved).toMatchObject(payload);
    expect(Object.keys(saved as Record<string, unknown>).sort()).toEqual([
      "build",
      "device",
      "link",
      "metrics",
      "receivedAt",
      "screen",
      "version",
    ]);
  } finally {
    if (previous === undefined) delete process.env.PERF_LOG_DIR;
    else process.env.PERF_LOG_DIR = previous;
    await rm(directory, { recursive: true });
  }
});
