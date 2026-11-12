#!/usr/bin/env node
// Dev only: committed-source + own checks + canonical build + health, then review.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { switchRelease } from "./activation-switch.mjs";
import { fingerprintSource } from "./source-fingerprint.mjs";
import { files } from "./static-assets.mjs";
import {
  assertDisposableWorkspace,
  assertInputSymlinks,
} from "./canonical-guards.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const fail = (m) => {
  throw Error(m);
};
const scope = [
  "src",
  "public",
  "scripts",
  "vendor",
  "next.config.js",
  "postcss.config.js",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "next-env.d.ts",
];
export function applyExactHunks(text, diff) {
  for (const chunk of diff.split(/^@@[^\n]*\n/m).slice(1)) {
    const lines = chunk.split(/(?<=\n)/),
      before = lines
        .filter((l) => l[0] === " " || l[0] === "-")
        .map((l) => l.slice(1))
        .join(""),
      after = lines
        .filter((l) => l[0] === " " || l[0] === "+")
        .map((l) => l.slice(1))
        .join("");
    if (!before) {
      if (text) fail("New file already exists");
      text = after;
      continue;
    }
    if (text.split(before).length !== 2)
      fail("Committed hunk does not match exactly once");
    text = text.replace(before, after);
  }
  return text;
}
async function inventory(root) {
  const result = {};
  async function walk(name) {
    const p = path.join(root, name);
    let s;
    try {
      s = await fs.lstat(p);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (s.isSymbolicLink()) fail("Unexpected source symlink " + name);
    if (s.isDirectory())
      for (const child of (await fs.readdir(p)).sort())
        await walk(path.join(name, child));
    else if (s.isFile()) result[name] = sha(await fs.readFile(p));
  }
  for (const n of scope) await walk(n);
  return result;
}
export async function verifyChecks(checks, fingerprint) {
  if (checks?.sourceFingerprint !== fingerprint)
    fail("Own checks source fingerprint mismatch");
  for (const kind of ["tests"]) {
    const rows = checks.results?.filter((r) => r.kind === kind);
    if (!rows?.length) fail("Missing own " + kind + " evidence");
    for (const r of rows) {
      if (
        r.exitCode !== 0 ||
        !r.command ||
        !path.isAbsolute(r.logPath ?? "") ||
        !hex(r.logSha256) ||
        sha(await fs.readFile(r.logPath)) !== r.logSha256
      )
        fail("Invalid own " + kind + " evidence");
    }
  }
}
export async function verifyOverlay({ repo, source, previous, manifest }) {
  const oldMetadata = JSON.parse(
    await fs.readFile(previous + "/release-assets.json"),
  );
  const base = await fs.realpath(manifest.baseSource);
  if (
    base !==
    (await fs.realpath(oldMetadata.sourceRoot ?? path.dirname(previous)))
  )
    fail("Manifest base is not active source");
  const old = JSON.parse(await fs.readFile(previous + "/release-assets.json"));
  const fp = await fingerprintSource(base);
  if (
    fp.sourceFingerprint !== old.sourceFingerprint ||
    fp.sourceFingerprint !== manifest.baseFingerprint
  )
    fail("Active source provenance mismatch");
  const before = await inventory(base),
    after = await inventory(source),
    reconstructed = {};
  const git = (args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  if (
    !Array.isArray(manifest.sequentialHunks) ||
    !manifest.sequentialHunks.length ||
    manifest.failures?.length
  )
    fail("Committed sequential provenance required");
  const commits = [];
  for (const step of manifest.sequentialHunks) {
    if (!/^[a-f0-9]{7,40}$/.test(step.commit ?? ""))
      fail("Explicit committed revision required");
    const commit = git(["rev-parse", step.commit + "^{commit}"]).trim();
    git(["merge-base", "--is-ancestor", commit, "tim-development"]);
    commits.push(commit);
    const target = step.targetPath;
    if (
      !Object.hasOwn(manifest.runtimePaths, target) ||
      !target.startsWith("src/") ||
      target.split("/").includes("..") ||
      /\.test\./.test(target) ||
      /(^|\/)(schema|migrations)(\/|\.)|\/worker\.(ts|js)$/.test(target)
    )
      fail("Disallowed runtime overlay path");
    if (
      step.commitPath !== target &&
      !(
        step.commitPath ===
          "src/components/materialLists/ReceivingResolveContent.tsx" &&
        target === "src/components/materialLists/ReceivingResolve.tsx"
      )
    )
      fail("Unsupported source path mapping");
    const start =
      reconstructed[target] ??
      (before[target] !== undefined
        ? await fs.readFile(base + "/" + target, "utf8")
        : "");
    const diff = git(["diff", commit + "^", commit, "--", step.commitPath]);
    if (!diff) fail("Empty committed runtime patch");
    reconstructed[target] = applyExactHunks(start, diff);
  }
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((n) => before[n] !== after[n])
    .sort();
  if (
    JSON.stringify(changed) !==
    JSON.stringify(Object.keys(manifest.runtimePaths).sort())
  )
    fail("Unreviewed source inputs differ");
  for (const [name, r] of Object.entries(manifest.runtimePaths))
    if (
      (before[name] ?? null) !== r.preimage ||
      after[name] !== r.postimage ||
      sha(Buffer.from(reconstructed[name] ?? "")) !== r.postimage
    )
      fail("Committed runtime postimage differs: " + name);
  return {
    commits: [...new Set(commits)],
    changedPaths: changed,
    ...(await publicFingerprint(source)),
  };
}
async function publicFingerprint(source) {
  const { manifest, ...fp } = await fingerprintSource(source);
  return fp;
}
export async function withDeployLock(root, run) {
  const lock = path.join(root, ".release-activation.lock");
  await fs.mkdir(lock);
  try {
    return await run();
  } finally {
    await fs.rmdir(lock);
  }
}
export async function writeReviewEntry(queue, entry) {
  const original = await fs.readFile(queue, "utf8");
  if (!original.startsWith("# ")) fail("Review queue header required");
  const marker = "<!-- DEV_DEPLOY_ENTRIES -->";
  if (
    original.indexOf(marker) < 0 ||
    original.indexOf(marker) !== original.lastIndexOf(marker)
  )
    fail("Unique review queue marker required");
  const split = original.indexOf(marker) + marker.length,
    head = original.slice(0, split),
    rest = original.slice(split);
  const clean = (s) =>
    String(s)
      .replace(/[\r\n]/g, " ")
      .replace(/`/g, "'");
  const text = `\n## ${clean(entry.at)} — ${clean(entry.agent)}\n\n- Change: ${clean(entry.summary)}\n- Commits: ${entry.commits.map(clean).join(", ")}\n- Build: \`${entry.build}\`; replaced: \`${entry.previousBuild}\`.\n- Changed JavaScript gzip bytes: ${entry.changedGzipBytes ?? "not measured"} (review metadata only).\n- Flags: worker/shared worker source=${entry.worker}; shared scripts=${entry.shared}; large change=${entry.large}.\n- Attempt record: ${clean(entry.attemptRecord ?? "not supplied")}.\n- Review status: waiting.\n\n`;
  const temp = queue + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, head + "\n" + text + rest, { flag: "wx" });
    await fs.rename(temp, queue);
  } finally {
    await fs.unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
export async function packageLikeActive(build, previous, metadata, baseSource) {
  const a = JSON.parse(
      await fs.readFile(previous + "/required-server-files.json"),
    ),
    b = JSON.parse(await fs.readFile(build + "/required-server-files.json"));
  const exists = async (p) =>
    fs.stat(p).then(
      () => true,
      () => false,
    );
  await fs.mkdir(build + "/runtime/release", { recursive: true });
  for (const name of ["start.mjs", "static-handler.mjs"])
    if (!(await exists(build + "/runtime/release/" + name)))
      await fs.copyFile(
        previous + "/runtime/release/" + name,
        build + "/runtime/release/" + name,
      );
  if (!(await exists(build + "/runtime/next.config.mjs"))) {
    if (!isDeepStrictEqual(a.config, b.config))
      fail("Runtime config differs; explicit packaging review required");
    await fs.copyFile(
      previous + "/runtime/next.config.mjs",
      build + "/runtime/next.config.mjs",
    );
  }
  const runtime = (
    await import(pathToFileURL(build + "/runtime/next.config.mjs"))
  ).default;
  const normalized = JSON.parse(JSON.stringify(runtime));
  normalized.distDir = b.config.distDir;
  if (runtime.htmlLimitedBots instanceof RegExp)
    normalized.htmlLimitedBots = runtime.htmlLimitedBots.source;
  for (const key of ["trustHostHeader", "isExperimentalCompile"])
    if (
      !Object.hasOwn(normalized.experimental, key) &&
      b.config.experimental[key] === false
    )
      normalized.experimental[key] = false;
  if (!isDeepStrictEqual(normalized, b.config))
    fail("Packaged runtime config does not match compiled config");
  // Keep candidate's own public files. Carry forward only previously packaged
  // extras absent from the old source AND candidate (e.g. catalogue images).
  for (const name of await files(previous + "/runtime/public"))
    if (
      !(await exists(build + "/runtime/public/" + name)) &&
      !(await exists(baseSource + "/public/" + name))
    ) {
      await fs.mkdir(path.dirname(build + "/runtime/public/" + name), {
        recursive: true,
      });
      await fs.copyFile(
        previous + "/runtime/public/" + name,
        build + "/runtime/public/" + name,
      );
    }
  const release = JSON.parse(await fs.readFile(build + "/release-assets.json"));
  Object.assign(release, metadata);
  await fs.writeFile(
    build + "/release-assets.json",
    JSON.stringify(release, null, 2) + "\n",
  );
  for (const name of await files(previous + "/static"))
    if (
      !(await fs.readFile(previous + "/static/" + name)).equals(
        await fs.readFile(build + "/static/" + name),
      )
    )
      fail("Immutable history differs");
  for (const name of release.currentScripts) {
    const bytes = await fs.readFile(build + "/static/" + name);
    if (
      !brotliDecompressSync(
        await fs.readFile(build + "/static/" + name + ".br"),
      ).equals(bytes) ||
      !gunzipSync(await fs.readFile(build + "/static/" + name + ".gz")).equals(
        bytes,
      )
    )
      fail("Compressed script mismatch");
  }
  return release;
}
export async function verifyRuntime(
  build,
  previous,
  baseUrl = "http://localhost:3000",
) {
  const request = async (p) => {
    const response = await fetch(baseUrl + p, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "Accept-Encoding": "identity" },
    });
    return {
      status: response.status,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  };
  let healthy = false;
  for (let n = 0; n < 20; n++) {
    try {
      if ((await request("/api/health")).status === 200) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!healthy) fail("Health check failed");
  if (
    (await request("/sign-in")).status !== 200 ||
    (await request("/api/trpc/user.getMe")).status !== 401
  )
    fail("Sign-in/protected endpoint health failed");
  const after = JSON.parse(await fs.readFile(build + "/release-assets.json")),
    before = JSON.parse(await fs.readFile(previous + "/release-assets.json"));
  const changed = after.currentScripts.filter(
    (n) => !before.currentScripts.includes(n),
  );
  for (const name of changed.length ? changed : [after.currentScripts[0]]) {
    const r = await request("/_next/static/" + name);
    if (
      r.status !== 200 ||
      !r.bytes.equals(await fs.readFile(build + "/static/" + name))
    )
      fail("Changed script HTTP bytes differ");
  }
  const sw = await request("/sw.js");
  if (
    sw.status !== 200 ||
    !sw.bytes.equals(await fs.readFile(build + "/runtime/public/sw.js"))
  )
    fail("Worker snapshot bytes differ");
  return {
    changedScriptsVerified: changed.length,
    signIn: 200,
    protected: 401,
  };
}
export async function performSwitch({
  repo,
  previous,
  build,
  restart,
  health,
  queue,
}) {
  return switchRelease({
    activeLink: repo + "/.next",
    previous,
    candidate: build,
    restart,
    checkCandidate: async () => {
      await health(build, previous);
      await queue();
    },
    checkRollback: async () => health(previous, previous),
  });
}
async function deployWithChecks(options) {
  const repo = await fs.realpath(options.repo ?? process.cwd());
  return withDeployLock(repo, async () => {
    const source = await fs.realpath(options.source),
      previous = await fs.realpath(repo + "/.next"),
      build = path.resolve(options.build);
    if (
      !path.isAbsolute(options.build) ||
      path.dirname(build) !== source ||
      build === previous ||
      build === source
    )
      fail("Fresh absolute build output required");
    const manifest = JSON.parse(await fs.readFile(options.manifest)),
      checks = JSON.parse(await fs.readFile(options.checks));
    const evidence = await verifyOverlay({ repo, source, previous, manifest });
    await verifyChecks(checks, evidence.sourceFingerprint);
    if (
      await fs.stat(source + "/PERF_LAB_ONLY").then(
        () => true,
        () => false,
      )
    )
      fail("Validation/lab source cannot deploy");
    if (process.versions.node !== "26.8.2") fail("Pinned Node26.8.2 required");
    const dependencies = await fs.realpath(source + "/node_modules");
    if (
      JSON.parse(await fs.readFile(dependencies + "/pnpm/package.json"))
        .version !== "10.11.1" ||
      !(await fs.readFile(source + "/pnpm-lock.yaml")).equals(
        await fs.readFile(dependencies + "/.pnpm/lock.yaml"),
      )
    )
      fail("Pinned dependency lock required");
    const canonical = path.join(
      process.env.HOME,
      ".cache/foremanhq-release-builder",
    );
    await assertDisposableWorkspace(canonical, {
      source,
      active: previous,
      destination: build,
      dependencies,
    });
    await assertInputSymlinks(
      canonical,
      [
        "src",
        "public",
        "scripts",
        "vendor",
        ".env",
        ".env.local",
        ".env.production",
        ".env.production.local",
      ].map((n) => path.join(source, n)),
    );
    if ((await fs.realpath(source + "/.next")) !== previous)
      fail("Candidate must retain current active build");
    const service = (...args) =>
      execFileSync("systemctl", ["--user", ...args], { encoding: "utf8" });
    const mainPid = Number(
      service("show", "foremenhq.service", "-p", "MainPID", "--value").trim(),
    );
    if (!Number.isSafeInteger(mainPid) || mainPid <= 0)
      fail("Active web service PID required");
    const environment = (
      await fs.readFile("/proc/" + mainPid + "/environ", "utf8")
    ).split("\0");
    if (!environment.includes("FOREMANHQ_BACKGROUND_MODE=separate"))
      fail("Web service must preserve separate worker mode");
    if (
      !service(
        "show",
        "foremenhq.service",
        "-p",
        "ExecStart",
        "--value",
      ).includes(".next/runtime/release/start.mjs") ||
      (await fs.realpath(
        service(
          "show",
          "foremenhq.service",
          "-p",
          "WorkingDirectory",
          "--value",
        ).trim(),
      )) !== repo
    )
      fail("Pinned runtime service required");
    const nextConfig = await fs.readFile(source + "/next.config.js", "utf8");
    if (
      !/ignoreBuildErrors:\s*false/.test(nextConfig) ||
      /ignoreBuildErrors:\s*true/.test(nextConfig)
    )
      fail("Canonical production TypeScript gate must be enabled");
    const record = build + ".processes.json";
    if (
      await fs.stat(record).then(
        () => true,
        () => false,
      )
    )
      fail("Fresh build supervisor record required");
    const child = spawnSync(
      "python3",
      [
        repo + "/perf/lab/owned-process-supervisor.py",
        "run",
        "--record",
        record,
        "--seconds",
        "900",
        "--",
        process.execPath,
        source + "/scripts/release/build.mjs",
        build,
      ],
      {
        cwd: source,
        env: { ...process.env, RELEASE_SOURCE_DIR: source },
        stdio: "inherit",
        timeout: 930000,
        killSignal: "SIGTERM",
      },
    );
    const ownership = JSON.parse(await fs.readFile(record));
    if (
      child.status !== 0 ||
      ownership.rootExitCode !== 0 ||
      ownership.timedOut ||
      ownership.familyAbsent !== true ||
      ownership.ownedIdentitiesAbsent !== true
    )
      fail("Canonical build failed; retained outputs require review");
    if (
      (await fingerprintSource(source)).sourceFingerprint !==
      evidence.sourceFingerprint
    )
      fail("Source changed during canonical build");
    const release = await packageLikeActive(
      build,
      previous,
      {
        sourceFingerprint: evidence.sourceFingerprint,
        sourceFingerprintAlgorithm: evidence.sourceFingerprintAlgorithm,
        sourceFileCount: evidence.sourceFileCount,
        sourceRoot: source,
        devOwnTestsVerified: true,
        canonicalTypeScriptPassed: true,
      },
      manifest.baseSource,
    );
    const previousBuild = (
      await fs.readFile(previous + "/BUILD_ID", "utf8")
    ).trim();
    const prior = JSON.parse(
      await fs.readFile(previous + "/release-assets.json"),
    );
    let changedGzipBytes = 0;
    for (const name of release.currentScripts)
      if (!prior.currentScripts.includes(name))
        changedGzipBytes += (await fs.stat(build + "/static/" + name + ".gz"))
          .size;
    await performSwitch({
      repo,
      previous,
      build,
      restart: () => service("restart", "foremenhq.service"),
      health: verifyRuntime,
      queue: () =>
        writeReviewEntry(repo + "/perf/REVIEW_QUEUE.md", {
          at: new Date().toISOString(),
          attemptRecord: options.attemptRecord,
          agent: options.agent,
          summary: options.summary,
          commits: evidence.commits,
          build: release.sourceHash,
          previousBuild,
          worker: evidence.changedPaths.includes(
            "src/lib/receiving-resolution.ts",
          ),
          shared: evidence.changedPaths.some(
            (n) =>
              n.startsWith("src/lib/") || n.startsWith("src/components/ui/"),
          ),
          large: changedGzipBytes >= 100000,
          changedGzipBytes,
        }),
    });
    console.log(
      JSON.stringify({
        devDeployed: true,
        build: release.sourceHash,
        sourceFingerprint: evidence.sourceFingerprint,
        reviewStatus: "waiting",
        timingGateRun: false,
        byteGateRun: false,
      }),
    );
  });
}
export async function devDeploy(options) {
  const repo = await fs.realpath(options.repo ?? process.cwd());
  const directory = path.join(repo, ".dev-deploy-attempts");
  await fs.mkdir(directory, { recursive: true });
  const attempt = path.join(
    directory,
    new Date().toISOString().replaceAll(":", "-") +
      "-" +
      randomUUID() +
      ".json",
  );
  const record = {
    agent: options.agent,
    summary: options.summary,
    source: options.source,
    build: options.build,
    startedAt: new Date().toISOString(),
    status: "running",
    reviewQueue: "perf/REVIEW_QUEUE.md",
  };
  await fs.writeFile(attempt, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
  });
  try {
    const result = await deployWithChecks({
      ...options,
      repo,
      attemptRecord: attempt,
    });
    record.status = "deployed";
    record.finishedAt = new Date().toISOString();
    await fs.writeFile(attempt, JSON.stringify(record, null, 2) + "\n");
    return result;
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.error = String(error.message).slice(0, 500);
    await fs.writeFile(attempt, JSON.stringify(record, null, 2) + "\n");
    throw error;
  }
}
if (process.argv.includes("--help")) {
  console.log(
    "Dev deploy: --source FROZEN_SOURCE --manifest COMMITTED_HUNK_MANIFEST --checks OWN_TESTS_RECEIPT --build SOURCE/.next-web --agent NAME --summary TEXT. Explicit active-based merged-hunk snapshots supported; no arbitrary full-HEAD deployment. Canonical build supplies production type check. No timing/byte gate.",
  );
  process.exit(0);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    if (i < 0 || !process.argv[i + 1]) fail("Missing " + n);
    return process.argv[i + 1];
  };
  try {
    await devDeploy({
      source: arg("--source"),
      manifest: arg("--manifest"),
      checks: arg("--checks"),
      build: arg("--build"),
      agent: arg("--agent"),
      summary: arg("--summary"),
    });
  } catch (error) {
    console.error("Dev deploy failed: " + error.message);
    process.exitCode = 1;
  }
}
