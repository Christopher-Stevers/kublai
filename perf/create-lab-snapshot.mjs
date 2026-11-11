import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceEvidence } from "../scripts/release/source-fingerprint.mjs";
// Deliberately generates a separate source tree: no auth bypass is added to the real app.
const source = path.resolve(process.env.PERF_SOURCE_ROOT ?? process.cwd());
const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
if (
  !fs.existsSync(path.join(source, "next.config.js")) ||
  !fs.existsSync(path.join(source, "src/app/layout.tsx"))
)
  throw new Error(
    "PERF_SOURCE_ROOT must contain a complete application source tree",
  );
const rawDatabase = process.env.PERF_LAB_DATABASE_URL;
if (!rawDatabase)
  throw new Error(
    "PERF_LAB_DATABASE_URL is required; never inherit DATABASE_URL",
  );
const database = new URL(rawDatabase);
const socket = database.searchParams.get("host");
if (
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  database.pathname !== "/foremanhq_perf_lab" ||
  !socket ||
  !socket.startsWith("/tmp/foremanhq-perf-pg.") ||
  !fs.existsSync(path.join(socket, ".s.PGSQL.55463"))
)
  throw new Error(
    "Expected disposable /tmp/foremanhq-perf-pg.* socket on 55463 and foremanhq_perf_lab database",
  );
const target = fs.mkdtempSync(path.join(os.tmpdir(), "foremanhq-speed-app-"));
execFileSync(
  "rsync",
  [
    "-a",
    "--exclude=node_modules",
    "--exclude=.git",
    "--exclude=.next*",
    "--exclude=.open-next",
    "--exclude=.env*",
    "--exclude=output",
    "--exclude=data",
    "--exclude=uploads",
    "--exclude=.tmp",
    "--exclude=.private",
    "--exclude=private",
    "--exclude=state-backups",
    "--exclude=backups",
    "--exclude=artifacts",
    "--include=/src/***",
    "--include=/public/***",
    "--include=/scripts/***",
    "--include=/vendor/***",
    "--include=/next.config.js",
    "--include=/package.json",
    "--include=/pnpm-lock.yaml",
    "--include=/tsconfig.json",
    "--include=/postcss.config.js",
    "--include=/next-env.d.ts",
    "--exclude=*",
    `${source}/`,
    `${target}/`,
  ],
  { stdio: "inherit" },
);
const sourceBuildDir = process.env.PERF_SOURCE_BUILD_DIST;
if (!sourceBuildDir)
  throw new Error(
    "PERF_SOURCE_BUILD_DIST (actual release build directory) is required for source binding",
  );
const preTransformEvidence = await sourceEvidence(
  source,
  target,
  fs.readFileSync(path.join(sourceBuildDir, "BUILD_ID"), "utf8").trim(),
  "before-lab-transforms",
);
fs.writeFileSync(
  path.join(target, "source-evidence.json"),
  JSON.stringify(preTransformEvidence, null, 2),
);
const safeHarnessNames = new Set([
  "auth",
  "lab",
  "budgets.json",
  "check.mjs",
  "run.mjs",
  "journeys.mjs",
  "idle.mjs",
  "summarize.mjs",
  "reference-device.json",
  "preflight.mjs",
]);
fs.cpSync(harnessRoot, path.join(target, "perf"), {
  recursive: true,
  filter: (filename) => {
    const relative = path.relative(harnessRoot, filename);
    if (!relative) return true;
    const parts = relative.split(path.sep);
    return (
      safeHarnessNames.has(parts[0]) &&
      !parts.some(
        (part) =>
          ["private", "artifacts", "output", "state-backups"].includes(part) ||
          part.startsWith(".env"),
      )
    );
  },
});
// The attested timing tree stays sealed. Its generated app-copy directory must
// accept the synthetic fixture file even when copied from a read-only method.
fs.chmodSync(path.join(target, "perf"), 0o700);
fs.symlinkSync(
  path.join(path.dirname(harnessRoot), "node_modules"),
  path.join(target, "node_modules"),
  "dir",
);
// postgres-js does not interpret pg's URL socket query: replace all runtime
// application connection constructors in the isolated copy with explicit options.
const connectionOptions = `{ host: __perfLabSocket, port: 55463, database: "foremanhq_perf_lab" }`;
for (const relative of [
  "src/server/db/index.ts",
  "src/server/background/hints.ts",
  "src/server/background/worker.ts",
]) {
  const filename = path.join(target, relative);
  let code = fs.readFileSync(filename, "utf8");
  code = code
    .replaceAll("postgres(env.DATABASE_URL)", `postgres(${connectionOptions})`)
    .replaceAll(
      "postgres(process.env.DATABASE_URL!, {",
      `postgres({ ...${connectionOptions},`,
    );
  if (
    code.includes("postgres(env.DATABASE_URL") ||
    code.includes("postgres(process.env.DATABASE_URL")
  )
    throw new Error(`Unpatched database constructor: ${relative}`);
  code =
    `const __perfLabSocket = process.env.PERF_LAB_SOCKET;
if (!__perfLabSocket?.startsWith("/tmp/foremanhq-perf-pg.")) throw new Error("Private lab socket is required");
` + code;
  fs.writeFileSync(filename, code);
}
const configPath = path.join(target, "next.config.js");
let config = fs.readFileSync(configPath, "utf8");
if (!config.includes("export default config;"))
  throw new Error("Unknown Next config; refusing auth alias injection");
