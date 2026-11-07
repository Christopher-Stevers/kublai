// Build upstream Apache-2.0 sources, never relabel the proprietary npm artifact.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const commit = "0bb091f1719a6277921538dd1d4649a6d47eed48";
const archiveHash =
  "11725aac407987f8a2adc24e9506b69dfec6871ed37b570ebea0d027ba4fe757";
const version = "15.2.1-foremanhq.apache.20250702";
const vendor = path.join(root, "vendor/replicache");
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "foremanhq-replicache-build-"),
);
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
try {
  if (!process.env.REPLICACHE_SOURCE_ARCHIVE)
    run(
      "curl",
      [
        "-fL",
        "--max-time",
        "60",
        "-o",
        path.join(temp, "source.tar.gz"),
        `https://codeload.github.com/rocicorp/mono/tar.gz/${commit}`,
      ],
      temp,
    );
  const archive = await fs.readFile(
    process.env.REPLICACHE_SOURCE_ARCHIVE ?? path.join(temp, "source.tar.gz"),
  );
  if (createHash("sha256").update(archive).digest("hex") !== archiveHash)
    throw Error("Upstream source checksum changed");
  await fs.writeFile(path.join(temp, "source.tar.gz"), archive);
  run("tar", ["-xzf", "source.tar.gz"], temp);
  const source = path.join(temp, `mono-${commit}`);
  const pkg = path.join(source, "packages/replicache");
  const original = JSON.parse(
    await fs.readFile(path.join(pkg, "package.json"), "utf8"),
  );
  const license = await fs.readFile(path.join(source, "LICENSE"), "utf8");
  if (original.license !== "Apache-2.0" || !license.includes("Apache License"))
    throw Error("Unexpected upstream license");
  const tools = path.join(temp, "tools");
  await fs.cp(path.join(vendor, "build"), tools, { recursive: true });
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], tools);
  await fs.symlink(
    path.join(tools, "node_modules"),
    path.join(source, "node_modules"),
    "dir",
  );
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ ...original, version }, null, 2),
  );
  run(
    path.join(tools, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.build.json"],
    pkg,
  );
  run(path.join(tools, "node_modules/.bin/tsx"), ["tool/build.ts"], pkg);
  const output = path.join(temp, "package");
  await fs.mkdir(output);
  await fs.cp(path.join(pkg, "out"), path.join(output, "out"), {
    recursive: true,
  });
  await fs.rm(path.join(output, "out/tsconfig.build.tsbuildinfo"), {
    force: true,
  });
  let notice = `Replicache — Copyright Rocicorp, Inc.\nBuilt from https://github.com/rocicorp/mono/tree/${commit}\nApache License 2.0. Source archive SHA256: ${archiveHash}\nForemanHQ changed package version/build packaging only; runtime source is unmodified.\n`;
  // compare-utf8 is bundled by upstream's builder; these other packages are
  // runtime dependencies which the application also bundles for the browser.
  for (const dependency of [
    "compare-utf8",
    "@badrap/valita",
    "@rocicorp/lock",
    "@rocicorp/logger",
    "@rocicorp/resolver",
  ]) {
    const directory = path.join(tools, "node_modules", dependency);
    const filename = (await fs.readdir(directory)).find((name) =>
      /^licen[cs]e(?:\.|$)/i.test(name),
    );
    if (!filename) throw Error(`Missing license for ${dependency}`);
    notice +=
      `\n--- ${dependency} ---\n` +
      (await fs.readFile(path.join(directory, filename), "utf8")) +
      "\n";
  }
  await fs.writeFile(path.join(output, "LICENSE"), license);
  await fs.writeFile(path.join(output, "NOTICE"), notice);
  const metadata = {
    name: "replicache",
    version,
    license: "Apache-2.0",
    type: "module",
    repository: {
      type: "git",
      url: "https://github.com/rocicorp/mono.git",
      directory: "packages/replicache",
    },
    main: original.main,
    module: original.module,
    types: original.types,
    exports: original.exports,
    dependencies: {
      "@badrap/valita": "0.3.11",
      "@rocicorp/lock": "1.0.4",
      "@rocicorp/logger": "5.4.0",
      "@rocicorp/resolver": "1.0.2",
    },
    files: ["out", "LICENSE", "NOTICE"],
  };
  await fs.writeFile(
    path.join(output, "package.json"),
    JSON.stringify(metadata, null, 2),
  );
  run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", vendor],
    output,
  );
  await fs.mkdir(path.join(root, "public/licenses"), { recursive: true });
  await fs.writeFile(
    path.join(root, "public/licenses/replicache.txt"),
    notice + "\n" + license,
  );
  console.log("Built", version, "from", commit);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
