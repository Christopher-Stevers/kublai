import { describe, expect, it } from "vitest";
import { parseSpeedMetrics } from "./speed-telemetry";
describe("anonymous speed payload", () => {
  it("accepts bounded numeric metrics and strips precision", () => {
    expect(parseSpeedMetrics([{ name: "inp", durationMs: 17.1 }])).toEqual([
      { name: "inp", durationMs: 17 },
    ]);
  });
  it("rejects arbitrary labels, content and invalid numbers", () => {
    for (const payload of [
      [{ name: "private-job", durationMs: 2 }],
      [{ name: "inp", durationMs: 2, jobId: "secret" }],
      [{ name: "inp", durationMs: Infinity }],
      Array(31).fill({ name: "inp", durationMs: 2 }),
    ])
      expect(parseSpeedMetrics(payload)).toBeNull();
  });
});

import { parseSpeedPayload, speedScreen } from "./speed-telemetry";
it("permits only coarse tags and rejects unknown properties", () => {
  const valid = {
    version: 1,
    build: "abc123",
    screen: "job",
    device: "phone",
    link: "fast",
    metrics: [{ name: "inp", durationMs: 12 }],
  };
  expect(parseSpeedPayload(valid)).not.toBeNull();
  expect(parseSpeedPayload({ ...valid, userId: "private" })).toBeNull();
  expect(
    parseSpeedPayload({ ...valid, screen: "/jobs/private-job" }),
  ).toBeNull();
  expect(speedScreen("/jobs/private-job")).toBe("job");
});
