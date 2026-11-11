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
    AbortController, AbortSignal, setTimeout, clearTimeout,
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
    self: { location: { origin: "https://test.local" }, registration: {showNotification:async (title,options)=>shown.push({title,...options})}, addEventListener(type,handler) { const previous = handlers.get(type); handlers.set(type, previous ? event => { previous(event); handler(event); } : handler); } },
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
  first.entries.set("/offline.html", new Response("offline gate"));
  await first.context.setOfflineTest(true);
  const next = harness(undefined, first.entries);
  assert.equal(await next.context.offlineTestEnabled(), true);
  assert.equal(await (await next.context.routeAppRequest(new Request("https://test.local/_next/static/app.js"))).text(), "cached code");
  assert.equal(await (await next.context.networkFirstNavigation(new Request("https://test.local/jobs"))).text(), "offline gate");
  assert.equal(next.fetched.length, 0);
  await assert.rejects(next.context.cacheFirstStatic(new Request("https://test.local/_next/static/missing.js")), /offline test/);
});
test("cannot enable offline testing when the recovery preference cannot be saved", async () => {
  const {context} = harness("quota");
  await assert.rejects(context.setOfflineTest(true));
  assert.equal(await context.offlineTestEnabled(), false);
});

// Synthetic latency verifies ordering, not a device render-time guarantee.
test("visited authenticated Flight payload returns before a stalled refresh", async () => {
  const { context, fetched } = harness();
  const request = new Request("https://test.local/jobs/11111111-1111-4111-8111-111111111111?_rsc=one", {
    headers: { RSC: "1", "Next-Router-State-Tree": "tree-a" },
  });
  vm.runInContext('navigationClients.set("tab-a", "org:alice")', context);
  const key = context.navigationKey(request, "org:alice");
  await context.safePut(vm.runInContext("PAGE_CACHE", context), key, new Response("saved Flight"));
  context.fetch = () => new Promise(() => {});
  const pending = [];
  const result = await Promise.race([
    context.networkFirstRsc(new Request(request.url.replace("one", "two"), request), { clientId: "tab-a", waitUntil: p => pending.push(p) }),
    new Promise((_, reject) => setTimeout(() => reject(Error("waited for network")), 100)),
  ]);
  assert.equal(await result.text(), "saved Flight");
  assert.equal(pending.length, 1);
  assert.equal(fetched.length, 0);
});
test("Flight cache separates accounts, tabs and router trees", async () => {
  const { context } = harness();
  const request = new Request("https://test.local/jobs/11111111-1111-4111-8111-111111111111?_rsc=one", { headers: { RSC: "1", "Next-Router-State-Tree": "tree-a" } });
  vm.runInContext('navigationClients.set("tab-a", "org:alice"); navigationClients.set("tab-b", "org:bob")', context);
  await context.safePut(vm.runInContext("PAGE_CACHE", context), context.navigationKey(request, "org:alice"), new Response("alice private"));
  for (const event of [{clientId:"tab-b"}, {clientId:"new-tab"}])
    assert.equal(await (await context.networkFirstRsc(request, event)).text(), "online image");
  const otherTree = new Request(request, { headers: { RSC: "1", "Next-Router-State-Tree": "tree-b" } });
  assert.equal(await (await context.networkFirstRsc(otherTree, {clientId:"tab-a"})).text(), "online image");
});
test("cold offline document never replays private HTML", async () => {
  const { context, entries } = harness();
  entries.set("https://test.local/jobs/11111111-1111-4111-8111-111111111111", new Response("private screen"));
  entries.set("/jobs", new Response("private fallback"));
  await context.setOfflineTest(true);
  const response = await context.networkFirstNavigation(new Request("https://test.local/jobs/11111111-1111-4111-8111-111111111111"));
  assert.match(await response.text(), /Reconnect to open/);
});

test("authenticated route refresh stores fresh Flight and logout revokes saved access", async () => {
  const { context, handlers } = harness();
  const waits = [];
  const build = "a".repeat(64);
  context.fetch = async request => new URL(request.url).pathname === "/api/device-cache-binding"
    ? Response.json({account: "org:alice", build})
    : new Response("fresh Flight", {headers:{"Content-Type":"text/x-component"}});
  const message = async account => {
    handlers.get("message")({data:{type:"FOREMENHQ_NAVIGATION_ACCOUNT", account, build}, source:{id:"tab-a"}, waitUntil:p=>waits.push(p)});
    await Promise.all(waits.splice(0));
  };
  await message("org:alice");
  const request = new Request("https://test.local/jobs/11111111-1111-4111-8111-111111111111?_rsc=one", {headers:{RSC:"1"}});
  await context.networkFirstRsc(request, {clientId:"tab-a",waitUntil:p=>waits.push(p)});
  await context.setOfflineTest(true);
  assert.equal(await (await context.networkFirstRsc(request, {clientId:"tab-a",waitUntil:p=>waits.push(p)})).text(), "fresh Flight");
  await Promise.all(waits.splice(0));
  await message(null);
  await assert.rejects(context.networkFirstRsc(request,{clientId:"tab-a"}), /offline test/);
  await message("org:alice"); // Offline means there is no fresh identity validation.
  await assert.rejects(context.networkFirstRsc(request,{clientId:"tab-a"}), /offline test/);
});

