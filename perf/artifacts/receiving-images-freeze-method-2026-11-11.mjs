// Source-only composition; never compiles, starts an app or changes activation.
import { readFile, writeFile, mkdir, cp, realpath, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
const repo = "/home/tim/.openclaw/workspace/kublai";
const base = "/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111";
const destination = "/home/tim/.openclaw/workspace/releases/speed-phase1-receiving-images-20261111";
const { fingerprintSource } = await import(base + "/scripts/release/source-fingerprint.mjs");
const { files } = await import(base + "/scripts/release/static-assets.mjs");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const blob = (commit, name) => execFileSync("git", ["show", `${commit}:${name}`], { cwd: repo, maxBuffer: 20 * 1024 ** 2 });
const maybeBlob = (commit, name) => { try { return blob(commit, name); } catch (error) { if (error.status === 128) return null; throw error; } };
const readMaybe = async (name) => { try { return await readFile(name); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const receiving = ["src/components/materialLists/MaterialListScreen.tsx", "src/components/materialLists/SavedOrderReading.tsx", "src/hooks/use-receiving-order-read.ts", "src/lib/receiving-order-reading.ts", "src/lib/tier-one-cache-budget.ts", "src/lib/device-query-cache.ts", "src/lib/drawing-offline.ts", "src/server/api/routers/materialList.ts"];
const selected = [...receiving.map(name => ({ name, commit: "7286af50", group: "receiving" })), { name: "src/components/catalogue/PartImage.tsx", commit: "46a30bf2", group: "image-metadata" }, { name: "src/lib/part-image-layout-resource.ts", commit: "e206f3a6", group: "image-metadata" }];
const old = await fingerprintSource(base);
if (old.sourceFingerprint !== "4541b37e0ff7144287d9187384eeb9ae7ebe1c9aa88e31fcaa53cee03a8b05c7") throw Error("R19 source fingerprint mismatch");
const release = JSON.parse(await readFile(base + "/.next-web/release-assets.json", "utf8"));
if ((await readFile(base + "/.next-web/BUILD_ID", "utf8")).trim() !== release.sourceHash || release.sourceFingerprint !== old.sourceFingerprint) throw Error("R19 build binding mismatch");
const salt = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ?? (await readFile(process.env.RELEASE_KEY_FILE ?? "/home/tim/.local/share/foremanhq-release/server-actions.key", "utf8")).trim();
const buildHash = createHash("sha256"); buildHash.update(salt);
for (const directory of ["src", "public", "scripts", "vendor"]) for (const name of await files(base + "/" + directory)) { buildHash.update(directory + "/" + name + "\0"); buildHash.update(await readFile(base + "/" + directory + "/" + name)); }
for (const name of ["next.config.js", "package.json", "pnpm-lock.yaml", "tsconfig.json", "postcss.config.js", ".env", ".env.local", ".env.production", ".env.production.local"]) { buildHash.update(name + "\0"); const bytes = await readMaybe(base + "/" + name); if (bytes) buildHash.update(bytes); }
for (const name of Object.keys(process.env).filter(name => (name.startsWith("NEXT_PUBLIC_") && name !== "NEXT_PUBLIC_BUILD_ID") || ["NODE_ENV", "BROWSERSLIST"].includes(name)).sort()) buildHash.update(name + "\0" + process.env[name] + "\0");
if (buildHash.digest("hex") !== release.sourceHash) throw Error("Original R19 private build inputs/key/environment no longer match");
const changes = [];
for (const selection of selected) {
  const before = await readMaybe(base + "/" + selection.name);
  const after = blob(selection.commit, selection.name);
  const parent = maybeBlob(selection.commit + "^", selection.name);
  let compatibility = "exact selected commit parent equals R19";
  if (selection.name === "src/lib/drawing-offline.ts") {
    if (!before?.equals(blob("9ace848a^", selection.name)) || !parent?.equals(blob("9ace848a", selection.name))) throw Error("Protected snapshot prerequisite chain differs");
    compatibility = "Exact R19 equals 9ace848a parent; 9ace848a primitive postimage equals 7286af50 parent; full reviewed postimage includes both";
  } else if (selection.name === "src/components/catalogue/PartImage.tsx") {
    if (!before?.equals(blob("e206f3a6^", selection.name)) || !blob("e206f3a6", selection.name).equals(parent)) throw Error("Image correction chain differs");
    compatibility = "Exact R19 equals e206f3a6 parent; e206f3a6 postimage equals 46a30bf2 parent";
  } else if (before ? !parent?.equals(before) : parent !== null) throw Error("Unreviewed preimage: " + selection.name);
  changes.push({ path: selection.name, commit: selection.commit, group: selection.group, newFile: before === null, preimageSha256: before ? sha(before) : null, postimageSha256: sha(after), compatibility });
}
await mkdir(destination); // exclusive; never overwrite/delete an existing source.
for (const name of ["src", "public", "scripts", "vendor"]) await cp(base + "/" + name, destination + "/" + name, { recursive: true });
for (const name of ["next.config.js", "postcss.config.js", "package.json", "pnpm-lock.yaml", "tsconfig.json", "next-env.d.ts"]) await cp(base + "/" + name, destination + "/" + name);
const links = {};
for (const name of ["node_modules", ".next", ".env", ".env.local", ".env.production", ".env.production.local"]) {
  let target; try { target = await realpath(base + "/" + name); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  await symlink(target, destination + "/" + name); links[name] = target;
}
for (const selection of selected) await writeFile(destination + "/" + selection.name, blob(selection.commit, selection.name));
const current = await fingerprintSource(destination);
const oldMap = new Map(old.manifest.map(row => [row.name, row.sha256]));
const changed = current.manifest.filter(row => oldMap.get(row.name) !== row.sha256).map(row => row.name).sort();
if (JSON.stringify(changed) !== JSON.stringify(selected.map(row => row.name).sort()) || current.sourceFileCount !== old.sourceFileCount + changes.filter(row => row.newFile).length) throw Error("Unexpected source changed set");
async function fullManifest(root) {
  const names = [];
  for (const directory of ["src", "public", "scripts", "vendor"]) for (const name of await files(root + "/" + directory)) names.push(directory + "/" + name);
  names.push("next.config.js", "postcss.config.js", "package.json", "pnpm-lock.yaml", "tsconfig.json", "next-env.d.ts");
  const result = []; for (const name of names.sort()) result.push({ name, sha256: sha(await readFile(root + "/" + name)) }); return result;
}
const fullBase = await fullManifest(base), fullCurrent = await fullManifest(destination), oldFull = new Map(fullBase.map(row => [row.name, row.sha256]));
const fullChanged = fullCurrent.filter(row => oldFull.get(row.name) !== row.sha256).map(row => row.name);
if (JSON.stringify(fullChanged) !== JSON.stringify(changed) || fullBase.some(row => !fullCurrent.some(candidate => candidate.name === row.name))) throw Error("Full corpus differs outside allowlist");
const preservedR19 = ["src/hooks/use-press.ts", "src/components/ui/button.tsx", "src/components/materialLists/QuantityControls.tsx", "src/app/jobs/JobsClient.tsx"];
const sourceConfig = sha(await readFile(destination + "/next.config.js"));
const proof = {
  status: "source-only-awaiting-root-review-NO-build-authorization", sourceRoot: destination, baseSource: base,
  baseBuild: release.sourceHash, baseSourceFingerprint: old.sourceFingerprint,
  sourceFingerprint: current.sourceFingerprint, sourceFingerprintAlgorithm: current.sourceFingerprintAlgorithm, sourceFileCount: current.sourceFileCount,
  runtimeChangedPaths: changed, runtimeChangedCount: changes.length, newRuntimeFiles: changes.filter(row => row.newFile).length, changes,
  fullInputCorpus: { baseFiles: fullBase.length, files: fullCurrent.length, unchangedFiles: fullCurrent.length - changed.length, changedPaths: fullChanged, manifestSha256: sha(JSON.stringify(fullCurrent)) },
  publicFilesExact: fullCurrent.filter(row => row.name.startsWith("public/")).length,
  unchangedR19FourPaths: preservedR19.map(name => ({ path: name, sha256: oldFull.get(name), unchanged: !changed.includes(name) })),
  auditedImageJsonUnchanged: oldFull.get("src/lib/part-image-layouts.json") === fullCurrent.find(row => row.name === "src/lib/part-image-layouts.json")?.sha256,
  configSha256: sourceConfig, toolchain: release.toolchain, originalPrivateBuildFingerprintVerified: true, links,
  exclusions: ["All unrelated dirty schema/worker/PackingSlips/zoom/tsconfig", "Rolled-back notification experiment", "All new tests/docs/diagnostic methods", "No raw HEAD archive; source is exact R19 plus selected git runtime blobs"],
  buildStarted: false, appStarted: false, databaseStarted: false, timingScheduled: false, activated: false,
  pending: ["root review of exact source/proposal", "canonical byte/type build only after separate GO", "no full timing retry or activation scheduled"]
};
await writeFile(destination + "/REVIEWED_SOURCE.json", JSON.stringify({ ...proof, manifest: fullCurrent }, null, 2) + "\n");
await writeFile(repo + "/perf/artifacts/phase1-receiving-images-source-freeze-2026-11-11.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify(proof, null, 2));
