import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
function harness(failure) {
  const entries = new Map();
  const cache = {
    match: async (key) => {
      if (failure === "read") throw Error("blocked");
      return entries.get(String(key.url ?? key))?.clone();
    },
    put: async (key, value) => {
      if (failure === "quota") throw Error("QuotaExceededError");
      entries.set(String(key.url ?? key), value);
    },
    keys: async () => [...entries.keys()],
    delete: async (key) => entries.delete(key),
  };
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Promise,
    Map,
    Set,
    fetch: async () => new Response("online image"),
    caches: {
      open: async () => {
        if (failure === "open") throw Error("denied");
        return cache;
      },
      match: cache.match,
    },
    self: { location: { origin: "https://test.local" }, addEventListener() {} },
  });
  vm.runInContext(source, context);
  return { context, entries };
}
for (const failure of ["open", "read", "quota"])
  test(`valid image response survives cache ${failure} failure`, async () => {
    const { context } = harness(failure);
    assert.equal(
      await (
        await context.cacheFirstImage(
          new Request("https://test.local/images/a.jpg"),
        )
      ).text(),
      "online image",
    );
    assert.equal(
      await (
        await context.cacheFirstStatic(
          new Request("https://test.local/_next/static/a.js"),
        )
      ).text(),
      "online image",
    );
  });
test("image cache is bounded and still stores the newest image", async () => {
  const { context, entries } = harness();
  for (let i = 0; i < 1205; i++)
    await context.cacheFirstImage(
      new Request(`https://test.local/images/${i}.jpg`),
    );
  assert.equal(entries.size, 1200);
  assert.ok(entries.has("https://test.local/images/1204.jpg"));
});

test("private document previews never enter the shared image cache", () => {
  const { context } = harness();
  for (const pathname of [
    "/api/job-documents/files/version-id?jobId=job-id",
    "/_next/image?url=%2Fapi%2Fjob-documents%2Ffiles%2Fversion-id&w=640&q=75",
  ]) {
    const url = new URL(pathname, "https://test.local");
    assert.equal(context.isCacheableImageRequest(url, { destination: "image" }), false);
  }
  assert.equal(context.isCacheableImageRequest(new URL("https://test.local/images/logo.png"), { destination: "image" }), true);
});
