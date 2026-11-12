#!/usr/bin/env node
// Read-only preflight. Activation must call this before changing .next/service.
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { validateReport } from "../../perf/check.mjs";
import {
  evaluateCalibratedRelease,
  decodeEntry,
} from "../../perf/calibrated-policy.mjs";
import { files } from "./static-assets.mjs";
import {
  SOURCE_FINGERPRINT_ALGORITHM,
  LAB_TRANSFORM_PATHS,
} from "./source-fingerprint.mjs";

const sha = /^[a-f0-9]{64}$/;
export function validateActivationReports({
  baseline,
  repeat,
  candidate,
  baselineBuild,
  candidateBuild,
  baselineSourceFingerprint,
  candidateSourceFingerprint,
  calibration,
  reference,
  capture,
}) {
  const errors = [
    ...validateReport(baseline),
    ...validateReport(repeat),
    ...validateReport(candidate),
  ];
  try {
    if (
      JSON.stringify(decodeEntry(reference?.baseline?.report)) !==
        JSON.stringify(baseline) ||
      JSON.stringify(decodeEntry(reference?.repeat?.report)) !==
        JSON.stringify(repeat) ||
      JSON.stringify(decodeEntry(capture?.report)) !== JSON.stringify(candidate)
    )
      throw Error("Raw bound capture differs from supplied release report");
    const evaluation = evaluateCalibratedRelease(
      calibration,
      capture,
      reference,
    );
    errors.push(...evaluation.errors);
  } catch (error) {
    errors.push("Calibration/confirmation blocked: " + error.message);
  }

  for (const [label, report, expected, fingerprint] of [
    ["baseline", baseline, baselineBuild, baselineSourceFingerprint],
    ["repeat", repeat, baselineBuild, baselineSourceFingerprint],
    ["candidate", candidate, candidateBuild, candidateSourceFingerprint],
  ]) {
    // The isolated app changes auth and DB wiring, so its compiled build differs
    // from production. Require the explicitly recorded source release as well.
    if (!sha.test(expected ?? "") || report?.sourceBuild !== expected)
      errors.push(
        `${label}: measured source does not match the canonical release`,
      );
    if (
      !sha.test(fingerprint ?? "") ||
      report?.sourceFingerprint !== fingerprint
    )
      errors.push(
        `${label}: frozen source fingerprint differs from canonical release metadata`,
      );
    if (
      report?.sourceBinding?.method !== "frozen-release-inputs-sha256" ||
      report?.sourceBinding?.algorithm !== SOURCE_FINGERPRINT_ALGORITHM ||
      report?.sourceBinding?.sourceBuild !== expected
    )
      errors.push(`${label}: missing verified frozen-source binding`);
    const verification = report?.sourceVerification;
    if (
      !Number.isSafeInteger(report?.sourceFileCount) ||
      report.sourceFileCount < 1 ||
      verification?.stage !== "after-lab-transforms" ||
      !Number.isSafeInteger(verification?.unchangedFilesChecked) ||
      verification.unchangedFilesChecked <
        report.sourceFileCount - LAB_TRANSFORM_PATHS.length ||
      verification.unchangedFilesChecked > report.sourceFileCount ||
      JSON.stringify(verification.allowedLabTransforms) !==
        JSON.stringify(LAB_TRANSFORM_PATHS)
    )
      errors.push(`${label}: unchanged source-copy verification is incomplete`);
    if (report?.static?.build !== expected)
      errors.push(
        `${label}: static budgets must come from the canonical build, not auth-stubbed output`,
      );
  }
  if (baseline?.sourceFingerprint !== repeat?.sourceFingerprint)
    errors.push("Repeat capture used different frozen source inputs");
  if (
    candidate?.timestamp === baseline?.timestamp ||
    candidate?.timestamp === repeat?.timestamp
  )
    errors.push("Candidate needs its own independent capture");
  return [...new Set(errors)];
}

