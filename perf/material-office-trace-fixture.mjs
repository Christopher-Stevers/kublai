// One no-app/no-network trace-shape fixture; execution needs separate root GO.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { decodeTraceFiles } from "./material-office-timeline-records.mjs";
const root = "/tmp/foremanhq-office-trace-fixture-attempt1";
if (fs.existsSync(root)) throw Error("Fresh fixture output required");
fs.mkdirSync(root, { mode: 0o700 });
let browser;
const report = { fixtureOnly: true, appEvidence: false, status: "preparing" };
const zip = path.join(root, "ephemeral.zip");
try {
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  await context.route("**/*", (r) => r.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.setContent(
    "<button onclick=\"document.querySelector('output').hidden=false\">Show</button><output hidden>Ready</output>",
  );
  await context.tracing.start({
    snapshots: false,
    screenshots: false,
    sources: false,
  });
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.locator("output")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await context.tracing.stop({ path: zip });
  const network = execFileSync("unzip", ["-p", zip, "trace.network"], {
    maxBuffer: 1024,
    timeout: 1000,
  });
  const text = execFileSync("unzip", ["-p", zip, "trace.trace"], {
    maxBuffer: 1024 ** 2,
    timeout: 1000,
  }).toString();
  const rows = decodeTraceFiles(text, network);
  const methods = rows.filter((e) => e.type === "before").map((e) => e.method);
  if (
    !methods.includes("click") ||
    !methods.includes("expect") ||
    !rows.some((e) => e.evaluationKind === "raf-evaluation")
  )
    throw Error("Installed phase contract differs");
  fs.writeFileSync(
    path.join(root, "projected-api.json"),
    JSON.stringify(rows, null, 2) + "\n",
  );
  Object.assign(report, {
    status: "passed",
    networkBytes: network.length,
    phaseMethods: methods,
    rawZipRemoved: true,
  });
} catch (e) {
  report.status = "failed";
  report.error = { name: e.name, message: e.message };
  process.exitCode = 1;
} finally {
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  if (browser) await browser.close();
  fs.writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
