import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS, LIMITS, ROOT, PRESET, absent, attemptId, checkEmissions, fileSha,
  freeze, load, sha, verify, writeJson } from "./profile";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const finitePid = (x: unknown) => Number.isSafeInteger(x) && (x as number) > 0;
function paths(path: string) {
  const p = load(path), id = attemptId(p), output = p.original.output;
  return { p, id, output, plan: path, claim: join(CLAIMS, `${id}.claim.json`),
    started: join(CLAIMS, `${id}.worker-started.json`), receipt: join(output, "worker-completed.json"),
    done: join(CLAIMS, `${id}.completed.json`), failed: join(CLAIMS, `${id}.failed.json`) };
}
/** Raw bytes and metadata only. Does not import or decode any native evidence. */
function receiptLineage(path: string) {
  const x = paths(path); absent(x.failed);
  const pins = { plan: fileSha(x.plan), claim: fileSha(x.claim), started: fileSha(x.started), receipt: fileSha(x.receipt) };
  const claim = json(x.claim), start = json(x.started), receipt = json(x.receipt);
  if (claim.id !== x.id || claim.originalPlan !== path || claim.planSha256 !== pins.plan ||
      claim.output !== x.output || !finitePid(claim.parentPid) || start.id !== x.id ||
      start.originalPlan !== path || start.planSha256 !== pins.plan || start.claimPath !== x.claim ||
      start.claimSha256 !== pins.claim || start.parentPid !== claim.parentPid || !finitePid(start.workerPid) ||
      receipt.planSha256 !== pins.plan || receipt.claimSha256 !== pins.claim ||
      receipt.workerStartedPath !== x.started || receipt.workerStartedSha256 !== pins.started ||
      !Number.isFinite(receipt.peakRssMiBAfterEmission) || (receipt.peakRssMiBAfterEmission as number) <= 0 ||
      (receipt.peakRssMiBAfterEmission as number) > LIMITS.rssMiB)
    throw new Error("Original compatibility attempt lineage mismatch");
  checkEmissions(x.output, receipt.emissions as Record<string, string>); verify(x.p);
  for (const [name, pin] of Object.entries(pins))
    if (fileSha(x[name as keyof typeof pins]) !== pin) throw new Error("Receipt lineage changed while checking");
  absent(x.failed);
  const expected = { id: x.id, originalPlan: path, planSha256: pins.plan, claimPath: x.claim,
    claimSha256: pins.claim, workerReceiptSha256: pins.receipt, workerStartedSha256: pins.started,
    peakRssMiBAfterEmission: receipt.peakRssMiBAfterEmission, emissions: receipt.emissions,
    approvedForProduction: false, allSpaceScoringEligible: false };
  return { x, pins, expected };
}
export function readCompleted(path: string) {
  const { x, pins, expected } = receiptLineage(path);
  const doneSha = fileSha(x.done), done = json(x.done);
  if (!Number.isFinite(done.seconds) || (done.seconds as number) < 0 ||
      Object.entries(expected).some(([key, value]) => JSON.stringify(done[key]) !== JSON.stringify(value)))
    throw new Error("Completion must join the original compatibility receipt");
  verify(x.p); checkEmissions(x.output, done.emissions as Record<string, string>);
  for (const [name, pin] of Object.entries(pins))
    if (fileSha(x[name as keyof typeof pins]) !== pin) throw new Error("Completed lineage changed");
  if (fileSha(x.done) !== doneSha) throw new Error("Completed marker changed"); absent(x.failed);
  return done;
}

