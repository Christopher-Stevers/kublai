import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreferenceObservationContext } from "./preference-observation-context.mjs";
test("producer HTTP/frames cannot certify consumer evidence or satisfy its counters", () => {
  const report = { requests: [], frames: [] },
    consumer = createPreferenceObservationContext("consumer", report),
    producer = createPreferenceObservationContext("producer", report);
  producer.setRole({ accountMatches: true, canEditExecutive: true });
  producer.setPreference({ canEditExecutive: true });
  producer.recordFrame({ event: "preferences-ready", ready: true });
  producer.recordRequest({ procedure: "user.getMyRole" });
  assert.equal(consumer.latestRole, null);
  assert.equal(consumer.latestPreference, null);
  assert.equal(consumer.frames.length, 0);
  assert.equal(consumer.requests.length, 0);
  assert.equal(report.frames[0].contextId, "producer");
  consumer.setRole({ canEditExecutive: false });
  consumer.recordFrame({
    event: "preferences-ready",
    ready: false,
    contextId: "producer",
  });
  assert.equal(producer.latestRole.canEditExecutive, true);
  assert.equal(report.frames[1].contextId, "consumer");
  producer.active = false;
  producer.setRole({ canEditExecutive: false });
  producer.recordFrame({ event: "preferences-ready", ready: false });
  assert.equal(producer.latestRole.canEditExecutive, true);
  assert.equal(producer.frames.length, 1);
});
