import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLAIMS, attemptId, checkEmissions, fileSha, freeze, load, validate, verify, writeJson } from "./profile";
import { readCompleted } from "./run";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vector-compat-test-"));
  const input = join(root, "fixture.pdf"); writeFileSync(input, `%PDF-1.4\n%fabricated metadata-only ${root}\n`);
  const output = join(root, "output"), p = freeze(input, 0, output), plan = join(output, "plan.json");
  return { root, input, output, p, plan, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
test("profile pins all old and new source bytes before decode", () => {
  const f = fixture(); try {
    verify(f.p); assert.ok(f.p.original.sources.length >= 15); assert.ok(f.p.compatSources.length >= 5);
    assert.equal(f.p.priorFailure, null); assert.deepEqual(load(f.plan), f.p);
    for (const pin of [...f.p.original.sources, ...f.p.compatSources]) assert.equal(fileSha(pin.archive), pin.sha256);
  } finally { f.dispose(); }
});
test("aliases and optional previous-failure metadata cannot reset the compatibility identity", () => {
  const f = fixture(); try {
    const p = structuredClone(f.p); p.original.input = "/private/alias.pdf"; p.original.output = "/private/alias-output";
    p.priorFailure = { plan: "/fake/plan", planSha256: "a".repeat(64), marker: "/fake/marker", markerSha256: "b".repeat(64) };
    assert.equal(attemptId(p), attemptId(f.p));
    p.compatSources[0]!.sha256 = "c".repeat(64); assert.notEqual(attemptId(p), attemptId(f.p));
  } finally { f.dispose(); }
});
test("changed limits, profile or incomplete source inventory fail", () => {
  const f = fixture(); try {
    const p = structuredClone(f.p); (p.original.limits as { seconds: number }).seconds = 61; assert.throws(() => validate(p));
    const q = structuredClone(f.p); q.compatSources.pop(); assert.throws(() => validate(q));
    assert.throws(() => validate({ ...f.p, preset: "unknown" } as unknown as typeof f.p));
  } finally { f.dispose(); }
});
test("archive/input changes and copied plan paths are rejected", () => {
  const f = fixture(); try {
    const archive = f.p.compatSources[0]!.archive, original = readFileSync(archive);
    writeFileSync(archive, "changed"); assert.throws(() => verify(f.p)); writeFileSync(archive, original);
    writeFileSync(f.input, "changed"); assert.throws(() => load(f.plan));
  } finally { f.dispose(); }
  const g = fixture(); try {
    const alias = join(g.root, "plan-copy.json"); writeFileSync(alias, readFileSync(g.plan)); assert.throws(() => load(alias));
  } finally { g.dispose(); }
});
test("original four serialized emissions required; modified bytes cannot be rebaselined", () => {
  const f = fixture(); try {
    const emissions: Record<string, string> = {};
    for (const name of ["normalization.json", "painted-page.json", "portal-evidence.json", "summary.json"])
      emissions[name] = writeJson(join(f.output, name), { fabricated: true });
    checkEmissions(f.output, emissions);
    assert.throws(() => checkEmissions(f.output, { ...emissions, extra: "a".repeat(64) }));
    writeFileSync(join(f.output, "painted-page.json"), "changed"); assert.throws(() => checkEmissions(f.output, emissions));
  } finally { f.dispose(); }
});
test("metadata consumer joins all original receipts and blocks spent failures and false promotion", () => {
  const f = fixture(), id = attemptId(f.p); mkdirSync(CLAIMS, { recursive: true });
  const claim = join(CLAIMS, `${id}.claim.json`), started = join(CLAIMS, `${id}.worker-started.json`),
    done = join(CLAIMS, `${id}.completed.json`), failed = join(CLAIMS, `${id}.failed.json`);
  try {
    const planSha = fileSha(f.plan), claimSha = writeJson(claim, { id, originalPlan: f.plan, planSha256: planSha,
      output: f.output, parentPid: 1 });
    const startSha = writeJson(started, { id, originalPlan: f.plan, planSha256: planSha, claimPath: claim,
      claimSha256: claimSha, parentPid: 1, workerPid: 2 });
    const emissions: Record<string, string> = {};
    for (const name of ["normalization.json", "painted-page.json", "portal-evidence.json", "summary.json"])
      emissions[name] = writeJson(join(f.output, name), { fabricated: true });
    const receiptSha = writeJson(join(f.output, "worker-completed.json"), { planSha256: planSha, claimSha256: claimSha,
      workerStartedPath: started, workerStartedSha256: startSha, emissions, peakRssMiBAfterEmission: 10 });
    const completion = { id, originalPlan: f.plan, planSha256: planSha, claimPath: claim, claimSha256: claimSha,
      workerReceiptSha256: receiptSha, workerStartedSha256: startSha, emissions, peakRssMiBAfterEmission: 10,
      approvedForProduction: false, allSpaceScoringEligible: false, seconds: 1 };
    writeJson(done, completion); assert.deepEqual(readCompleted(f.plan), completion);
    writeFileSync(done, JSON.stringify({ ...completion, approvedForProduction: true })); assert.throws(() => readCompleted(f.plan));
    writeFileSync(done, JSON.stringify(completion)); writeJson(failed, { retryAllowed: false }); assert.throws(() => readCompleted(f.plan));
  } finally {
    for (const path of [claim, started, done, failed]) rmSync(path, { force: true }); f.dispose();
  }
});
