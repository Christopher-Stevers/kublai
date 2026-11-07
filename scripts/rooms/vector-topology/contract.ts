import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SOURCE_ROOT, "../../..");
export const CLAIM_ROOT =
  "/home/tim/datasets/foremanhq-room-detection/vector-topology-claims";
export const LIMITS = Object.freeze({
  seconds: 60,
  heapMiB: 1536,
  rssMiB: 2048,
  outputBytes: 256 * 1024 * 1024,
});
export type Pin = { path: string; sha256: string; archive: string };
export type Plan = {
  contract: "painted-path-portal-probe-v1";
  input: string;
  inputSha256: string;
  pageIndex: number;
  output: string;
  sources: Pin[];
  runtime: { node: string; pdfjs: "6.2.108"; tsx: string; lockSha256: string };
  limits: typeof LIMITS;
  purpose: "portal-evidence-only";
  approvedForProduction: false;
  allSpaceScoringEligible: false;
};
export type WorkerReceipt = {
  planSha256: string;
  claimSha256: string;
  workerStartedPath: string;
  workerStartedSha256: string;
  emissions: Record<string, string>;
  peakRssMiBAfterEmission: number;
};

export const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const fileSha = (path: string) => sha(readFileSync(path));
export function writeJson(path: string, value: unknown) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, bytes, {
    flag: "wx",
    mode: 0o600,
  });
  return sha(bytes);
}
export function sourcePaths() {
  const own = readdirSync(SOURCE_ROOT)
    .filter((name) => name.endsWith(".ts") || name === "README.md")
    .sort()
    .map((name) => join(SOURCE_ROOT, name));
  const pdf = realpathSync(join(REPO_ROOT, "node_modules/pdfjs-dist"));
  const tsx = realpathSync(join(REPO_ROOT, "node_modules/tsx"));
  return [
    ...own,
    join(pdf, "package.json"),
    join(pdf, "legacy/build/pdf.mjs"),
    join(pdf, "legacy/build/pdf.worker.mjs"),
    join(tsx, "package.json"),
  ];
}
export function runtime(): Plan["runtime"] {
  const pdf = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "node_modules/pdfjs-dist/package.json"),
      "utf8",
    ),
  ) as { version: string };
  const tsx = JSON.parse(
    readFileSync(join(REPO_ROOT, "node_modules/tsx/package.json"), "utf8"),
  ) as { version: string };
  if (pdf.version !== "6.2.108")
    throw new Error("Pinned PDF.js operator-stream version changed");
  return {
    node: process.version,
    pdfjs: pdf.version,
    tsx: tsx.version,
    lockSha256: fileSha(join(REPO_ROOT, "pnpm-lock.yaml")),
  };
}
export function validatePlan(value: unknown): asserts value is Plan {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Missing probe plan");
  const p = value as Plan;
  if (
    p.contract !== "painted-path-portal-probe-v1" ||
    p.purpose !== "portal-evidence-only" ||
    p.approvedForProduction !== false ||
    p.allSpaceScoringEligible !== false ||
    !Number.isInteger(p.pageIndex) ||
    p.pageIndex < 0 ||
    typeof p.input !== "string" ||
    resolve(p.input) !== p.input ||
    typeof p.output !== "string" ||
    resolve(p.output) !== p.output ||
    !/^[a-f0-9]{64}$/.test(p.inputSha256) ||
    JSON.stringify(p.limits) !== JSON.stringify(LIMITS) ||
    JSON.stringify(p.runtime) !== JSON.stringify(runtime()) ||
    !Array.isArray(p.sources)
  ) {
    throw new Error(
      "Probe plan must preserve fixed purpose, runtime, source and resource limits",
    );
  }
  // Check the actual existing ancestor; an outside symlink may point into a checkout.
  let ancestor = p.output;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor)
    ancestor = dirname(ancestor);
  let actual = realpathSync(ancestor);
  while (true) {
    if (existsSync(join(actual, ".git")))
      throw new Error("Private experiment outputs must stay outside Git");
    if (dirname(actual) === actual) break;
    actual = dirname(actual);
  }
  const paths = sourcePaths();
  if (
    p.sources.length !== paths.length ||
    p.sources.some(
      (pin, i) =>
        !pin ||
        pin.path !== paths[i] ||
        !/^[a-f0-9]{64}$/.test(pin.sha256) ||
        pin.archive !==
          join(p.output, "sources", `${String(i).padStart(3, "0")}.source`),
    )
  ) {
    throw new Error("Exact executable/source inventory required");
  }
}
export function verifyPlan(p: Plan) {
  validatePlan(p);
  for (const pin of p.sources) {
    if (fileSha(pin.path) !== pin.sha256 || fileSha(pin.archive) !== pin.sha256)
      throw new Error("Frozen probe source bytes changed");
  }
  if (fileSha(p.input) !== p.inputSha256)
    throw new Error("Frozen input PDF bytes changed");
}
/** Output paths and input aliases cannot buy a fresh run of the same frozen study. */
export function attemptId(p: Plan) {
  return sha(
    JSON.stringify({
      contract: p.contract,
      inputSha256: p.inputSha256,
      pageIndex: p.pageIndex,
      sources: p.sources.map((pin, index) => ({ index, sha256: pin.sha256 })),
      runtime: p.runtime,
      limits: p.limits,
      purpose: p.purpose,
    }),
  );
}
export function validateEmissionMap(emissions: Record<string, string>) {
  const names = Object.keys(emissions).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify([
      "painted-page.json",
      "portal-evidence.json",
      "summary.json",
    ])
  ) {
    throw new Error("All three exact private emissions are mandatory");
  }
  if (
    Object.values(emissions).some(
      (value) => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value),
    )
  )
    throw new Error("Every emission needs its original SHA-256");
}
export function verifyEmissions(
  output: string,
  emissions: Record<string, string>,
) {
  validateEmissionMap(emissions);
  const names = Object.keys(emissions).sort();
  for (const name of names)
    if (fileSha(join(output, name)) !== emissions[name])
      throw new Error("Probe output bytes changed");
}