for (const status of [401, 403, 404, 410]) test(`known ${status} revokes every cached route and tab for that identity`, async () => {
  const {context, entries} = harness();
  const scope = "org:alice:build:" + "a".repeat(64);
  vm.runInContext(`navigationClients.set("tab-a", "${scope}"); navigationClients.set("tab-b", "org:alice:build:${"b".repeat(64)}");`, context);
  const request = new Request("https://test.local/jobs/11111111-1111-4111-8111-111111111111", {headers:{RSC:"1"}});
  const other = new Request("https://test.local/jobs/assets", {headers:{RSC:"1"}});
  await context.safePut(vm.runInContext("PAGE_CACHE",context), context.navigationKey(request,scope),new Response("old page"));
  await context.safePut(vm.runInContext("PAGE_CACHE",context), context.navigationKey(other,scope),new Response("other private page"));
  context.fetch=async()=>new Response("denied",{status});
  const waits=[];
  await context.networkFirstRsc(request,{clientId:"tab-a",waitUntil:p=>waits.push(p)});
  await Promise.all(waits);
  assert.equal(vm.runInContext("navigationClients.size",context),0);
  assert.equal([...entries.keys()].some(key=>key.includes("__device_account")),false);
  assert.equal((await context.networkFirstRsc(other,{clientId:"tab-a"})).status,status);
});

test("binding requires explicit build and fresh server identity, with logout winning an in-flight bind",async()=>{
  const {context}=harness();const build="a".repeat(64);
  let resolve; context.fetch=()=>new Promise(done=>resolve=done);
  const binding=context.bindNavigationClient({source:{id:"tab"},data:{account:"org:alice",build}});
  await new Promise(done=>setTimeout(done,0));
  await context.bindNavigationClient({source:{id:"tab"},data:{account:null}});
  resolve(Response.json({account:"org:alice",build}));await binding;
  assert.equal(vm.runInContext("navigationClients.size",context),0);
  await context.bindNavigationClient({source:{id:"tab"},data:{account:"org:alice",build:"unknown"}});
  assert.equal(vm.runInContext("navigationClients.size",context),0);
  context.fetch=async()=>Response.json({account:"org:bob",build});
  await context.bindNavigationClient({source:{id:"tab"},data:{account:"org:alice",build}});
  assert.equal(vm.runInContext("navigationClients.size",context),0);
});

test("release warming only accepts immutable same-origin JS/CSS and fetches missing changes",async()=>{
  const {context,entries}=harness();const build="a".repeat(64);
  const manifest={build,changedAssets:["/_next/static/shared.js","/_next/static/new.js"]};
  entries.set("https://test.local/_next/static/shared.js",new Response("already cached",{headers:{"Content-Type":"application/javascript"}}));
  let downloaded=0;
  context.fetch=async request=>{
    if(new URL(request.url).pathname==="/foremanhq-release-assets.json")return Response.json(manifest);
    downloaded++;return new Response("new bundle",{headers:{"Content-Type":"application/javascript"}});
  };
  assert.equal(await context.warmRelease(build),build);
  assert.equal(downloaded,1);
  assert.ok(entries.has("https://test.local/_next/static/new.js"));
  for(const url of ["https://other.local/_next/static/app.js","/api/private.js","/_next/static/app.js?token=1"])
    assert.throws(()=>context.releaseAssets({build,changedAssets:[url]}));
});
test("failed background assets do not report a release ready or silently activate",async()=>{
  const {context,handlers}=harness();const build="a".repeat(64);
  let skipped=0;context.self.skipWaiting=async()=>{skipped++;};
  context.fetch=async request=>new URL(request.url).pathname==="/foremanhq-release-assets.json"
    ?Response.json({build,changedAssets:["/_next/static/missing.js"]}):new Response("missing",{status:404});
  let ready;const waits=[];
  handlers.get("message")({data:{type:"FOREMENHQ_WARM_RELEASE",goodLink:true,build},ports:[{postMessage:value=>ready=value}],waitUntil:value=>waits.push(value)});
  await Promise.all(waits);
  assert.equal(ready.ready,false);assert.equal(skipped,0);
  handlers.get("message")({data:{type:"FOREMENHQ_ACTIVATE_RELEASE"},waitUntil:value=>waits.push(value)});
  await Promise.all(waits);assert.equal(skipped,1);
});

test("identity revocation fences another tab's already-running verification",async()=>{
  const {context}=harness();const build="a".repeat(64);let resolve;
  context.fetch=()=>new Promise(done=>resolve=done);
  const binding=context.bindNavigationClient({source:{id:"tab-new"},data:{account:"org:alice",build}});
  await new Promise(done=>setTimeout(done,0));
  await context.revokeNavigationAccount("org:alice:build:"+build);
  resolve(Response.json({account:"org:alice",build}));await binding;
  assert.equal(vm.runInContext("navigationClients.size",context),0);
});
