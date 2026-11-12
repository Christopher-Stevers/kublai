// Prospective fixed-B calibration. No pooling, source changes or second retry.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  PROTOCOL_ID,
  POLICY_ID,
  failingCells,
  decodeEntry,
  evaluateCalibrationProgress,
  validateCalibration,
  validateInitialCapture,
} from "./calibrated-policy.mjs";
import { sha256, fullCells } from "./capture-plan.mjs";
import { budgets, validateReport } from "./check.mjs";
export const rawEntry = (raw) => ({ raw, sha256: sha256(raw) });
export async function runCalibrationSequence({
  session,
  bundle,
  throughControl,
  runStage,
  persist,
  now = () => new Date().toISOString(),
}) {
  if (
    !/^calibration15-[A-Za-z0-9_-]+$/.test(session.sessionId) ||
    session.overallBoundMs !== 50 * 60 * 60000
  )
    throw Error("Bounded prospective session identity required");
  if (
    session.policyId !== POLICY_ID ||
    session.fullRuns !== 20 ||
    session.controls !== 19 ||
    !Number.isInteger(throughControl) ||
    throughControl < 1 ||
    throughControl > 19
  )
    throw Error(
      "Exactly20 prospective full runs required; stagedprefix1..19 only",
    );
  if (
    bundle.policyId !== POLICY_ID ||
    bundle.sessionPlanSha256 !== session.sessionPlanSha256 ||
    bundle.controls.length > throughControl ||
    bundle.status === "rejected"
  )
    throw Error("Session/resume mismatch");
  const planFor = (role, index, cells, reference, parent = null) => ({
    protocolId: PROTOCOL_ID,
    durationDefinition: "f9/v2-original-wallclock",
    captureId: session.sessionId + "-" + index,
    role,
    attemptIndex: role === "remeasure" ? 1 : 0,
    sealedAt: now(),
    sourceBuild: session.sourceBuild,
    sourceFingerprint: session.sourceFingerprint,
    build: session.build,
    harnessFingerprint: session.harnessFingerprint,
    fixturePrelude: session.fixturePrelude,
    requestedCells: cells,
    referenceBaselineSha256: reference,
    parentFullReportSha256: parent,
  });
  try {
    if (!bundle.baseline) {
      const p = planFor("baseline", "B", fullCells(budgets), null);
      bundle.baseline = await runStage(p);
      persist(bundle);
      validateInitialCapture(bundle.baseline);
    }
    // Existing raw records are validated before any resumed work; never reset B.
    {
      const progress = evaluateCalibrationProgress(bundle);
      if (progress.errors.length) throw Error(progress.errors.join("\n"));
    }
    const baseline = decodeEntry(bundle.baseline.report),
      baselineSha = bundle.baseline.report.sha256;
    for (let i = bundle.controls.length; i < throughControl; i++) {
      const capture = await runStage(
        planFor(
          "control",
          "C" + String(i + 1).padStart(2, "0"),
          fullCells(budgets),
          baselineSha,
        ),
      );
      bundle.controls.push(capture);
      persist(bundle);
      const initial = validateInitialCapture(capture, bundle.baseline);
      if (initial.errors.length) throw Error(initial.errors.join("\n"));
      const full = decodeEntry(capture.report),
        flags = initial.initialFailedCells,
        ordered = fullCells(budgets).filter((c) =>
          flags.some((f) => f.journey === c.journey && f.link === c.link),
        );
      if (ordered.length) {
        capture.confirmation = await runStage(
          planFor(
            "remeasure",
            "C" + String(i + 1).padStart(2, "0") + "-confirmation",
            ordered,
            baselineSha,
            capture.report.sha256,
          ),
        );
        persist(bundle);
      }
      const progress = evaluateCalibrationProgress(bundle);
      if (progress.errors.length) throw Error(progress.errors.join("\n"));
    }
    if (bundle.controls.length === 19) {
      bundle.status = "complete";
      const result = validateCalibration(bundle);
      if (result.errors.length) throw Error(result.errors.join("\n"));
    } else bundle.status = "incomplete";
    persist(bundle);
    return bundle;
  } catch (error) {
    bundle.status = "rejected";
    bundle.failure = { name: error.name, message: error.message };
    persist(bundle);
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const input = process.argv[2],
    expected = process.argv[3],
    through = Number(process.argv[4]);
  const raw = fs.readFileSync(input, "utf8");
  if (sha256(raw) !== expected) throw Error("Prospective session plan changed");
  const session = { ...JSON.parse(raw), sessionPlanSha256: expected };
  const root = session.outputRoot;
  if (
    !root?.startsWith("/tmp/foremanhq-calibration15-") ||
    root.split("/").includes("..") ||
    session.sourceBuild !==
      "9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0" ||
    session.sourceFingerprint !==
      "34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d" ||
    session.build !== "wTBAqKGVn-GRqajiTebMf"
  )
    throw Error("Bound prospective active-source session required");
  const harness = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const { verifyFrozenHarness } = await import("./harness-fingerprint.mjs");
  if (
    (await verifyFrozenHarness(harness)).harnessFingerprint !==
    session.harnessFingerprint
  )
    throw Error("Method changed");
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { mode: 0o700 });
    fs.writeFileSync(root + "/session-plan.json", raw, { mode: 0o444 });
  } else if (fs.readFileSync(root + "/session-plan.json", "utf8") !== raw)
    throw Error("Existing session plan differs");
  const bundleFile = root + "/calibration.json";
  const bundle = fs.existsSync(bundleFile)
    ? JSON.parse(fs.readFileSync(bundleFile))
    : {
        status: "incomplete",
        policyId: POLICY_ID,
        sessionPlanSha256: expected,
        baseline: null,
        controls: [],
        startedAt: new Date().toISOString(),
      };
  const persist = (b) => {
    const temp = bundleFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(b, null, 2) + "\n");
    fs.renameSync(temp, bundleFile);
  };
  const runStage = async (plan) => {
    if (
      Date.now() - Date.parse(bundle.startedAt) >
      session.overallBoundMs - 75 * 60000
    )
      throw Error("Insufficient remaining session bound; no new stage");
    // Strict plan timestamp ordering, not an unrecorded fixture-settling sleep.
    const prior = plan.parentFullReportSha256
      ? bundle.controls.at(-1)?.report
      : (bundle.controls.at(-1)?.confirmation?.report ??
        bundle.controls.at(-1)?.report ??
        bundle.baseline?.report);
    const priorEnd = prior
      ? Date.parse(decodeEntry(prior).health.database.observedAt)
      : 0;
    while (Date.now() <= priorEnd) await new Promise((r) => setTimeout(r, 1));
    plan.sealedAt = new Date().toISOString();
    const dir = path.join(root, plan.captureId);
    if (fs.existsSync(dir))
      throw Error("Capture output already exists; no retry/replacement");
    fs.mkdirSync(dir, { mode: 0o700 });
    const text = JSON.stringify(plan, null, 2) + "\n";
    fs.writeFileSync(dir + "/capture-plan.json", text, { mode: 0o444 });
    const env = {
      ...process.env,
      PERF_HARNESS_DIR: harness,
      PERF_SOURCE_ROOT:
        "/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112",
      PERF_SOURCE_BUILD_DIST:
        "/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112/.next-web",
      PERF_BASELINE_DIST:
        "/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a",
      PERF_REUSE_SNAPSHOT: "/tmp/foremanhq-speed-app-fxHxrn",
      PERF_SYNTHETIC_CACHE_ROOT: "/tmp/foremanhq-speed-app-5h2kmq",
      PERF_STAGE_EVIDENCE_DIR: dir,
      PERF_CAPTURE_PLAN: dir + "/capture-plan.json",
      PERF_CAPTURE_PLAN_SHA256: sha256(text),
      PERF_JOURNEY_PROTOCOL: PROTOCOL_ID,
      PERF_SHEET_PROTOCOL: "ready-then-pinch-v2",
      PERF_DIAGNOSTICS: "0",
      CHROMIUM_PATH: "/usr/bin/chromium",
      PERF_PG_ERROR_REPORT: dir + "/pg-errors.json",
    };
    for (const k of Object.keys(env))
      if (k.startsWith("PG") || k === "NODE_OPTIONS") delete env[k];
    for (const k of ["PERF_PILOT", "PERF_LINKS", "PERF_JOURNEYS", "PERF_RUNS"])
      delete env[k];
    if (bundle.baseline)
      env.PERF_FIXED_BASELINE = path.join(
        root,
        decodeEntry(bundle.baseline.plan).captureId,
        "report.json",
      );
    else delete env.PERF_FIXED_BASELINE;
    if (plan.attemptIndex === 1)
      env.PERF_PARENT_FULL_REPORT = path.join(
        root,
        decodeEntry(bundle.controls.at(-1).plan).captureId,
        "report.json",
      );
    else delete env.PERF_PARENT_FULL_REPORT;
    fs.writeFileSync(
      dir + "/effective-config.json",
      JSON.stringify(
        Object.fromEntries(
          [
            "PERF_HARNESS_DIR",
            "PERF_SOURCE_ROOT",
            "PERF_SOURCE_BUILD_DIST",
            "PERF_BASELINE_DIST",
            "PERF_REUSE_SNAPSHOT",
            "PERF_SYNTHETIC_CACHE_ROOT",
            "PERF_STAGE_EVIDENCE_DIR",
            "PERF_CAPTURE_PLAN",
            "PERF_CAPTURE_PLAN_SHA256",
            "PERF_JOURNEY_PROTOCOL",
            "PERF_SHEET_PROTOCOL",
            "PERF_DIAGNOSTICS",
            "CHROMIUM_PATH",
            "PERF_FIXED_BASELINE",
            "PERF_PARENT_FULL_REPORT",
          ]
            .filter((k) => env[k] !== undefined)
            .map((k) => [k, env[k]]),
        ),
        null,
        2,
      ) + "\n",
    );
    const storage = spawnSync(
      process.execPath,
      [harness + "/perf/lab/calibration-storage.mjs"],
      { env, encoding: "utf8", timeout: 60000 },
    );
    fs.writeFileSync(
      dir + "/storage.log",
      (storage.stdout ?? "") + (storage.stderr ?? ""),
    );
    if (storage.status !== 0) throw Error("Stage quota/probe failed before DB");
    const log = fs.openSync(dir + "/stage.log", "w");
    const child = spawnSync(
      "python3",
      [
        harness + "/perf/lab/owned-process-supervisor.py",
        "run",
        "--seconds",
        "4500",
        "--record",
        dir + "/stage-processes.json",
        "--",
        "bash",
        harness + "/perf/lab/database.sh",
        "bash",
        harness + "/perf/calibration-stage.sh",
      ],
      { env, stdio: ["ignore", log, log], timeout: 75 * 60000 + 30000 },
    );
    fs.closeSync(log);
    const final = spawnSync(
      process.execPath,
      [
        harness + "/perf/lab/calibration-finalize.mjs",
        dir,
        String(child.status ?? 1),
      ],
      { env, encoding: "utf8", timeout: 30000 },
    );
    fs.writeFileSync(
      dir + "/finalize.log",
      (final.stdout ?? "") + (final.stderr ?? ""),
    );
    if (child.status !== 0 || final.status !== 0)
      throw Error(
        "Capture stage or owned cleanup failed; preserve partials at " + dir,
      );
    const cleanup = JSON.parse(fs.readFileSync(dir + "/cleanup.json"));
    const pg = JSON.parse(fs.readFileSync(dir + "/pg-errors.json"));
    if (
      cleanup.finalExitCode !== 0 ||
      cleanup.preservationOrShutdownFailed ||
      pg.errors.length
    )
      throw Error("Capture cleanup/health failed");
    const reportRaw = fs.readFileSync(dir + "/report.json", "utf8");
    const report = JSON.parse(reportRaw);
    const errors = validateReport(report, plan.requestedCells);
    if (
      errors.length ||
      report.status !== "complete" ||
      report.measurement?.planSha256 !== sha256(text)
    )
      throw Error("Completed stage report invalid");
    return { report: rawEntry(reportRaw), plan: rawEntry(text) };
  };
  await runCalibrationSequence({
    session,
    bundle,
    throughControl: through,
    runStage,
    persist,
  });
}