export function validateCompletion(
  p: Plan,
  originalPlan: string,
  planSha256: string,
  claim: Record<string, unknown>,
  claimSha256: string,
  completed: Record<string, unknown>,
  worker: WorkerReceipt,
  workerSha256: string,
  started: Record<string, unknown>,
  startedSha256: string,
) {
  const id = attemptId(p);
  validateEmissionMap(worker.emissions);
  validateEmissionMap(completed.emissions as Record<string, string>);
  if (
    originalPlan !== join(p.output, "plan.json") ||
    claim.id !== id ||
    claim.originalPlan !== originalPlan ||
    claim.planSha256 !== planSha256 ||
    claim.output !== p.output ||
    completed.id !== id ||
    completed.originalPlan !== originalPlan ||
    completed.planSha256 !== planSha256 ||
    completed.claimPath !== join(CLAIM_ROOT, `${id}.claim.json`) ||
    completed.claimSha256 !== claimSha256 ||
    completed.workerReceiptSha256 !== workerSha256 ||
    completed.workerStartedSha256 !== startedSha256 ||
    worker.workerStartedSha256 !== startedSha256 ||
    worker.workerStartedPath !==
      join(CLAIM_ROOT, `${id}.worker-started.json`) ||
    worker.claimSha256 !== claimSha256 ||
    completed.peakRssMiBAfterEmission !== worker.peakRssMiBAfterEmission ||
    !Number.isFinite(worker.peakRssMiBAfterEmission) ||
    worker.peakRssMiBAfterEmission <= 0 ||
    worker.peakRssMiBAfterEmission > LIMITS.rssMiB ||
    started.id !== id ||
    started.originalPlan !== originalPlan ||
    started.planSha256 !== planSha256 ||
    started.claimPath !== join(CLAIM_ROOT, `${id}.claim.json`) ||
    started.claimSha256 !== claimSha256 ||
    started.parentPid !== claim.parentPid ||
    !Number.isSafeInteger(claim.parentPid) ||
    (claim.parentPid as number) <= 0 ||
    !Number.isSafeInteger(started.workerPid) ||
    (started.workerPid as number) <= 0 ||
    worker.planSha256 !== planSha256 ||
    JSON.stringify(completed.emissions) !== JSON.stringify(worker.emissions) ||
    completed.approvedForProduction !== false ||
    completed.allSpaceScoringEligible !== false ||
    typeof completed.seconds !== "number" ||
    !Number.isFinite(completed.seconds) ||
    completed.seconds < 0
  ) {
    throw new Error("Only the original complete probe lineage may be consumed");
  }
}
