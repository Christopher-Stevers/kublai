import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { summarizePair } from "./summarize-pair.mjs";
import { budgets, READ_PREFLIGHT_PROCEDURES } from "./check.mjs";
import {
  HARNESS_FILES,
  HARNESS_FINGERPRINT_ALGORITHM,
} from "./harness-fingerprint.mjs";

// Synthetic validator fixtures only; never timing evidence or archived baselines.
function fixture(index = 1) {
  const timestamp = `2026-01-01T00:00:0${index}.123Z`;
  const sourceBuild = "a".repeat(64),
    sourceFingerprint = "b".repeat(64),
    method = "c".repeat(64);
  return {
    version: 1,
    status: "complete",
    provenance: "isolated-seeded-app",
    cpuSlowdown: 4,
    build: "pair-summary-unit-fixture",
    sourceBuild,
    sourceFingerprint,
    sourceFileCount: 200,
    sourceBinding: {
      method: "frozen-release-inputs-sha256",
      algorithm: "foremanhq-lab-source-v1",
      sourceBuild,
    },
    timestamp,
    protocol: { id: "unit-test-protocol" },
    harnessFingerprint: method,
    harnessFingerprintAlgorithm: HARNESS_FINGERPRINT_ALGORITHM,
    harnessFileCount: HARNESS_FILES.length,
    harnessVerification: { before: method, after: method, immutable: true },
    harnessToolchain: {
      node: "unit-node",
      browser: "unit-browser",
      playwright: "unit-driver",
    },
    health: {
      preflight: {
        status: "passed",
        build: "pair-summary-unit-fixture",
        sourceBuild,
        sourceFingerprint,
        results: READ_PREFLIGHT_PROCEDURES.map((procedure) => ({
          procedure,
          status: "ok",
        })),
      },
      fixtureSchema: {
        status: "source-declared-schemas-created",
        sourceBuild,
        sourceFingerprint,
        moduleCount: 16,
        tableCount: 113,
      },
      database: {
        count: 0,
        fatalCount: 0,
        windowStartedAt: timestamp,
        observedAt: `2026-01-01T00:00:0${index}.987Z`,
      },
    },
    static: {
      build: sourceBuild,
      sharedGzipBytes: 100,
      screenGzipBytes: 200,
      deployGzipBytes: 300,
      idlePolls: 0,
    },
    samples: budgets.journeys.flatMap((journey) =>
      Object.keys(budgets.links).flatMap((link) =>
        Array.from({ length: 15 }, (_, run) => ({
          journey,
          link,
          run,
          durationMs: 86 + run * 2,
          variant: ["openjob", "switchjobtabs", "openmateriallist"].includes(
            journey,
          )
            ? "visited"
            : "operation",
          browserMeasures: [{ name: "tap-to-paint", durationMs: run * 10 }],
        })),
      ),
    ),
  };
}
const bytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("all24 cell medians remain separate and source/time/hash metadata is exact", () => {
  const first = bytes(fixture(1)),
    second = bytes(fixture(2));
  const firstCopy = Buffer.from(first),
    secondCopy = Buffer.from(second);
  const summary = summarizePair(first, second);
  assert.equal(HARNESS_FILES.includes("perf/summarize-pair.mjs"), false);
  assert.equal(summary.cells.length, 24);
  assert.equal(summary.repeatability.passes, true);
  assert.equal(summary.cells[0].first.count, 15);
  assert.equal(summary.cells[0].first.medianMs, 100);
  assert.equal(summary.cells[0].first.p95Ms, 114);
  assert.equal(summary.cells[0].deltaMs, 0);
  assert.equal(summary.reports[0].sha256, hash(first));
  assert.equal(summary.reports[0].captureStartedAt, "2026-01-01T00:00:01.123Z");
  assert.equal(
    summary.reports[0].databaseObservedAt,
    "2026-01-01T00:00:01.987Z",
  );
  assert.equal(summary.reports[0].captureCompletedAt, null);
  assert.equal(summary.reports[0].health.preflightOk, 14);
  assert.deepEqual(first, firstCopy);
  assert.deepEqual(second, secondCopy);
});
test("failed repeatability still reports every cell and every original sample", () => {
  const second = fixture(2);
  second.samples[0].durationMs = 150;
  // Change all fifteen values in just one cell; no outlier filtering or sample selection.
  second.samples.slice(0, 15).forEach((row) => {
    row.durationMs += 20;
  });
  const summary = summarizePair(bytes(fixture(1)), bytes(second));
  assert.equal(summary.repeatability.passes, false);
  assert.equal(summary.cells.length, 24);
  assert.equal(summary.cells[0].second.count, 15);
  assert.equal(summary.cells[0].initialTimingFailure, true);
  assert.equal(summary.cells[0].second.byRun[0].durationMs, 170);
});
test("stage occurrences and missing runs are preserved without pooling or imputation", () => {
  const first = fixture(1),
    second = fixture(2);
  first.samples[0].browserMeasures.push({
    name: "tap-to-paint",
    durationMs: 90,
  });
  second.samples[0].browserMeasures = [];
  const stage = summarizePair(bytes(first), bytes(second)).cells[0]
    .browserStages[0];
  assert.equal(stage.first.distribution.count, 16);
  assert.equal(stage.second.distribution.count, 14);
  assert.deepEqual(stage.first.byRun[0].durationMs, [0, 90]);
  assert.deepEqual(stage.second.missingRuns, [0]);
});
test("rejects incomplete, self-reused and mismatched inputs through existing validation contracts", () => {
  const first = fixture(1),
    incomplete = fixture(2);
  incomplete.samples.pop();
  assert.throws(
    () => summarizePair(bytes(first), bytes(incomplete)),
    /exact full lab matrix/,
  );
  assert.throws(
    () => summarizePair(bytes(first), bytes(first)),
    /distinct independent/,
  );
  for (const key of [
    "build",
    "sourceBuild",
    "sourceFingerprint",
    "harnessFingerprint",
  ]) {
    const changed = fixture(2);
    changed[key] = "d".repeat(64);
    if (key === "build") changed.health.preflight.build = changed[key];
    if (key === "sourceBuild") {
      changed.health.preflight.sourceBuild = changed[key];
      changed.health.fixtureSchema.sourceBuild = changed[key];
      changed.sourceBinding.sourceBuild = changed[key];
      changed.static.build = changed[key];
    }
    if (key === "sourceFingerprint") {
      changed.health.preflight.sourceFingerprint = changed[key];
      changed.health.fixtureSchema.sourceFingerprint = changed[key];
    }
    if (key === "harnessFingerprint") {
      changed.harnessVerification.before = changed[key];
      changed.harnessVerification.after = changed[key];
    }
    assert.throws(
      () => summarizePair(bytes(first), bytes(changed)),
      new RegExp(`Pair differs: ${key}`),
    );
  }
  const protocol = fixture(2);
  protocol.protocol.id = "other-method";
  assert.throws(
    () => summarizePair(bytes(first), bytes(protocol)),
    /Pair differs: protocol/,
  );
  const toolchain = fixture(2);
  toolchain.harnessToolchain.browser = "other-browser";
  assert.throws(
    () => summarizePair(bytes(first), bytes(toolchain)),
    /harnessToolchain/,
  );
});
test("rejects malformed optional stage values rather than silently dropping them", () => {
  const second = fixture(2);
  second.samples[0].browserMeasures[0].durationMs = -1;
  assert.throws(
    () => summarizePair(bytes(fixture(1)), bytes(second)),
    /invalid browser stage/,
  );
});
test("CLI writes only summary stdout and leaves both raw report files byte exact", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pair-summary-unit-"));
  try {
    const first = bytes(fixture(1)),
      second = bytes(fixture(2));
    const a = path.join(dir, "first.json"),
      b = path.join(dir, "second.json");
    writeFileSync(a, first);
    writeFileSync(b, second);
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./summarize-pair.mjs", import.meta.url)), a, b],
      { encoding: "utf8" },
    );
    const summary = JSON.parse(output);
    assert.equal(summary.repeatability.passes, true);
    assert.match(summary.summaryToolSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(summary.analysisDependencyHashes).sort(), [
      "budgets.json",
      "check.mjs",
      "harness-fingerprint.mjs",
    ]);
    assert.deepEqual(readFileSync(a), first);
    assert.deepEqual(readFileSync(b), second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict dual thresholds, equality, faster variation and zero baseline stay diagnostic", () => {
  for (const [baseline, next, fails] of [
    [100, 117, false], [100, 117.001, true],
    [200, 220, false], [200, 220.001, true],
    [100, 50, false], [0, 1, false], [0, 18, true],
  ]) {
    const first = fixture(1), second = fixture(2);
    first.samples.forEach(row => { row.durationMs = baseline; });
    second.samples.forEach(row => { row.durationMs = next; });
    const summary = summarizePair(bytes(first), bytes(second));
    assert.equal(summary.repeatability.passes, !fails);
    assert.equal(summary.cells[0].initialTimingFailure, fails);
    assert.equal(summary.diagnosticOnly, true);
    assert.equal(summary.releaseEligible, false);
    assert.equal(summary.repeatability.initialScreenOnly, true);
    assert.equal(summary.repeatability.absoluteRegressionMs, 17);
    if (baseline === 0) assert.equal(summary.cells[0].deltaPercent, null);
    if (next === 50) assert.equal(summary.cells[0].relativeVariationOverTenPercent, true);
  }
});

test("current diagnostic rejects historic five-sample inputs without rewriting them", () => {
  const first = fixture(1), second = fixture(2);
  first.samples = first.samples.filter(row => row.run < 5);
  const raw = bytes(first), copy = Buffer.from(raw);
  assert.throws(() => summarizePair(raw, bytes(second)), /exact full lab matrix/);
  assert.deepEqual(raw, copy);
});
