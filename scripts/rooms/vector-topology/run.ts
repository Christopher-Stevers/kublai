import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAIM_ROOT,
  LIMITS,
  SOURCE_ROOT,
  attemptId,
  fileSha,
  runtime,
  sha,
  sourcePaths,
  validateCompletion,
  validatePlan,
  verifyEmissions,
  verifyPlan,
  writeJson,
} from "./contract";
import type { Plan, WorkerReceipt } from "./contract";

const PLAN_NAME = "plan.json";

export function freeze(input: string, pageIndex: number, output: string): Plan {
  const entrySources = sourcePaths().map((path) => ({
    path,
    bytes: readFileSync(path),
  }));
  const entryRuntime = runtime();
  input = resolve(input);
  output = resolve(output);
  if (!Number.isInteger(pageIndex) || pageIndex < 0)
    throw new Error("PDF page index must be an explicit nonnegative integer");
  const p: Plan = {
    contract: "painted-path-portal-probe-v1",
    input,
    inputSha256: fileSha(input),
    pageIndex,
    output,
    sources: [],
    runtime: entryRuntime,
    limits: LIMITS,
    purpose: "portal-evidence-only",
    approvedForProduction: false,
    allSpaceScoringEligible: false,
  };
  p.sources = entrySources.map(({ path, bytes }, i) => ({
    path,
    sha256: sha(bytes),
    archive: join(output, "sources", `${String(i).padStart(3, "0")}.source`),
  }));
  validatePlan(p);
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(join(output, "sources"), { mode: 0o700 });
  for (const [i, pin] of p.sources.entries())
    writeFileSync(pin.archive, entrySources[i]!.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  const planSha = writeJson(join(output, PLAN_NAME), p);
  verifyPlan(p);
  if (fileSha(join(output, PLAN_NAME)) !== planSha)
    throw new Error("Frozen plan changed during creation");
  return p;
}

function load(path: string) {
  const p: unknown = JSON.parse(readFileSync(path, "utf8"));
  validatePlan(p);
  if (resolve(path) !== join(p.output, PLAN_NAME))
    throw new Error("Only the original plan path can run");
  verifyPlan(p);
  return p;
}

/** Metadata/raw-byte consumer. Never imports the PDF parser or reads native geometry. */
export function readCompleted(path: string) {
  const p = load(path),
    id = attemptId(p),
    planSha256 = fileSha(path);
  if (existsSync(join(CLAIM_ROOT, `${id}.failed.json`)))
    throw new Error("Failed original attempt cannot be consumed");
  const claimPath = join(CLAIM_ROOT, `${id}.claim.json`),
    donePath = join(CLAIM_ROOT, `${id}.completed.json`);
  const workerPath = join(p.output, "worker-completed.json");
  const startedPath = join(CLAIM_ROOT, `${id}.worker-started.json`);
  const pins = {
    plan: planSha256,
    claim: fileSha(claimPath),
    completed: fileSha(donePath),
    worker: fileSha(workerPath),
    started: fileSha(startedPath),
  };
  const claim = JSON.parse(readFileSync(claimPath, "utf8")) as Record<
    string,
    unknown
  >;
  const done = JSON.parse(readFileSync(donePath, "utf8")) as Record<
    string,
    unknown
  >;
  const receipt = JSON.parse(readFileSync(workerPath, "utf8")) as WorkerReceipt;
  const started = JSON.parse(readFileSync(startedPath, "utf8")) as Record<
    string,
    unknown
  >;
  validateCompletion(
    p,
    path,
    pins.plan,
    claim,
    pins.claim,
    done,
    receipt,
    pins.worker,
    started,
    pins.started,
  );
  verifyEmissions(p.output, receipt.emissions);
  verifyPlan(p);
  if (
    fileSha(path) !== pins.plan ||
    fileSha(claimPath) !== pins.claim ||
    fileSha(donePath) !== pins.completed ||
    fileSha(workerPath) !== pins.worker ||
    fileSha(startedPath) !== pins.started ||
    existsSync(join(CLAIM_ROOT, `${id}.failed.json`))
  )
    throw new Error("Completed probe lineage changed while reading");
  return done;
}

export async function worker(path: string) {
  const p = load(path);
  const id = attemptId(p),
    planSha256 = fileSha(path),
    claimPath = join(CLAIM_ROOT, `${id}.claim.json`);
  const claimSha256 = fileSha(claimPath),
    rawClaim = JSON.parse(readFileSync(claimPath, "utf8")) as Record<
      string,
      unknown
    >;
  if (
    rawClaim.id !== id ||
    rawClaim.originalPlan !== path ||
    rawClaim.planSha256 !== planSha256 ||
    rawClaim.output !== p.output ||
    rawClaim.parentPid !== process.ppid ||
    existsSync(join(CLAIM_ROOT, `${id}.failed.json`)) ||
    existsSync(join(CLAIM_ROOT, `${id}.completed.json`)) ||
    fileSha(claimPath) !== claimSha256
  )
    throw new Error("Worker requires the original live parent claim");
  const workerStartedPath = join(CLAIM_ROOT, `${id}.worker-started.json`);
  const workerStartedSha256 = writeJson(workerStartedPath, {
    id,
    originalPlan: path,
    planSha256,
    claimPath,
    claimSha256,
    parentPid: process.ppid,
    workerPid: process.pid,
  });
  const input = readFileSync(p.input);
  if (
    sha(input) !== p.inputSha256 ||
    !input.subarray(0, 1024).includes(Buffer.from("%PDF-"))
  )
    throw new Error("Invalid frozen PDF input");
  const started = performance.now();
  // Import only after every raw source/input/runtime fence has passed.
  const { extractPaintedPage } = await import("./painted-paths");
  const { detectPortals } = await import("./portals");
  const page = await extractPaintedPage(new Uint8Array(input), p.pageIndex);
  if (page.sourceSha256 !== p.inputSha256 || page.pageIndex !== p.pageIndex)
    throw new Error("Parsed source identity mismatch");
  const portals = detectPortals(page.lines, page.arcs);
  const summary = {
    contract: p.contract,
    sourceSha256: p.inputSha256,
    pageIndex: p.pageIndex,
    width: page.width,
    height: page.height,
    lines: page.lines.length,
    arcs: page.arcs.length,
    parserDiagnostics: page.diagnostics,
    portalDiagnostics: {
      preset: portals.preset,
      stats: portals.stats,
      reasonCounts: portals.reasonCounts,
    },
    supportedPortals: portals.supported.length,
    unresolvedWitnesses: portals.unresolved.length,
    distinctArcsInUnresolvedWitnesses: new Set(
      portals.unresolved.flatMap((row) => row.arcIds),
    ).size,
    seconds: (performance.now() - started) / 1000,
    geometryPeakRssMiB: process.resourceUsage().maxRSS / 1024,
    approvedForProduction: false,
    allSpaceScoringEligible: false,
    limitation:
      "Supported door evidence only; no room/envelope completeness or portal precision reference",
  };
  if (summary.geometryPeakRssMiB > LIMITS.rssMiB)
    throw new Error("Worker peak RSS budget exceeded");
  const emissions: Record<string, string> = {};
  for (const [name, value] of [
    ["painted-page.json", page],
    ["portal-evidence.json", portals],
    ["summary.json", summary],
  ] as const) {
    const bytes = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(bytes) > LIMITS.outputBytes)
      throw new Error("Private emission size budget exceeded");
    writeFileSync(join(p.output, name), bytes, { flag: "wx", mode: 0o600 });
    emissions[name] = sha(bytes);
  }
  verifyPlan(p);
  verifyEmissions(p.output, emissions);
  if (
    fileSha(path) !== planSha256 ||
    fileSha(claimPath) !== claimSha256 ||
    fileSha(workerStartedPath) !== workerStartedSha256
  )
    throw new Error("Original worker attempt changed during decode");
  const peakRssMiBAfterEmission = process.resourceUsage().maxRSS / 1024;
  if (peakRssMiBAfterEmission > LIMITS.rssMiB)
    throw new Error("Post-emission worker peak RSS budget exceeded");
  const receiptSha256 = writeJson(join(p.output, "worker-completed.json"), {
    planSha256,
    workerStartedPath,
    workerStartedSha256,
    claimSha256,
    emissions,
    peakRssMiBAfterEmission,
  });
  verifyPlan(p);
  verifyEmissions(p.output, emissions);
  if (process.resourceUsage().maxRSS / 1024 > LIMITS.rssMiB)
    throw new Error("Final worker peak RSS budget exceeded");
  if (
    fileSha(path) !== planSha256 ||
    fileSha(claimPath) !== claimSha256 ||
    fileSha(workerStartedPath) !== workerStartedSha256 ||
    fileSha(join(p.output, "worker-completed.json")) !== receiptSha256
  )
    throw new Error("Post-write worker provenance changed");
  if (process.resourceUsage().maxRSS / 1024 > LIMITS.rssMiB)
    throw new Error("Final worker peak RSS budget exceeded");
}

