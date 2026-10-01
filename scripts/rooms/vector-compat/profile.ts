/** Separate compatibility study: the executed v1 sources stay immutable. */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAIM_ROOT, LIMITS, attemptId as originalId, fileSha, runtime, sha, sourcePaths,
  validatePlan as validateOriginal, verifyPlan as verifyOriginal, writeJson,
} from "../vector-topology/contract";
import type { Pin, Plan as OriginalPlan } from "../vector-topology/contract";

export { LIMITS, fileSha, sha, writeJson };
export const ROOT = dirname(fileURLToPath(import.meta.url));
export const CLAIMS = "/home/tim/datasets/foremanhq-room-detection/vector-compat-claims";
export const PRESET = "pdfjs-6.2.108-optional-text-glyph-undefined-v1";
export type PriorFailure = { plan: string; planSha256: string; marker: string; markerSha256: string };
export type Plan = {
  contract: "painted-path-compatibility-probe-v1";
  preset: typeof PRESET;
  original: OriginalPlan;
  compatSources: Pin[];
  priorFailure: PriorFailure | null;
};
export const ownPaths = () => readdirSync(ROOT)
  .filter(n => n.endsWith(".ts") || n === "README.md").sort().map(n => join(ROOT, n));
export function validate(p: Plan) {
  if (!p || p.contract !== "painted-path-compatibility-probe-v1" || p.preset !== PRESET)
    throw new Error("Exact compatibility profile required");
  validateOriginal(p.original);
  const paths = ownPaths();
  if (!Array.isArray(p.compatSources) || p.compatSources.length !== paths.length ||
      p.compatSources.some((pin, i) => pin.path !== paths[i] || !/^[a-f0-9]{64}$/.test(pin.sha256) ||
        pin.archive !== join(p.original.output, "sources", `${String(i + p.original.sources.length).padStart(3, "0")}.source`)))
    throw new Error("Exact compatibility source inventory required");
  if (p.priorFailure !== null) {
    const f = p.priorFailure;
    if (!f || resolve(f.plan) !== f.plan || resolve(f.marker) !== f.marker ||
        !/^[a-f0-9]{64}$/.test(f.planSha256) || !/^[a-f0-9]{64}$/.test(f.markerSha256))
      throw new Error("Prior failure requires original raw pins");
    const old = JSON.parse(readFileSync(f.plan, "utf8")) as OriginalPlan;
    verifyOriginal(old);
    const marker = JSON.parse(readFileSync(f.marker, "utf8")) as Record<string, unknown>;
    if (resolve(f.plan) !== join(old.output, "plan.json") || old.inputSha256 !== p.original.inputSha256 ||
        old.pageIndex !== p.original.pageIndex || marker.id !== originalId(old) ||
        marker.planSha256 !== f.planSha256 || marker.retryAllowed !== false ||
        f.marker !== join(CLAIM_ROOT, `${originalId(old)}.failed.json`) ||
        JSON.stringify(old.sources.map(x => x.sha256)) !== JSON.stringify(p.original.sources.map(x => x.sha256)))
      throw new Error("Compatibility pass must retain the same failed producer and input");
  }
}
export function verify(p: Plan) {
  validate(p); verifyOriginal(p.original);
  for (const pin of p.compatSources)
    if (fileSha(pin.path) !== pin.sha256 || fileSha(pin.archive) !== pin.sha256)
      throw new Error("Frozen compatibility source changed");
  if (p.priorFailure && (fileSha(p.priorFailure.plan) !== p.priorFailure.planSha256 ||
      fileSha(p.priorFailure.marker) !== p.priorFailure.markerSha256))
    throw new Error("Original failed study changed");
}
export const attemptId = (p: Plan) => sha(JSON.stringify({ contract: p.contract, preset: p.preset,
  original: originalId(p.original), compat: p.compatSources.map((x, index) => ({ index, sha256: x.sha256 })),
}));
export function freeze(input: string, pageIndex: number, output: string, priorPlan?: string): Plan {
  const oldSources = sourcePaths().map(path => ({ path, bytes: readFileSync(path) }));
  const compat = ownPaths().map(path => ({ path, bytes: readFileSync(path) }));
  const entryRuntime = runtime();
  output = resolve(output); input = resolve(input);
  const pin = (row: {path: string; bytes: Buffer}, i: number): Pin => ({ path: row.path,
    sha256: sha(row.bytes), archive: join(output, "sources", `${String(i).padStart(3, "0")}.source`) });
  let priorFailure: PriorFailure | null = null;
  if (priorPlan) {
    priorPlan = resolve(priorPlan);
    const old = JSON.parse(readFileSync(priorPlan, "utf8")) as OriginalPlan;
    verifyOriginal(old);
    const marker = join(CLAIM_ROOT, `${originalId(old)}.failed.json`);
    priorFailure = { plan: priorPlan, planSha256: fileSha(priorPlan), marker, markerSha256: fileSha(marker) };
  }
  const p: Plan = { contract: "painted-path-compatibility-probe-v1", preset: PRESET,
    original: { contract: "painted-path-portal-probe-v1", input, inputSha256: fileSha(input), pageIndex,
      output, sources: oldSources.map(pin), runtime: entryRuntime, limits: LIMITS,
      purpose: "portal-evidence-only", approvedForProduction: false, allSpaceScoringEligible: false },
    compatSources: compat.map((row, i) => pin(row, i + oldSources.length)), priorFailure };
  validate(p);
  mkdirSync(output, { mode: 0o700 }); mkdirSync(join(output, "sources"), { mode: 0o700 });
  [...oldSources, ...compat].forEach((row, i) => writeFileSync(
    join(output, "sources", `${String(i).padStart(3, "0")}.source`), row.bytes, { flag: "wx", mode: 0o600 }));
  const planSha = writeJson(join(output, "plan.json"), p);
  verify(p);
  if (fileSha(join(output, "plan.json")) !== planSha) throw new Error("Plan changed at freeze");
  return p;
}
export function load(path: string): Plan {
  const p = JSON.parse(readFileSync(path, "utf8")) as Plan;
  verify(p);
  if (resolve(path) !== join(p.original.output, "plan.json")) throw new Error("Original plan path required");
  return p;
}
export function checkEmissions(output: string, emissions: Record<string, string>) {
  if (!emissions || JSON.stringify(Object.keys(emissions).sort()) !== JSON.stringify([
    "normalization.json", "painted-page.json", "portal-evidence.json", "summary.json",
  ])) throw new Error("Four exact emissions required");
  for (const [name, digest] of Object.entries(emissions))
    if (!/^[a-f0-9]{64}$/.test(digest) || fileSha(join(output, name)) !== digest)
      throw new Error("Original emission bytes changed");
}
export const absent = (path: string) => { if (existsSync(path)) throw new Error("Attempt already completed or failed"); };
