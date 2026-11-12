import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  applyExactHunks,
  verifyChecks,
  withDeployLock,
  writeReviewEntry,
  performSwitch,
} from "./dev-deploy.mjs";
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "dev-deploy-test-"));
test("committed hunks require exact unique context, including new files", () => {
  const diff = "@@ -1 +1 @@\n-old\n+new\n";
  assert.equal(applyExactHunks("old\n", diff), "new\n");
  assert.throws(() => applyExactHunks("old\nold\n", diff));
  assert.throws(() => applyExactHunks("other\n", diff));
  assert.equal(applyExactHunks("", "@@ -0,0 +1 @@\n+new\n"), "new\n");
});
test("source-bound own tests fail closed on missing, failed and modified evidence", async () => {
  const root = await temp();
  try {
    const log = path.join(root, "tests.log");
    await fs.writeFile(log, "passed");
    const receipt = {
      sourceFingerprint: "source",
      results: [
        {
          kind: "tests",
          exitCode: 0,
          command: "node --test exact",
          logPath: log,
          logSha256: createHash("sha256").update("passed").digest("hex"),
        },
      ],
    };
    await verifyChecks(receipt, "source");
    await assert.rejects(verifyChecks(receipt, "different"));
    await assert.rejects(verifyChecks({ ...receipt, results: [] }, "source"));
    await assert.rejects(
      verifyChecks(
        { ...receipt, results: [{ ...receipt.results[0], exitCode: 1 }] },
        "source",
      ),
    );
    await fs.writeFile(log, "changed");
    await assert.rejects(verifyChecks(receipt, "source"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("one lock spans work and is removed on success/failure; contention fails", async () => {
  const root = await temp();
  try {
    await withDeployLock(root, async () => {
      await assert.rejects(withDeployLock(root, async () => {}));
    });
    await withDeployLock(root, async () => {});
    await assert.rejects(
      withDeployLock(root, async () => {
        throw Error("fixture");
      }),
    );
    await withDeployLock(root, async () => {});
    assert.equal(
      await fs.stat(root + "/.release-activation.lock").then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("queue entries are atomic newest-first after required marker", async () => {
  const root = await temp();
  try {
    const queue = root + "/queue.md";
    await fs.writeFile(
      queue,
      "# Review\nintro\n<!-- DEV_DEPLOY_ENTRIES -->\nold\n",
    );
    const entry = {
      at: "first",
      agent: "test",
      summary: "change",
      commits: ["a"],
      build: "b",
      previousBuild: "c",
      worker: false,
      shared: false,
      large: false,
    };
    await writeReviewEntry(queue, entry);
    await writeReviewEntry(queue, { ...entry, at: "second" });
    const text = await fs.readFile(queue, "utf8");
    assert(text.indexOf("second") < text.indexOf("first"));
    assert(text.indexOf("intro") < text.indexOf("second"));
    await fs.writeFile(queue, "# Missing marker\n");
    await assert.rejects(writeReviewEntry(queue, entry));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
for (const failure of ["health", "queue"])
  test(
    "failed " +
      failure +
      " restores previous pointer/service and checks rollback",
    async () => {
      const root = await temp();
      try {
        const previous = root + "/old",
          build = root + "/new";
        await fs.mkdir(previous);
        await fs.mkdir(build);
        await fs.symlink(previous, root + "/.next");
        let restarts = 0,
          rollback = false;
        await assert.rejects(
          performSwitch({
            repo: root,
            previous,
            build,
            restart: async () => {
              restarts++;
            },
            health: async (current) => {
              if (current === build && failure === "health")
                throw Error("bad health");
              if (current === previous) rollback = true;
            },
            queue: async () => {
              if (failure === "queue") throw Error("cannot write queue");
            },
          }),
          /previous release restored/,
        );
        assert.equal(await fs.realpath(root + "/.next"), previous);
        assert.equal(restarts, 2);
        assert(rollback);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
test("successful switch writes queue only after healthy candidate", async () => {
  const root = await temp();
  try {
    const previous = root + "/old",
      build = root + "/new";
    await fs.mkdir(previous);
    await fs.mkdir(build);
    await fs.symlink(previous, root + "/.next");
    const order = [];
    await performSwitch({
      repo: root,
      previous,
      build,
      restart: async () => order.push("restart"),
      health: async () => order.push("healthy"),
      queue: async () => order.push("queued"),
    });
    assert.deepEqual(order, ["restart", "healthy", "queued"]);
    assert.equal(await fs.realpath(root + "/.next"), build);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("packaging preserves own public files, carries only packaged extras and normalizes config by value", async () => {
  const { packageLikeActive } = await import("./dev-deploy.mjs");
  const root = await temp();
  try {
    const old = root + "/old",
      next = root + "/next",
      base = root + "/source";
    for (const dir of [old, next]) {
      await fs.mkdir(dir + "/runtime/release", { recursive: true });
      await fs.mkdir(dir + "/runtime/public", { recursive: true });
      await fs.mkdir(dir + "/static", { recursive: true });
      await fs.writeFile(
        dir + "/release-assets.json",
        JSON.stringify({ currentScripts: [], sourceHash: "a".repeat(64) }),
      );
    }
    await fs.mkdir(base + "/public", { recursive: true });
    await fs.writeFile(base + "/public/source-deleted.txt", "old source");
    await fs.writeFile(
      old + "/runtime/public/source-deleted.txt",
      "old source",
    );
    await fs.writeFile(old + "/runtime/public/extra.txt", "extra");
    await fs.writeFile(old + "/runtime/public/changed.txt", "old image");
    await fs.writeFile(next + "/runtime/public/changed.txt", "new image");
    for (const file of ["start.mjs", "static-handler.mjs"])
      await fs.writeFile(old + "/runtime/release/" + file, "pinned");
    await fs.writeFile(
      old + "/runtime/next.config.mjs",
      'export default {distDir:"..",htmlLimitedBots:/bot/,experimental:{}};',
    );
    const config = {
      distDir: ".next-release-build",
      htmlLimitedBots: "bot",
      experimental: { trustHostHeader: false, isExperimentalCompile: false },
    };
    await fs.writeFile(
      old + "/required-server-files.json",
      JSON.stringify({ config }),
    );
    await fs.writeFile(
      next + "/required-server-files.json",
      JSON.stringify({
        config: {
          experimental: config.experimental,
          htmlLimitedBots: "bot",
          distDir: config.distDir,
        },
      }),
    );
    await packageLikeActive(next, old, {}, base);
    assert.equal(
      await fs.readFile(next + "/runtime/public/changed.txt", "utf8"),
      "new image",
    );
    assert.equal(
      await fs.readFile(next + "/runtime/public/extra.txt", "utf8"),
      "extra",
    );
    assert.equal(
      await fs.stat(next + "/runtime/public/source-deleted.txt").then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
