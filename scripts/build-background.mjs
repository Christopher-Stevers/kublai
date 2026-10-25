import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const target = process.argv[2];
if (!target || !path.isAbsolute(target))
  throw Error("Supply an absolute release output directory");
await fs.mkdir(target, { recursive: true });
const entries = [
  "background/worker",
  "rooms/detect-worker",
  "super-scale/worker",
  "job-systems/extract-worker",
  "packing-slips/extract-worker",
  "drawings/equipment-index-worker",
];
await build({
  entryPoints: entries.map((x) => "src/server/" + x + ".ts"),
  outbase: "src",
  outdir: target,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  outExtension: { ".js": ".mjs" },
  tsconfig: "tsconfig.json",
  banner: {
    js: 'import { createRequire as _createRequire } from "node:module"; const require = _createRequire(import.meta.url);',
  },
});
await fs.mkdir(path.join(target, "scripts"), { recursive: true });
await fs.copyFile(
  "scripts/run-detect-worker.sh",
  path.join(target, "scripts/run-detect-worker.sh"),
);
await fs.chmod(path.join(target, "scripts/run-detect-worker.sh"), 0o755);
await fs.writeFile(
  path.join(target, "release.json"),
  JSON.stringify(
    {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      entries,
    },
    null,
    2,
  ),
);
