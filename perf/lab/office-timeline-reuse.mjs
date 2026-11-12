// New supplemental setup only; copied fixture/assets/metadata never app code.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const definitions = {
  runtime: {
    snapshot: "/tmp/foremanhq-speed-app-fxHxrn",
    source:
      "/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112",
    build: "9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0",
    fingerprint:
      "34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d",
    files: 2200,
    labBuild: "wTBAqKGVn-GRqajiTebMf",
    port: 3485,
  },
};
const role = process.env.PERF_OFFICE_TIMELINE_ROLE,
  d = definitions[role];
const output = process.env.PERF_OFFICE_TIMELINE_ROLE_OUTPUT;
if (
  !d ||
  output !== `/tmp/foremanhq-office-timeline-attempt1/${role}` ||
  process.env.PERF_HARNESS_DIR !== "/tmp/foremanhq-perf-method-f9bHR6"
)
  throw Error("Exact supplemental role/output/harness required");
if (
  fs.realpathSync(d.snapshot) !== d.snapshot ||
  !fs.existsSync(path.join(d.snapshot, "PERF_LAB_ONLY")) ||
  fs.readFileSync(path.join(d.snapshot, ".next/BUILD_ID"), "utf8").trim() !==
    d.labBuild ||
  fs
    .readFileSync(
      path.join(
        d.source,
        role === "baseline"
          ? ".next-canonical-a/BUILD_ID"
          : ".next-web/BUILD_ID",
      ),
      "utf8",
    )
    .trim() !== d.build
)
  throw Error("Exact retained compiled artifact required");
if (
  !fs
    .readFileSync(path.join(d.snapshot, "next.config.js"), "utf8")
    .includes("const labDatabase = new URL(process.env.PERF_LAB_DATABASE_URL")
)
  throw Error("Runtime private socket guard missing");
const { sourceEvidence } = await import(
  pathToFileURL(
    process.env.PERF_HARNESS_DIR + "/scripts/release/source-fingerprint.mjs",
  )
);
const current = await sourceEvidence(
  d.source,
  d.snapshot,
  d.build,
  "after-lab-transforms",
);
const prior = JSON.parse(
  fs.readFileSync(path.join(d.snapshot, "source-evidence.json")),
);
if (
  current.sourceFingerprint !== d.fingerprint ||
  current.sourceFileCount !== d.files ||
  current.sourceVerification.unchangedFilesChecked !== d.files - 5 ||
  prior.sourceBuild !== d.build ||
  prior.sourceFingerprint !== d.fingerprint
)
  throw Error("Frozen source mismatch");
if (process.argv[2] === "after") {
  fs.writeFileSync(
    path.join(output, "source-after.json"),
    JSON.stringify({ ...current, labBuild: d.labBuild }, null, 2) + "\n",
  );
} else {
  const socket = process.env.PERF_LAB_SOCKET,
    url = new URL(process.env.PERF_LAB_DATABASE_URL);
  if (
    !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
    !fs.existsSync(socket + "/.s.PGSQL.55463") ||
    url.pathname !== "/foremanhq_perf_lab" ||
    url.searchParams.get("host") !== socket ||
    url.searchParams.get("port") !== "55463" ||
    process.env.DATABASE_URL !== process.env.PERF_LAB_DATABASE_URL
  )
    throw Error("Fresh private socket binding required");
  const fixture = JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));
  if (
    fixture.provenance !== "isolated-seeded-app" ||
    fixture.productionDatabase !== false
  )
    throw Error("Synthetic fixture required");
  fs.mkdirSync(path.join(output, "prior-generated"));
  for (const name of [
    "preflight.json",
    "source-evidence.json",
    "perf/fixtures.json",
  ]) {
    if (fs.existsSync(path.join(d.snapshot, name)))
      fs.copyFileSync(
        path.join(d.snapshot, name),
        path.join(output, "prior-generated", name.replaceAll("/", "-")),
      );
  }
  fs.copyFileSync(
    process.env.PERF_LAB_FIXTURES,
    path.join(d.snapshot, "perf/fixtures.json"),
  );
  fs.rmSync(path.join(d.snapshot, "uploads"), { recursive: true, force: true });
  execFileSync("rsync", [
    "-a",
    process.env.PERF_LAB_ASSETS + "/",
    d.snapshot + "/",
  ]);
  current.sourceVerification.preTransformUnchangedFilesChecked =
    prior.sourceVerification.preTransformUnchangedFilesChecked;
  fs.writeFileSync(
    path.join(d.snapshot, "source-evidence.json"),
    JSON.stringify(current, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "source-before.json"),
    JSON.stringify(
      { ...current, labBuild: d.labBuild, snapshot: d.snapshot, socket },
      null,
      2,
    ) + "\n",
  );
  fs.copyFileSync(
    process.env.PERF_LAB_FIXTURES,
    path.join(output, "fixtures.json"),
  );
  fs.writeFileSync(
    path.join(output, "runtime-config.json"),
    JSON.stringify(
      {
        base: `http://127.0.0.1:${d.port}/`,
        snapshot: d.snapshot,
        sourceEvidence: path.join(output, "source-before.json"),
        preflight: path.join(output, "preflight.json"),
        fixtures: path.join(output, "fixtures.json"),
        serverPid: path.join(output, "server.pid"),
        serverLog: path.join(output, "server.log"),
        databaseLog: path.join(socket, "server.log"),
        expectedLabBuild: d.labBuild,
      },
      null,
      2,
    ) + "\n",
  );
}
