import { expect, it } from "vitest";
import { SpeedMetricBuffer, type BufferedSpeedMetric } from "./speed-metric-buffer";
const metric = (name: BufferedSpeedMetric["name"], durationMs = 20): BufferedSpeedMetric => ({ name, durationMs, screen: "jobs", link: "fast" });

it("keeps late INP and journey timing when raw interactions fill the buffer", () => {
  const buffer = new SpeedMetricBuffer();
  for (let i = 0; i < 100; i++) buffer.push(metric("interaction"));
  buffer.push(metric("inp", 104));
  buffer.push(metric("write-to-paint", 24));
  const batch = buffer.peekBatch();
  expect(batch).toHaveLength(30);
  expect(batch).toContainEqual(metric("inp", 104));
  expect(batch).toContainEqual(metric("write-to-paint", 24));
});

it("reserves vital capacity after all diagnostic and journey budgets are used", () => {
  const buffer = new SpeedMetricBuffer();
  const sent: BufferedSpeedMetric[] = [];
  for (const name of ["interaction", "tap-to-paint", "inp"] as const) {
    for (let i = 0; i < 200; i++) {
      buffer.push(metric(name));
      const batch = buffer.peekBatch();
      sent.push(...batch);
      buffer.acknowledge(batch);
    }
  }
  expect(sent.filter(row => row.name === "interaction")).toHaveLength(50);
  expect(sent.filter(row => row.name === "tap-to-paint")).toHaveLength(60);
  expect(sent.filter(row => row.name === "inp")).toHaveLength(10);
  expect(sent).toHaveLength(120);
});

it("keeps failed sends and tags separate, prioritizing a vital from another screen", () => {
  const buffer = new SpeedMetricBuffer();
  buffer.push(metric("interaction"));
  const vital = { ...metric("inp"), screen: "materials" as const, link: "slow" };
  buffer.push(vital);
  const failed = buffer.peekBatch();
  expect(failed).toEqual([vital]);
  expect(buffer.peekBatch()).toEqual(failed);
  buffer.acknowledge(failed);
  buffer.acknowledge(failed);
  expect(buffer.peekBatch()).toEqual([metric("interaction")]);
});
