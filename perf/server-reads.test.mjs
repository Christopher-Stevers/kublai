import { test } from "node:test";
import assert from "node:assert/strict";
import { readServerTiming, summarizeReads } from "./server-reads.mjs";

test("reads app and database timing without conflating overlapping database waits", () => {
  assert.deepEqual(readServerTiming("db;dur=12.3, app;dur=9.4"), {
    appMs: 9.4,
    databaseMs: 12.3,
  });
  assert.deepEqual(readServerTiming("cache;desc=hit, app;dur=0.0, db;dur=0"), {
    appMs: 0,
    databaseMs: 0,
  });
});
test("refuses partial streaming, missing, duplicate and malformed durations", () => {
  for (const value of [
    undefined,
    "app;dur=1",
    "db;dur=1, app;dur=2, app;dur=3",
    'db;dur=1;desc="before stream headers",app;dur=2',
    "db;dur=-1,app;dur=2",
    "db;dur=1,app;dur=NaN",
    "db;dur=1,app;dur=",
    "db;dur=1,app;dur=2;dur=3",
    "db;dur=1=2,app;dur=2",
  ])
    assert.throws(() => readServerTiming(value));
});
test("retains every endpoint and includes outliers in nearest-rank percentiles", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    procedure: i % 2 ? "second" : "first",
    appMs: i + 1,
    databaseMs: 0,
  }));
  samples.push({ procedure: "first", appMs: 1000, databaseMs: 2000 });
  const summary = summarizeReads(samples);
  assert.equal(summary.aggregate.count, 21);
  assert.equal(summary.aggregate.appP95Ms, 20);
  assert.equal(summary.byProcedure.first.count, 11);
  assert.equal(summary.byProcedure.first.appP95Ms, 1000);
  assert.equal(summary.byProcedure.first.databaseP95Ms, 2000);
  assert.equal(summary.byProcedure.second.count, 10);
  assert.equal(samples.length, 21);
});
