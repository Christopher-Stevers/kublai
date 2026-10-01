import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLAIM_ROOT,
  REPO_ROOT,
  LIMITS,
  attemptId,
  fileSha,
  runtime,
  sourcePaths,
  validateCompletion,
  validatePlan,
  verifyEmissions,
  verifyPlan,
  writeJson,
} from "./contract";
import { worker } from "./run";
import type { Plan } from "./contract";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "room-portal-contract-"));
  const input = join(dir, "source.pdf");
  writeFileSync(input, "%PDF-1.7\nfixture-bytes-only\n");
  const output = join(dir, "private-output");
  mkdirSync(output);
  mkdirSync(join(output, "sources"));
  const p: Plan = {
    contract: "painted-path-portal-probe-v1",
    input,
    inputSha256: fileSha(input),
    pageIndex: 0,
    output,
    runtime: runtime(),
    sources: sourcePaths().map((path, i) => ({
      path,
      sha256: fileSha(path),
      archive: join(output, "sources", `${String(i).padStart(3, "0")}.source`),
    })),
    limits: LIMITS,
    purpose: "portal-evidence-only",
    approvedForProduction: false,
    allSpaceScoringEligible: false,
  };
  for (const pin of p.sources) copyFileSync(pin.path, pin.archive);
  return {
    p,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("complete frozen fixture binds all current sources, copies, runtime and input", () => {
  const f = fixture();
  try {
    verifyPlan(f.p);
  } finally {
    f.cleanup();
  }
});
test("changing output directory or copying identical PDF cannot buy another attempt", () => {
  const f = fixture();
  try {
    const alias = join(f.dir, "alias.pdf");
    copyFileSync(f.p.input, alias);
    assert.equal(
      attemptId(f.p),
      attemptId({ ...f.p, input: alias, output: join(f.dir, "other") }),
    );
    assert.notEqual(attemptId(f.p), attemptId({ ...f.p, pageIndex: 1 }));
  } finally {
    f.cleanup();
  }
});
test("late input mutation fails even when file name is retained", () => {
  const f = fixture();
  try {
    writeFileSync(f.p.input, "%PDF-1.7\nchanged\n");
    assert.throws(() => verifyPlan(f.p), /input PDF bytes/);
  } finally {
    f.cleanup();
  }
});
test("an outside symlink cannot redirect private output into a Git checkout", () => {
  const f = fixture();
  try {
    const alias = join(f.dir, "outside-alias");
    symlinkSync(REPO_ROOT, alias, "dir");
    assert.throws(
      () => validatePlan({ ...f.p, output: join(alias, "new-private-output") }),
      /outside Git/,
    );
  } finally {
    f.cleanup();
  }
});
test("late archived source substitution fails before PDF parsing", () => {
  const f = fixture();
  try {
    writeFileSync(f.p.sources[0]!.archive, "substitute");
    assert.throws(() => verifyPlan(f.p), /source bytes/);
  } finally {
    f.cleanup();
  }
});
test("missing and duplicate source pins cannot count as an exact executable inventory", () => {
  const f = fixture();
  try {
    assert.throws(
      () => validatePlan({ ...f.p, sources: f.p.sources.slice(1) }),
      /inventory/,
    );
    assert.throws(
      () =>
        validatePlan({
          ...f.p,
          sources: [f.p.sources[1], ...f.p.sources.slice(1)],
        }),
      /inventory/,
    );
  } finally {
    f.cleanup();
  }
});
test("runtime, time, heap, scoring and production policy cannot be relaxed", () => {
  const f = fixture();
  try {
    for (const p of [
      { ...f.p, runtime: { ...f.p.runtime, pdfjs: "other" } },
      { ...f.p, limits: { ...f.p.limits, seconds: 600 } },
      { ...f.p, limits: { ...f.p.limits, heapMiB: 4096 } },
      { ...f.p, approvedForProduction: true },
      { ...f.p, allSpaceScoringEligible: true },
    ]) {
      assert.throws(() => validatePlan(p), /fixed purpose/);
    }
  } finally {
    f.cleanup();
  }
});
test("invalid page and source hash are rejected before any native decode", () => {
  const f = fixture();
  try {
    for (const pageIndex of [-1, 1.1, NaN, Infinity])
      assert.throws(() => validatePlan({ ...f.p, pageIndex }));
    assert.throws(() => validatePlan({ ...f.p, inputSha256: "0" }));
  } finally {
    f.cleanup();
  }
});
test("completed emissions require every expected output and exact unchanged bytes", () => {
  const f = fixture();
  try {
    const names = ["painted-page.json", "portal-evidence.json", "summary.json"];
    for (const name of names) writeFileSync(join(f.p.output, name), "{}\n");
    const emissions = Object.fromEntries(
      names.map((name) => [name, fileSha(join(f.p.output, name))]),
    );
    verifyEmissions(f.p.output, emissions);
    assert.throws(
      () =>
        verifyEmissions(f.p.output, {
          "summary.json": emissions["summary.json"]!,
        }),
      /all three/i,
    );
    assert.throws(
      () =>
        verifyEmissions(f.p.output, { ...emissions, "unexpected.json": "0" }),
      /all three/i,
    );
    writeFileSync(join(f.p.output, "portal-evidence.json"), "changed");
    assert.throws(() => verifyEmissions(f.p.output, emissions), /output bytes/);
  } finally {
    f.cleanup();
  }
});
test("original completion joins cannot substitute attempt, source plan, claim, worker or eligibility", () => {
  const f = fixture();
  try {
    const id = attemptId(f.p),
      planPath = join(f.p.output, "plan.json"),
      planSha = "a".repeat(64),
      claimSha = "b".repeat(64),
      workerSha = "c".repeat(64),
      startedSha = "e".repeat(64);
    const worker = {
      planSha256: planSha,
      claimSha256: claimSha,
      workerStartedPath: join(CLAIM_ROOT, `${id}.worker-started.json`),
      workerStartedSha256: startedSha,
      peakRssMiBAfterEmission: 64,
      emissions: {
        "painted-page.json": "d".repeat(64),
        "portal-evidence.json": "d".repeat(64),
        "summary.json": "d".repeat(64),
      },
    };
    const claim = {
      id,
      originalPlan: planPath,
      planSha256: planSha,
      output: f.p.output,
      parentPid: 123,
    };
    const started = {
      id,
      originalPlan: planPath,
      planSha256: planSha,
      claimPath: join(CLAIM_ROOT, `${id}.claim.json`),
      claimSha256: claimSha,
      parentPid: 123,
      workerPid: 124,
    };
    const completed = {
      id,
      originalPlan: planPath,
      planSha256: planSha,
      claimPath: join(CLAIM_ROOT, `${id}.claim.json`),
      claimSha256: claimSha,
      workerReceiptSha256: workerSha,
      workerStartedSha256: startedSha,
      peakRssMiBAfterEmission: 64,
      emissions: worker.emissions,
      seconds: 1,
      approvedForProduction: false,
      allSpaceScoringEligible: false,
    };
    validateCompletion(
      f.p,
      planPath,
      planSha,
      claim,
      claimSha,
      completed,
      worker,
      workerSha,
      started,
      startedSha,
    );
    for (const change of [
      { id: "different" },
      { originalPlan: "/copied/plan.json" },
      { planSha256: "e".repeat(64) },
      { claimSha256: "e".repeat(64) },
      { workerReceiptSha256: "e".repeat(64) },
      { workerStartedSha256: "f".repeat(64) },
      { emissions: {} },
      { approvedForProduction: true },
      { allSpaceScoringEligible: true },
      { seconds: NaN },
    ]) {
      assert.throws(
        () =>
          validateCompletion(
            f.p,
            planPath,
            planSha,
            claim,
            claimSha,
            { ...completed, ...change },
            worker,
            workerSha,
            started,
            startedSha,
          ),
        /original complete|All three/,
      );
    }
    assert.throws(() =>
      validateCompletion(
        f.p,
        planPath,
        planSha,
        { ...claim, output: "/copy" },
        claimSha,
        completed,
        worker,
        workerSha,
        started,
        startedSha,
      ),
    );
  } finally {
    f.cleanup();
  }
});
test("direct worker cannot parse a frozen PDF without its original live parent claim", async () => {
  const f = fixture();
  try {
    const planPath = join(f.p.output, "plan.json");
    writeJson(planPath, f.p);
    await assert.rejects(worker(planPath), /ENOENT|original live parent claim/);
  } finally {
    f.cleanup();
  }
});
