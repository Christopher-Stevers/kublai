// @vitest-environment node
import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

type Compiler = { close: (callback: (error?: Error) => void) => void };
type Stats = { hasErrors: () => boolean; toString: () => string };
type Webpack = (
  config: unknown,
  callback: (error: Error | null, stats?: Stats) => void,
) => Compiler;

it("production webpack keeps native version resolution and rejects unsupported package metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "listen-lifecycle-webpack-"));
  const require = createRequire(import.meta.url);
  const { webpack } = require("next/dist/compiled/webpack/webpack") as {
    webpack: Webpack;
  };
  const source = await readFile(
    new URL("./listen-lifecycle.ts", import.meta.url),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  try {
    for (const supported of [true, false]) {
      const directory = path.join(
        root,
        supported ? "installed" : "unsupported",
      );
      await mkdir(directory, { recursive: true });
      if (supported)
        await symlink(
          path.join(process.cwd(), "node_modules"),
          path.join(directory, "node_modules"),
          "dir",
        );
      else {
        const postgres = path.join(directory, "node_modules/postgres");
        await mkdir(postgres, { recursive: true });
        await writeFile(
          path.join(postgres, "package.json"),
          JSON.stringify({
            name: "postgres",
            version: "3.4.9",
            main: "index.js",
          }),
        );
        await writeFile(
          path.join(postgres, "index.js"),
          "module.exports = {};",
        );
      }
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ name: "isolated-listen-runtime" }),
      );
      const staging = path.join(
        root,
        supported ? "build-installed" : "build-unsupported",
      );
      await mkdir(staging);
      const entry = path.join(staging, "entry.mjs"),
        output = path.join(directory, "bundle.cjs");
      await writeFile(entry, javascript);
      await new Promise<void>((resolve, reject) => {
        const compiler = webpack(
          {
            mode: "production",
            // Next supplies its own minifier; its vendored webpack does not
            // ship standalone Terser. The resolver rewrite precedes minifying.
            optimization: { minimize: false },
            target: "node",
            entry,
            output: {
              path: directory,
              filename: "bundle.cjs",
              library: { type: "commonjs2" },
            },
            devtool: false,
          },
          (error, stats) => {
            if (error) {
              reject(error);
              return;
            }
            compiler.close((closeError) => {
              if (closeError) reject(closeError);
              else if (!stats || stats.hasErrors())
                reject(Error(stats?.toString() ?? "No webpack stats"));
              else resolve();
            });
          },
        );
      });
      // The runtime must survive removal of every original/transpiled source.
      await rm(staging, { recursive: true, force: true });
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "-e",
          `
        const adapter = require(process.argv[1]);
        const options = {onclose() {}};
        const sql = Object.assign(() => {}, {options});
        const connection = {listen: Object.assign(() => {}, {sql})};
        const version = adapter.installedPostgresVersion();
        const admitted = adapter.observeListenLoss(connection, version, () => {}) !== null;
        process.stdout.write(JSON.stringify({version, admitted}));
      `,
          output,
        ],
        { cwd: directory, timeout: 5000, maxBuffer: 8192 },
      );
      const result: unknown = JSON.parse(stdout);
      expect(result).toEqual({
        version: supported ? "3.4.8" : "3.4.9",
        admitted: supported,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