config = config.replace(
  "export default config;",
  () => `
const applicationWebpack = config.webpack;
config.webpack = (webpackConfig, options) => {
  const result = applicationWebpack ? applicationWebpack(webpackConfig, options) : webpackConfig;
  result.resolve.alias = { ...result.resolve.alias,
    '@clerk/nextjs/server$': ${JSON.stringify(path.join(target, "perf/auth/clerk-server.mjs"))},
    '@clerk/nextjs$': ${JSON.stringify(path.join(target, "perf/auth/clerk-client.jsx"))}
  };
  return result;
};
export default config;`,
);
fs.writeFileSync(
  configPath,
  `import { existsSync as labSocketExists } from "node:fs";
const labDatabase = new URL(process.env.PERF_LAB_DATABASE_URL ?? "http://invalid");
const labSocket = labDatabase.searchParams.get("host");
if (labDatabase.pathname !== "/foremanhq_perf_lab" || !labSocket?.startsWith("/tmp/foremanhq-perf-pg.") || !labSocketExists(labSocket + "/.s.PGSQL.55463")) throw new Error("Private disposable lab database required at runtime");
process.env.PERF_LAB_SOCKET = labSocket;
process.env.DATABASE_URL = process.env.PERF_LAB_DATABASE_URL;
process.env.FOREMANHQ_BACKGROUND_MODE = "separate";
process.env.BIM_WORKER_DISABLED = "1";
` + config,
);
execFileSync(process.execPath, ["--check", configPath], { stdio: "inherit" });
if (process.env.PERF_LAB_FIXTURES)
  fs.copyFileSync(
    process.env.PERF_LAB_FIXTURES,
    path.join(target, "perf/fixtures.json"),
  );
if (process.env.PERF_LAB_ASSETS)
  execFileSync(
    "rsync",
    ["-a", `${process.env.PERF_LAB_ASSETS}/`, `${target}/`],
    { stdio: "inherit" },
  );
const route = path.join(target, "src/app/api/perf-lab");
fs.mkdirSync(route, { recursive: true });
fs.writeFileSync(
  path.join(route, "route.ts"),
  `export async function GET(){return Response.json({provenance:'isolated-seeded-app',productionDatabase:false,authentication:'stubbed-seeded-user',userId:'perf-lab-user'},{headers:{'Cache-Control':'no-store'}});}`,
);
// Avoid generated directories in the shared user's tsconfig, which can be dirty.
const parsedConfig = ts.parseConfigFileTextToJson(
  "tsconfig.json",
  fs.readFileSync(path.join(target, "tsconfig.json"), "utf8"),
);
if (parsedConfig.error) throw new Error("Cannot parse snapshot tsconfig");
const tsconfig = parsedConfig.config;
tsconfig.include = [
  "next-env.d.ts",
  "src/**/*.ts",
  "src/**/*.tsx",
  ".next/types/**/*.ts",
];
tsconfig.exclude = ["node_modules"];
fs.writeFileSync(
  path.join(target, "tsconfig.json"),
  JSON.stringify(tsconfig, null, 2),
);
fs.writeFileSync(
  path.join(target, "PERF_LAB_ONLY"),
  `Isolated app copied from ${source}. Clerk authentication and its bytes/timing are stubbed. Never deploy this snapshot.\n`,
);
const finalEvidence = await sourceEvidence(
  source,
  target,
  preTransformEvidence.sourceBuild,
  "after-lab-transforms",
);
finalEvidence.sourceVerification.preTransformUnchangedFilesChecked =
  preTransformEvidence.sourceVerification.unchangedFilesChecked;
fs.writeFileSync(
  path.join(target, "source-evidence.json"),
  JSON.stringify(finalEvidence, null, 2),
);
console.log(target);
