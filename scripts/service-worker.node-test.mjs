import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
function harness(failure, existingEntries) {
  const entries = existingEntries ?? new Map();
  const fetched = [];
  const handlers = new Map();
  const shown = [];
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
    AbortController, setTimeout, clearTimeout,
    Request,
    Response,
    Promise,
    Map,
    Set,
    fetch: async (request) => { fetched.push(request); return new Response("online image"); },
    caches: {
      open: async () => {
        if (failure === "open") throw Error("denied");
        return cache;
      },
      match: cache.match,
    },
    self: { location: { origin: "https://test.local" }, registration: {showNotification:async (title,options)=>shown.push({title,...options})}, addEventListener(type,handler) {handlers.set(type,handler);} },
  });
  vm.runInContext(source, context);
  return { context, entries, handlers, shown, fetched };
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

test("private conversation snapshots bypass shared image caching", () => {
  const { context } = harness();
  for (const pathname of [
    "/api/chat/attachments/private-snapshot",
    "/_next/image?url=%2Fapi%2Fchat%2Fattachments%2Fprivate-snapshot&w=640&q=75",
  ]) {
    assert.equal(
      context.isCacheableImageRequest(new URL(pathname, "https://test.local"), { destination: "image" }),
      false,
    );
  }
});


test("material alerts accept only same-origin list deep links", () => {
  const { context } = harness();
  const id = "11111111-1111-4111-8111-111111111111";
  const good = `/jobs/material-lists/${id}`;
  assert.equal(context.safePushUrl({type:"material-list",url:good}),`https://test.local${good}`);
  for (const url of ["https://evil.example"+good,good+"?redirect=evil",good+"#x","/jobs/chat",good.replace(id,"invalid")])
    assert.equal(context.safePushUrl({type:"material-list",url}),null);
});

test("material push displays the right title, list tag, and account-bound target", async()=>{
  const {context,handlers,shown}=harness();
  const account='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
  let pending;
  const waitUntil=p=>{pending=p;};
  handlers.get('message')({data:{type:'FOREMANHQ_PUSH_ACCOUNT',account},waitUntil});
  await pending;
  const data={type:'material-list',url:`/jobs/material-lists/${id}`,account};
  handlers.get('push')({data:{json:()=>data},waitUntil});
  await pending;
  assert.equal(shown.length,1);
  assert.equal(shown[0].title,'ForemanHQ Materials');
  assert.equal(shown[0].tag,`material-list-${id}`);
  assert.equal(shown[0].data.url,`https://test.local${data.url}`);
  handlers.get('push')({data:{json:()=>({...data,account:'b'.repeat(64)})},waitUntil});
  await pending;
  assert.equal(shown.length,1);
});


test("offline test blocks reads, writes, private files and third-party requests without using network", async () => {
  const {context, fetched} = harness();
  await context.setOfflineTest(true);
  for (const request of [
    new Request("https://test.local/api/material-lists"),
    new Request("https://test.local/api/replicache/push", {method: "POST", body: "pending mutation"}),
    new Request("https://test.local/api/job-documents/files/private"),
    new Request("https://external.example/auth.js"),
  ]) await assert.rejects(context.routeAppRequest(request), /offline test/);
  assert.equal(fetched.length, 0);
  await context.setOfflineTest(false);
  assert.equal((await context.routeAppRequest(new Request("https://test.local/api/material-lists"))).status, 200);
  assert.equal(fetched.length, 1);
});
test("offline test persists across worker restart and still serves cached public assets and pages", async () => {
  const first = harness();
  first.entries.set("https://test.local/_next/static/app.js", new Response("cached code"));
  first.entries.set("/jobs", new Response("cached shell"));
  await first.context.setOfflineTest(true);
  const next = harness(undefined, first.entries);
  assert.equal(await next.context.offlineTestEnabled(), true);
  assert.equal(await (await next.context.routeAppRequest(new Request("https://test.local/_next/static/app.js"))).text(), "cached code");
  assert.equal(await (await next.context.networkFirstNavigation(new Request("https://test.local/jobs"))).text(), "cached shell");
  assert.equal(next.fetched.length, 0);
  await assert.rejects(next.context.cacheFirstStatic(new Request("https://test.local/_next/static/missing.js")), /offline test/);
});
test("cannot enable offline testing when the recovery preference cannot be saved", async () => {
  const {context} = harness("quota");
  await assert.rejects(context.setOfflineTest(true));
  assert.equal(await context.offlineTestEnabled(), false);
});