function assetPath(dir, name) {
  if (
    typeof name !== "string" ||
    path.isAbsolute(name) ||
    name.split(/[\\/]/).some((part) => part === ".." || part === ".")
  )
    throw Error("Invalid asset path in canonical manifest");
  return path.join(dir, "static", name);
}
export async function inspectReleaseAssets(previousDir, candidateDir) {
  const readManifest = async (dir) =>
    JSON.parse(await readFile(path.join(dir, "release-assets.json"), "utf8"));
  const before = await readManifest(previousDir),
    after = await readManifest(candidateDir);
  const oldBuild = (
    await readFile(path.join(previousDir, "BUILD_ID"), "utf8")
  ).trim();
  const newBuild = (
    await readFile(path.join(candidateDir, "BUILD_ID"), "utf8")
  ).trim();
  for (const [manifest, build] of [
    [before, oldBuild],
    [after, newBuild],
  ]) {
    if (
      manifest.builder !== "webpack" ||
      !sha.test(build) ||
      manifest.sourceHash !== build ||
      !manifest.currentScripts?.length
    )
      throw Error(
        "A canonical webpack build and matching source manifest are required",
      );
  }
  // The last active build carries the previous retained history. Compare every
  // immutable asset, not merely a sample, so an old open page cannot lose chunks.
  let retainedFiles = 0;
  for (const name of await files(path.join(previousDir, "static"))) {
    const old = await readFile(assetPath(previousDir, name));
    const next = await readFile(assetPath(candidateDir, name));
    if (!old.equals(next))
      throw Error(`Previous immutable asset changed: ${name}`);
    retainedFiles++;
  }
  const current = new Set(before.currentScripts);
  let changedGzipBytes = 0;
  for (const name of after.currentScripts) {
    const location = assetPath(candidateDir, name),
      bytes = await readFile(location);
    if (
      !brotliDecompressSync(await readFile(location + ".br")).equals(bytes) ||
      !gunzipSync(await readFile(location + ".gz")).equals(bytes)
    )
      throw Error(`Compressed bytes do not match ${name}`);
    if (!current.has(name))
      changedGzipBytes += gzipSync(bytes, { level: 9 }).length;
  }
  return {
    baselineBuild: oldBuild,
    candidateBuild: newBuild,
    baselineSourceFingerprint: before.sourceFingerprint,
    candidateSourceFingerprint: after.sourceFingerprint,
    retainedFiles,
    changedGzipBytes,
  };
}

export async function checkActivation({
  activeDir,
  candidateDir,
  baseline,
  repeat,
  candidate,
  calibration,
  reference,
  capture,
}) {
  if ((await realpath(activeDir)) === (await realpath(candidateDir)))
    throw Error("Candidate is already active");
  const assets = await inspectReleaseAssets(activeDir, candidateDir);
  const errors = validateActivationReports({
    baseline,
    repeat,
    candidate,
    calibration,
    reference,
    capture,
    ...assets,
  });
  if (candidate?.static?.deployGzipBytes !== assets.changedGzipBytes)
    errors.push(
      "Candidate deploy bytes do not match its actual changed scripts",
    );
  if (errors.length) throw Error(errors.join("\n"));
  return {
    ...assets,
    staticAndLabPass: true,
    fieldGate:
      "Separate by-build monitoring; no physical-phone or phase-completion claim.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arg = (name) => {
    const at = process.argv.indexOf(name);
    if (at < 0 || !process.argv[at + 1]) throw Error(`Missing ${name}`);
    return process.argv[at + 1];
  };
  try {
    const read = async (name) => JSON.parse(await readFile(arg(name), "utf8"));
    const result = await checkActivation({
      activeDir: arg("--active"),
      candidateDir: arg("--candidate"),
      baseline: await read("--baseline"),
      repeat: await read("--repeat"),
      candidate: await read("--report"),
      calibration: await read("--calibration"),
      reference: await read("--reference"),
      capture: await read("--capture"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Release blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
