import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
// Deliberately generates a separate source tree: no auth bypass is added to the real app.
const source = process.cwd();
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
    "--exclude=data/perf",
    "--exclude=perf/fixtures.json",
    `${source}/`,
    `${target}/`,
  ],
  { stdio: "inherit" },
);
fs.symlinkSync(
  path.join(source, "node_modules"),
  path.join(target, "node_modules"),
  "dir",
);
const configPath = path.join(target, "next.config.js");
let config = fs.readFileSync(configPath, "utf8");
if (!config.includes("const config = {"))
  throw new Error("Unknown Next config; refusing auth alias injection");
config = config.replace(
  "const config = {",
  `const config = {
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias,
      '@clerk/nextjs/server$': ${JSON.stringify(path.join(target, "perf/auth/clerk-server.mjs"))},
      '@clerk/nextjs$': ${JSON.stringify(path.join(target, "perf/auth/clerk-client.jsx"))}
    };
    return config;
  },`,
);
fs.writeFileSync(
  configPath,
  `process.env.DATABASE_URL = ${JSON.stringify(rawDatabase)};\n` + config,
);
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
const tsconfig = JSON.parse(
  fs.readFileSync(path.join(target, "tsconfig.json"), "utf8"),
);
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
  "Isolated app: Clerk authentication and its bytes/timing are stubbed. Never deploy this snapshot.\n",
);
console.log(target);
