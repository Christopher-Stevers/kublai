import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export const SOURCE_FINGERPRINT_ALGORITHM = "foremanhq-lab-source-v1";
// Matches the lab copy's privacy exclusions. Production build ID additionally
// binds private build inputs; this digest never reads environment/secret files.
const excluded = new Set([
  "node_modules",
  ".git",
  ".tmp",
  ".private",
  ".open-next",
  "data",
  "uploads",
  "output",
  "state-backups",
  "backups",
  "private",
  "artifacts",
]);
async function names(root, prefix = "") {
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (
      excluded.has(entry.name) ||
      entry.name.startsWith(".env") ||
      entry.name.startsWith(".next")
    )
      continue;
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await names(root, name)));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}
export async function fingerprintSource(root) {
  const files = [];
  for (const directory of ["src", "public", "scripts", "vendor"])
    for (const name of await names(path.join(root, directory)))
      files.push(`${directory}/${name}`);
  for (const name of [
    "next.config.js",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "postcss.config.js",
  ]) {
    try {
      await readFile(path.join(root, name));
      files.push(name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  files.sort();
  const hash = createHash("sha256");
  hash.update(SOURCE_FINGERPRINT_ALGORITHM + "\0");
  const manifest = [];
  for (const name of files) {
    const bytes = await readFile(path.join(root, name));
    hash.update(name + "\0");
    hash.update(bytes);
    manifest.push({
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return {
    sourceFingerprint: hash.digest("hex"),
    sourceFingerprintAlgorithm: SOURCE_FINGERPRINT_ALGORITHM,
    sourceFileCount: files.length,
    manifest,
  };
}
export const LAB_TRANSFORM_PATHS = [
  "next.config.js",
  "tsconfig.json",
  "src/server/db/index.ts",
  "src/server/background/hints.ts",
  "src/server/background/worker.ts",
];
export async function sourceEvidence(
  sourceRoot,
  snapshot,
  sourceBuild,
  stage = "after-lab-transforms",
) {
  if (
    typeof sourceBuild !== "string" ||
    !sourceBuild.trim() ||
    sourceBuild === "unknown"
  )
    throw new Error("Explicit source release build ID required");
  const source = await fingerprintSource(sourceRoot);
  let checked = 0;
  for (const row of source.manifest) {
    if (
      stage !== "before-lab-transforms" &&
      LAB_TRANSFORM_PATHS.includes(row.name)
    )
      continue;
    const actual = createHash("sha256")
      .update(await readFile(path.join(snapshot, row.name)))
      .digest("hex");
    if (actual !== row.sha256)
      throw new Error(
        `Lab source differs outside declared transforms: ${row.name}`,
      );
    checked++;
  }
  return {
    sourceBuild: sourceBuild.trim(),
    sourceFingerprint: source.sourceFingerprint,
    sourceFingerprintAlgorithm: source.sourceFingerprintAlgorithm,
    sourceFileCount: source.sourceFileCount,
    sourceVerification: {
      stage,
      unchangedFilesChecked: checked,
      allowedLabTransforms: LAB_TRANSFORM_PATHS,
      additionalLabRoute: "src/app/api/perf-lab/route.ts",
      scope:
        "src/public/scripts/vendor and named build configs, excluding env/private/data/uploads/build output directories; not the production build private salted hash",
    },
    sourceBinding: {
      method: "frozen-release-inputs-sha256",
      algorithm: SOURCE_FINGERPRINT_ALGORITHM,
      sourceBuild: sourceBuild.trim(),
      scope:
        "Copied public release inputs: src/public/scripts/vendor plus next.config.js/package.json/pnpm-lock.yaml/tsconfig.json/postcss.config.js; excludes env/private/data/uploads/build outputs. Production build ID separately binds private build inputs.",
    },
    authentication: "stubbed-seeded-user",
  };
}
