import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_MODEL_BYTES } from "~/lib/bim/types";
import { nativeRevitReportSchema } from "~/lib/bim/native-conversion";

const execute = promisify(execFile);
const sandbox = "/usr/bin/bwrap";
const binaryPath = () =>
  path.resolve(
    process.env.BIM_NATIVE_CONVERTER_PATH ??
      "native/revit/target/release/foreman-revit",
  );

export async function nativeConversionAvailable() {
  if (process.platform !== "linux") return false;
  try {
    await Promise.all([
      access(binaryPath(), constants.X_OK),
      access(sandbox, constants.X_OK),
      access("/usr/bin/prlimit", constants.X_OK),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Fixed paths/arguments; no shell, credentials, home directory or network.
 * The converter only sees its input, read-only runtime, and private output dir.
 * OS bounds complement parser limits; failure never falls back to unsandboxed execution.
 */
export async function convertNativeRevit(source: string) {
  if (!(await nativeConversionAvailable()))
    throw Error("The local Revit converter is unavailable on this server.");
  const input = await stat(source);
  if (!input.isFile() || input.size > MAX_MODEL_BYTES)
    throw Error("The Revit file exceeds the converter's 250 MB limit.");
  const output = await mkdtemp(path.join(tmpdir(), "foreman-revit-"));
  try {
    try {
      await execute(
        sandbox,
        [
          "--unshare-all",
          "--die-with-parent",
          "--new-session",
          "--cap-drop",
          "ALL",
          "--ro-bind",
          "/usr",
          "/usr",
          "--symlink",
          "usr/lib",
          "/lib",
          "--symlink",
          "usr/lib",
          "/lib64",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--tmpfs",
          "/tmp",
          "--ro-bind",
          binaryPath(),
          "/converter",
          "--ro-bind",
          path.resolve(source),
          "/input.rvt",
          "--bind",
          output,
          "/output",
          "--chdir",
          "/output",
          "--clearenv",
          "--setenv",
          "LANG",
          "C.UTF-8",
          "--",
          "/usr/bin/prlimit",
          "--as=4294967296",
          "--cpu=240",
          "--fsize=262144000",
          "--nofile=64",
          "--core=0",
          "--",
          "/converter",
          "/input.rvt",
          "/output/model.ifc",
          "/output/report.json",
        ],
        {
          timeout: 300000,
          killSignal: "SIGKILL",
          maxBuffer: 64 * 1024,
          env: { PATH: "/usr/bin", NODE_ENV: "production" },
        },
      );
    } catch {
      throw Error(
        "Local Revit conversion stopped or exceeded its resource limits. The original file is preserved.",
      );
    }
    const reportPath = path.join(output, "report.json");
    if ((await stat(reportPath)).size > 64 * 1024)
      throw Error("Invalid conversion report.");
    const report = nativeRevitReportSchema.parse(
      JSON.parse(await readFile(reportPath, "utf8")),
    );
    if (report.outcome === "unsupported")
      return { status: "failed" as const, report };
    if (!report.displayedElements)
      throw Error("The converter did not recover any model geometry.");
    const modelPath = path.join(output, "model.ifc");
    const model = await stat(modelPath);
    if (!model.isFile() || model.size > MAX_MODEL_BYTES)
      throw Error("Converted model exceeds 250 MB.");
    const bytes = await readFile(modelPath);
    if (!bytes.subarray(0, 128).toString("ascii").includes("ISO-10303-21;"))
      throw Error("The converter did not produce a valid IFC container.");
    return { status: "ready" as const, report, bytes };
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}
