import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { HARNESS_FILES, fingerprintHarness } from "./harness-fingerprint.mjs";
const origin =
  process.env.PERF_METHOD_TEMPLATE ??
  path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = await fs.realpath(process.env.PERF_SOURCE_ROOT ?? process.cwd());
await fs.access(path.join(source, "src/app/layout.tsx"));
const target = await fs.mkdtemp(
  path.join(os.tmpdir(), "foremanhq-perf-method-"),
);
for (const name of HARNESS_FILES) {
  await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
  if (["package.json", "tsconfig.json"].includes(name)) continue;
  await fs.copyFile(path.join(origin, name), path.join(target, name));
}
await fs.writeFile(
  path.join(target, "package.json"),
  JSON.stringify({ type: "module", private: true }),
);
await fs.writeFile(
  path.join(target, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      baseUrl: ".",
      paths: { "~/*": ["./src/*"] },
      jsx: "react-jsx",
      esModuleInterop: true,
    },
  }),
);
await fs.symlink(
  await fs.realpath(path.join(origin, "node_modules")),
  path.join(target, "node_modules"),
  "dir",
);
await fs.symlink(path.join(source, "src"), path.join(target, "src"), "dir");
const manifest = await fingerprintHarness(target);
await fs.writeFile(
  path.join(target, "harness-manifest.json"),
  JSON.stringify(
    {
      ...manifest,
      sourceScope:
        "Application source is separately bound; src/node_modules symlinks are not timing code inputs.",
    },
    null,
    2,
  ),
);
async function seal(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await seal(file);
    else await fs.chmod(file, 0o444);
  }
  await fs.chmod(directory, 0o555);
}
await seal(target);
console.log(target);