export async function execute(path: string) {
  const p = load(path);
  const id = attemptId(p);
  const planSha256 = fileSha(path);
  mkdirSync(CLAIM_ROOT, { recursive: true, mode: 0o700 });
  const claimPath = join(CLAIM_ROOT, `${id}.claim.json`);
  const claimSha256 = writeJson(claimPath, {
    id,
    originalPlan: path,
    planSha256,
    output: p.output,
    parentPid: process.pid,
    started: new Date().toISOString(),
  });
  const started = performance.now();
  try {
    await new Promise<void>((accept, reject) => {
      const child = spawn(
        process.execPath,
        [
          `--max-old-space-size=${LIMITS.heapMiB}`,
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "worker",
          path,
        ],
        {
          cwd: resolve(SOURCE_ROOT, "../../.."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      let timedOut = false;
      let memoryExceeded = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, LIMITS.seconds * 1000);
      // RSS includes this worker's PDF.js native/thread allocations; V8's heap cap alone does not.
      const memoryTimer = setInterval(() => {
        if (!child.pid) return;
        try {
          const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(
            readFileSync(`/proc/${child.pid}/status`, "utf8"),
          );
          if (match && Number(match[1]) / 1024 > LIMITS.rssMiB) {
            memoryExceeded = true;
            child.kill("SIGKILL");
          }
        } catch {
          /* A worker that has already exited has no /proc entry. */
        }
      }, 100);
      const keep = (part: Buffer) => {
        if (log.length < 65536)
          log += part.toString().slice(0, 65536 - log.length);
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      child.once("error", (error) => {
        clearTimeout(timer);
        clearInterval(memoryTimer);
        settled = true;
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        clearInterval(memoryTimer);
        if (settled) return;
        try {
          writeFileSync(join(p.output, "worker.log"), log, {
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          reject(error);
          return;
        }
        if (timedOut || memoryExceeded || code !== 0)
          reject(
            new Error(
              timedOut
                ? "Fixed CPU time budget exceeded"
                : memoryExceeded
                  ? "Fixed worker RSS budget exceeded"
                  : `Probe worker failed (${code ?? signal}); private log retained`,
            ),
          );
        else accept();
      });
    });
    verifyPlan(p);
    if (fileSha(path) !== planSha256 || fileSha(claimPath) !== claimSha256)
      throw new Error("Original attempt provenance changed");
    const workerReceiptPath = join(p.output, "worker-completed.json"),
      workerReceiptSha256 = fileSha(workerReceiptPath);
    const receipt = JSON.parse(
      readFileSync(workerReceiptPath, "utf8"),
    ) as WorkerReceipt;
    if (
      receipt.planSha256 !== planSha256 ||
      receipt.claimSha256 !== claimSha256 ||
      receipt.workerStartedPath !==
        join(CLAIM_ROOT, `${id}.worker-started.json`) ||
      fileSha(receipt.workerStartedPath) !== receipt.workerStartedSha256 ||
      fileSha(workerReceiptPath) !== workerReceiptSha256
    )
      throw new Error("Worker receipt plan mismatch");
    verifyEmissions(p.output, receipt.emissions);
    const completed = {
      id,
      originalPlan: path,
      planSha256,
      claimPath,
      claimSha256,
      workerReceiptSha256,
      workerStartedSha256: receipt.workerStartedSha256,
      peakRssMiBAfterEmission: receipt.peakRssMiBAfterEmission,
      emissions: receipt.emissions,
      seconds: (performance.now() - started) / 1000,
      approvedForProduction: false,
      allSpaceScoringEligible: false,
    };
    const completedSha256 = writeJson(
      join(CLAIM_ROOT, `${id}.completed.json`),
      completed,
    );
    verifyPlan(p);
    verifyEmissions(p.output, receipt.emissions);
    if (
      fileSha(path) !== planSha256 ||
      fileSha(claimPath) !== claimSha256 ||
      fileSha(workerReceiptPath) !== workerReceiptSha256 ||
      fileSha(receipt.workerStartedPath) !== receipt.workerStartedSha256 ||
      fileSha(join(CLAIM_ROOT, `${id}.completed.json`)) !== completedSha256
    )
      throw new Error("Post-write original provenance changed");
    return readCompleted(path);
  } catch (error) {
    writeJson(join(CLAIM_ROOT, `${id}.failed.json`), {
      id,
      planSha256,
      message: error instanceof Error ? error.message : "Probe failed",
      retryAllowed: false,
    });
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [mode, path, page, output] = process.argv.slice(2);
  if (mode === "freeze" && path && page && output) {
    const p = freeze(path, Number(page), output);
    console.log(
      JSON.stringify({
        plan: join(p.output, PLAN_NAME),
        inputSha256: p.inputSha256,
        sources: p.sources.length,
      }),
    );
  } else if (mode === "run" && path)
    console.log(JSON.stringify(await execute(resolve(path))));
  else if (mode === "verify" && path)
    console.log(JSON.stringify(readCompleted(resolve(path))));
  else if (mode === "worker" && path) await worker(resolve(path));
  else
    throw new Error(
      "Usage: run.ts freeze PDF ZERO_BASED_PAGE PRIVATE_NEW_OUTPUT | run ORIGINAL_PLAN | verify ORIGINAL_PLAN",
    );
}
