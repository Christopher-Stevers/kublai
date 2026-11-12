// Tooling only: does not execute tests, start servers or modify frozen inputs.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
export const FROZEN =
  "/home/tim/.openclaw/workspace/releases/speed-phase1-notification-panel-proposal-20261112";
export const SETUP_REF = "669d7f83:vitest.setup.ts";
export const SETUP_SHA =
  "91a3c8962a0edcb956206a501d943fe99e1c78c6d4d8b5c9a948a3362c75978c";
export const EXPECTED_FP =
  "e71da8d4102bc4fb61a6cba21538cf89c9f7d7bbc04f4e29d87c1102b563172b";
export const EXPECTED_RUNTIME = {
  "src/components/notifications/NotificationCenter.tsx":
    "6b98d2ac142355a7e6f9e897c2746a56abfe9ea6e9e5483e429f06bec4635569",
  "src/components/notifications/NotificationPanel.tsx":
    "61b62c479009f19026d2bcfa5b0982db4769fb3dffce4527b21dbb1d2dc9fe5d",
  "src/hooks/use-notification-account.ts":
    "3d1d0bbc15bb85e9ac3d1afd820b73c3b85148d189d3ec15385b80f0b122bdc5",
};
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function verifyFrozen() {
  const fingerprintHelper =
    "/tmp/foremanhq-perf-method-f9bHR6/scripts/release/source-fingerprint.mjs";
  const { fingerprintSource } = await import(pathToFileURL(fingerprintHelper));
  const evidence = await fingerprintSource(FROZEN);
  assert.equal(evidence.sourceFingerprint, EXPECTED_FP);
  assert.equal(evidence.sourceFileCount, 2202);
  const runtime = {};
  for (const [name, hash] of Object.entries(EXPECTED_RUNTIME)) {
    runtime[name] = sha(await fs.readFile(FROZEN + "/" + name));
    assert.equal(runtime[name], hash);
  }
  return {
    source: FROZEN,
    sourceFingerprint: EXPECTED_FP,
    sourceFileCount: 2202,
    runtime,
    fingerprintHelperSha256: sha(await fs.readFile(fingerprintHelper)),
  };
}
export async function resolveFrozen(specifier) {
  const target = FROZEN + "/src/" + specifier.slice(2);
  for (const suffix of [
    "",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "/index.tsx",
    "/index.ts",
  ]) {
    try {
      if ((await fs.stat(target + suffix)).isFile()) return target + suffix;
    } catch {}
  }
  throw Error("Unresolved frozen dependency " + specifier);
}
export async function prepareUnits() {
  const evidence = await verifyFrozen(),
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "foremanhq-notification-panel-unit-"),
    );
  await fs.symlink(FROZEN + "/node_modules", directory + "/node_modules");
  await fs.writeFile(directory + "/package.json", '{"type":"module"}\n');
  const setup = execFileSync("git", ["show", SETUP_REF]);
  assert.equal(sha(setup), SETUP_SHA);
  await fs.writeFile(directory + "/vitest.setup.ts", setup);
  await fs.writeFile(
    directory + "/tsconfig.json",
    JSON.stringify({ extends: FROZEN + "/tsconfig.json" }) + "\n",
  );
  // The exact 13 owner tests are committed evidence, not a current-HEAD copy.
  let owner = execFileSync(
    "git",
    ["show", "acca100a:src/hooks/use-notification-account.test.tsx"],
    { encoding: "utf8" },
  );
  owner = owner
    .replaceAll(
      '"./use-notification-account"',
      '"~/hooks/use-notification-account"',
    )
    .replaceAll('"./use-online-status"', '"~/hooks/use-online-status"');
  await fs.writeFile(directory + "/owner.test.tsx", owner);
  let original = await fs.readFile(
    FROZEN + "/src/components/notifications/NotificationCenter.test.tsx",
    "utf8",
  );
  for (const name of [
    "NotificationCenter",
    "PushNotifications",
    "JobNotificationSettings",
  ])
    original = original.replaceAll(
      '"./' + name + '"',
      '"~/components/notifications/' + name + '"',
    );
  const contract = `vi.mock("~/hooks/use-notification-account",()=>({useNotificationAccount:()=>({accountKey:mocks.validated?mocks.accountKey:null,online:mocks.online,identity:{isLoading:false},overview:{data:mocks.accountKey?{unreadCount:mocks.count,readTargets:mocks.targets}:undefined,isFetchedAfterMount:mocks.validated,isError:mocks.error,refetch:mocks.refetch},refreshIdentity:mocks.refetch})}));\n`;
  original = original.replace(
    'vi.mock("~/trpc/react"',
    contract + 'vi.mock("~/trpc/react"',
  );
  // Assertions unchanged: wait only for the optional presentation module.
  original = original.replaceAll(
    /it\(("[^"\n]*"), \(\) => \{/g,
    "it($1, async () => {",
  );
  original = original.replaceAll(
    /(fireEvent\.click\(\s*screen\.getByRole\("button", \{ name: "Notifications[^"\n]*" \}\),?\s*\);)/g,
    '$1\n  await waitFor(() => expect(screen.queryByText("Loading notifications…")).not.toBeInTheDocument());',
  );
  await fs.writeFile(directory + "/phase0-presentation.test.tsx", original);
  await fs.copyFile(
    new URL("../notification-inline-proof/inline.test.tsx", import.meta.url),
    directory + "/inline.test.tsx",
  );
  const fixtureFiles = [
    "NotificationCenter.loading.test.tsx",
    "NotificationCenter.import.test.tsx",
    "test-loader.ts",
    "test-subject/NotificationCenter.tsx",
  ];
  await fs.mkdir(directory + "/test-subject");
  for (const name of fixtureFiles) {
    let text = await fs.readFile(new URL("./" + name, import.meta.url), "utf8");
    if (name === "test-subject/NotificationCenter.tsx") {
      const source = await fs.readFile(
        FROZEN + "/src/components/notifications/NotificationCenter.tsx",
        "utf8",
      );
      assert.equal(
        source.split('const loadPanel = () => import("./NotificationPanel");')
          .length,
        2,
      );
      text = source
        .replace(
          'const loadPanel = () => import("./NotificationPanel");',
          "const loadPanel = loadTestPanel;",
        )
        .replace(
          'import type { NotificationPanelProps } from "./NotificationPanel";',
          'import type { NotificationPanelProps } from "~/components/notifications/NotificationPanel";\nimport { loadTestPanel } from "../test-loader";',
        )
        .replace(
          'from "./use-notification-reminder"',
          'from "~/components/notifications/use-notification-reminder"',
        );
    }
    text = text.replaceAll(
      '"./use-notification-reminder"',
      '"~/components/notifications/use-notification-reminder"',
    );
    text = text
      .replaceAll(
        '"./runtime/src/components/notifications/NotificationPanel"',
        '"~/components/notifications/NotificationPanel"',
      )
      .replaceAll(
        '"../runtime/src/components/notifications/NotificationPanel"',
        '"~/components/notifications/NotificationPanel"',
      )
      .replaceAll(
        '"./runtime/src/components/notifications/NotificationCenter"',
        '"~/components/notifications/NotificationCenter"',
      );
    await fs.writeFile(directory + "/" + name, text);
  }
  const config = `import{defineConfig}from'vitest/config';export default defineConfig({root:${JSON.stringify(directory)},server:{fs:{allow:[${JSON.stringify(FROZEN)},${JSON.stringify(directory)}]}},test:{environment:'jsdom',setupFiles:['./vitest.setup.ts'],include:['*.test.tsx']},resolve:{alias:[{find:'~',replacement:${JSON.stringify(FROZEN + "/src")}}]}});`;
  await fs.writeFile(directory + "/vitest.config.mjs", config);
  const manifest = {
    ...evidence,
    directory,
    scope: "Exact frozen runtime/dependencies; no tests executed by prepare",
    operationalSetup: {
      ref: SETUP_REF,
      sha256: SETUP_SHA,
      outsideFrozen: true,
    },
    files: {},
  };
  for (const name of [
    ...fixtureFiles,
    "owner.test.tsx",
    "phase0-presentation.test.tsx",
    "inline.test.tsx",
    "vitest.config.mjs",
    "vitest.setup.ts",
  ])
    manifest.files[name] = sha(await fs.readFile(directory + "/" + name));
  await fs.writeFile(
    directory + "/manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  console.log(JSON.stringify(await prepareUnits()));
