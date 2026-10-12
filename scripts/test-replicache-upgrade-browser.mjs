// Real Chromium IndexedDB; isolated fixture server, no production data or credentials.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
const previous =
  process.env.PREVIOUS_REPLICACHE_ENTRY ??
  path.resolve(
    "node_modules/.pnpm/replicache@15.3.0/node_modules/replicache/out/replicache.js",
  );
if (!fs.existsSync(previous))
  throw Error(
    "Set PREVIOUS_REPLICACHE_ENTRY to the unmodified 15.3.0 package entry for migration testing.",
  );
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "foremanhq-sync-upgrade-"));
await esbuild.build({
  entryPoints: ["scripts/fixtures/replicache-upgrade/app.jsx"],
  outfile: path.join(temp, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  alias: { "previous-replicache": previous },
  define: { "process.env.NODE_ENV": '"production"' },
});
const data = {
  id: "item",
  materialListId: "list",
  quantity: "10",
  unitCost: "2",
  extendedPrice: "50",
  supplierPart: { packSize: "25" },
};
const mutationIds = new Map();
const applied = [];
let revision = 1;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(fs.readFileSync(path.join(temp, "app.js")));
    }
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "text/html");
      return res.end(
        '<html><body><script type="module" src="/app.js"></script></body></html>',
      );
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/push") {
      expect(body.pushVersion).toBe(1);
      for (const mutation of body.mutations) {
        const prior = mutationIds.get(mutation.clientID) ?? 0;
        if (mutation.id <= prior) continue;
        expect(mutation.id).toBe(prior + 1);
        expect(mutation.name).toBe("updateItemQuantity");
        data.quantity = String(mutation.args.quantity);
        data.extendedPrice = String(
          Math.ceil(mutation.args.quantity / 25) * 25 * 2,
        );
        mutationIds.set(mutation.clientID, mutation.id);
        applied.push(mutation.args.quantity);
        revision++;
      }
      return res.end("{}");
    }
    expect(body.pullVersion).toBe(1);
    res.end(
      JSON.stringify({
        cookie: revision,
        lastMutationIDChanges: Object.fromEntries(mutationIds),
        patch: [
          { op: "clear" },
          { op: "put", key: "materialListItem/item", value: data },
        ],
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.waitForFunction(() => !!window.syncFixture);
  const old = await page.evaluate(() =>
    window.syncFixture.open("old", "upgrade"),
  );
  await page.evaluate(() => window.syncFixture.pull("upgrade"));
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.read("upgrade")))
    .toMatchObject({ quantity: "10" });
  await context.setOffline(true);
  await page.evaluate(() => window.syncFixture.quantity("upgrade", 37));
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.pending("upgrade")))
    .toHaveLength(1);
  await page.waitForTimeout(2500); // Allow the old SDK idle persistence to flush before simulating an upgrade.
  await page.evaluate(() => window.syncFixture.close("upgrade"));
  const next = await page.evaluate(() =>
    window.syncFixture.open("new", "upgrade"),
  );
  expect(next).toEqual(old);
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.read("upgrade")))
    .toMatchObject({ quantity: "37", extendedPrice: "100" });
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.pending("upgrade")))
    .toHaveLength(1);
  await page.evaluate(() => window.syncFixture.quantity("upgrade", 62));
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.read("upgrade")))
    .toMatchObject({ quantity: "62", extendedPrice: "150" });
  await context.setOffline(false);
  await page.evaluate(async () => {
    await window.syncFixture.push("upgrade");
    await window.syncFixture.pull("upgrade");
  });
  await expect.poll(() => applied).toEqual([37, 62]);
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.pending("upgrade")))
    .toHaveLength(0);
  await page.evaluate(async () => {
    await window.syncFixture.open("new", "second-device");
    await window.syncFixture.pull("second-device");
  });
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.read("second-device")))
    .toMatchObject({ quantity: "62" });
  await page.evaluate(async () => {
    await window.syncFixture.close("second-device");
    await window.syncFixture.close("upgrade");
  });
  await page.reload();
  await page.waitForFunction(() => !!window.syncFixture);
  await context.setOffline(true);
  await page.evaluate(() => window.syncFixture.open("new", "upgrade"));
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.read("upgrade")))
    .toMatchObject({ quantity: "62" });
  // Verify rollback remains possible without resetting or deleting the database.
  await page.evaluate(async () => {
    await window.syncFixture.close("upgrade");
    await window.syncFixture.open("old", "upgrade");
  });
  await expect
    .poll(() => page.evaluate(() => window.syncFixture.read("upgrade")))
    .toMatchObject({ quantity: "62" });
  await page.evaluate(() => window.syncFixture.close("upgrade"));
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      existingDatabase: "preserved",
      pendingOfflineMutations: "preserved and synced once",
      roundedPackPricing: "preserved",
      secondClient: "synced",
      reload: "preserved",
      rollback: "compatible",
    }),
  );
} finally {
  await browser.close();
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