export async function worker(path: string) {
  const x = paths(path), planSha = fileSha(path), claimSha = fileSha(x.claim), claim = json(x.claim);
  absent(x.failed); absent(x.done);
  if (claim.id !== x.id || claim.originalPlan !== path || claim.planSha256 !== planSha ||
      claim.output !== x.output || claim.parentPid !== process.ppid || fileSha(x.claim) !== claimSha)
    throw new Error("Worker requires the original live compatibility parent claim");
  const startedSha = writeJson(x.started, { id: x.id, originalPlan: path, planSha256: planSha,
    claimPath: x.claim, claimSha256: claimSha, parentPid: process.ppid, workerPid: process.pid });
  const bytes = readFileSync(x.p.original.input);
  if (bytes.length === 0 || bytes.length > 128 * 1024 * 1024 || sha(bytes) !== x.p.original.inputSha256 ||
      !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Frozen PDF bytes invalid");
  const before = performance.now();
  const { getDocument, version } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { parseOperatorList } = await import("../vector-topology/painted-paths");
  const { detectPortals } = await import("../vector-topology/portals");
  const { normalizeTextGlyphArguments } = await import("./normalize");
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
  let page, normalization;
  try {
    const pdf = await task.promise;
    if (x.p.original.pageIndex >= pdf.numPages) throw new Error("Page outside frozen document");
    const source = await pdf.getPage(x.p.original.pageIndex + 1), viewport = source.getViewport({ scale: 1 });
    const ops = await source.getOperatorList();
    const normalized = normalizeTextGlyphArguments(ops.fnArray, ops.argsArray);
    normalization = { preset: PRESET, sourceSha256: x.p.original.inputSha256, pageIndex: x.p.original.pageIndex,
      normalizations: normalized.normalizations, counts: normalized.counts };
    page = parseOperatorList({ sourceSha256: x.p.original.inputSha256, pageIndex: x.p.original.pageIndex,
      width: viewport.width, height: viewport.height,
      viewportTransform: Array.from(viewport.transform) as [number, number, number, number, number, number],
      fnArray: normalized.fnArray, argsArray: normalized.argsArray, pdfjsVersion: version });
  } finally { await task.destroy(); }
  const portals = detectPortals(page.lines, page.arcs);
  const summary = { contract: x.p.contract, preset: PRESET, sourceSha256: x.p.original.inputSha256,
    pageIndex: page.pageIndex, width: page.width, height: page.height, lines: page.lines.length, arcs: page.arcs.length,
    parserDiagnostics: page.diagnostics, normalizationCounts: normalization.counts,
    portalDiagnostics: { preset: portals.preset, stats: portals.stats, reasonCounts: portals.reasonCounts },
    supportedPortals: portals.supported.length, unresolvedWitnesses: portals.unresolved.length,
    seconds: (performance.now() - before) / 1000, geometryPeakRssMiB: process.resourceUsage().maxRSS / 1024,
    approvedForProduction: false, allSpaceScoringEligible: false,
    limitation: "Compatibility/portal evidence only. Unknown overpaint remains unresolved; no room completeness reference." };
  if (summary.geometryPeakRssMiB > LIMITS.rssMiB) throw new Error("Geometry peak RSS budget exceeded");
  const emissions: Record<string, string> = {};
  for (const [name, value] of [["painted-page.json", page], ["portal-evidence.json", portals],
    ["normalization.json", normalization], ["summary.json", summary]] as const) {
    const content = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(content) > LIMITS.outputBytes) throw new Error("Emission size budget exceeded");
    writeFileSync(join(x.output, name), content, { flag: "wx", mode: 0o600 }); emissions[name] = sha(content);
  }
  const fence = () => {
    verify(x.p); checkEmissions(x.output, emissions);
    if (fileSha(path) !== planSha || fileSha(x.claim) !== claimSha || fileSha(x.started) !== startedSha)
      throw new Error("Original worker provenance changed");
    absent(x.failed); absent(x.done);
    if (process.resourceUsage().maxRSS / 1024 > LIMITS.rssMiB) throw new Error("Final peak RSS budget exceeded");
  };
  fence();
  const receiptSha = writeJson(x.receipt, { planSha256: planSha, claimSha256: claimSha,
    workerStartedPath: x.started, workerStartedSha256: startedSha, emissions,
    peakRssMiBAfterEmission: process.resourceUsage().maxRSS / 1024 });
  fence();
  if (fileSha(x.receipt) !== receiptSha) throw new Error("Written receipt changed");
}

export async function execute(path: string) {
  const x = paths(path), planSha = fileSha(path); mkdirSync(CLAIMS, { recursive: true, mode: 0o700 });
  absent(x.failed); absent(x.done);
  const claimSha = writeJson(x.claim, { id: x.id, originalPlan: path, planSha256: planSha,
    output: x.output, parentPid: process.pid, started: new Date().toISOString() });
  const before = performance.now();
  try {
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${LIMITS.heapMiB}`, "--import", "tsx",
        fileURLToPath(import.meta.url), "worker", path], { cwd: resolve(ROOT, "../../.."), stdio: ["ignore", "pipe", "pipe"] });
      let log = "", time = false, memory = false, settled = false;
      const timer = setTimeout(() => { time = true; child.kill("SIGKILL"); }, LIMITS.seconds * 1000);
      const rss = setInterval(() => {
        if (!child.pid) return;
        try {
          const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(readFileSync(`/proc/${child.pid}/status`, "utf8"));
          if (match && Number(match[1]) / 1024 > LIMITS.rssMiB) { memory = true; child.kill("SIGKILL"); }
        } catch { /* Exited worker no longer has a proc entry. */ }
      }, 100);
      const keep = (part: Buffer) => { if (log.length < 65536) log += part.toString().slice(0, 65536 - log.length); };
      child.stdout.on("data", keep); child.stderr.on("data", keep);
      child.once("error", e => { clearTimeout(timer); clearInterval(rss); settled = true; reject(e); });
      child.once("close", (code, signal) => {
        clearTimeout(timer); clearInterval(rss); if (settled) return;
        try { writeFileSync(join(x.output, "worker.log"), log, { flag: "wx", mode: 0o600 }); }
        catch (e) { reject(e); return; }
        if (time || memory || code !== 0) reject(new Error(time ? "Fixed time budget exceeded" :
          memory ? "Fixed RSS budget exceeded" : `Worker failed (${code ?? signal}); private log retained`));
        else accept();
      });
    });
    if (fileSha(path) !== planSha || fileSha(x.claim) !== claimSha) throw new Error("Parent provenance changed");
    const { expected, pins } = receiptLineage(path);
    const doneSha = writeJson(x.done, { ...expected, seconds: (performance.now() - before) / 1000 });
    verify(x.p);
    for (const [name, pin] of Object.entries(pins))
      if (fileSha(x[name as keyof typeof pins]) !== pin) throw new Error("Parent final lineage changed");
    if (fileSha(x.done) !== doneSha) throw new Error("Original completion changed");
    return readCompleted(path);
  } catch (error) {
    writeJson(x.failed, { id: x.id, originalPlan: path, planSha256: planSha, claimPath: x.claim,
      claimSha256: claimSha, message: error instanceof Error ? error.message : "Study failed", retryAllowed: false });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, path, page, output, prior] = process.argv.slice(2);
  if (mode === "freeze" && path && page && output) {
    const p = freeze(path, Number(page), output, prior);
    console.log(JSON.stringify({ plan: join(p.original.output, "plan.json"), sources: p.original.sources.length + p.compatSources.length,
      priorFailure: p.priorFailure !== null, preset: p.preset }));
  } else if (mode === "run" && path) console.log(JSON.stringify(await execute(resolve(path))));
  else if (mode === "verify" && path) console.log(JSON.stringify(readCompleted(resolve(path))));
  else if (mode === "worker" && path) await worker(resolve(path));
  else throw new Error("freeze PDF ZERO_BASED_PAGE PRIVATE_NEW_OUTPUT [ORIGINAL_FAILED_PLAN] | run ORIGINAL_PLAN | verify ORIGINAL_PLAN");
}
