import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const origin = "https://example.test";
const job = "11111111-1111-4111-8111-111111111111";
const url = `${origin}/dashboard/jobs/${job}/chat`;
const account = "a".repeat(64);
function harness() {
  const listeners = new Map();
  const entries = new Map();
  const shown = [];
  const opened = [];
  const cache = {
    match: async (key) => entries.get(String(key.url ?? key))?.clone(),
    put: async (key, value) => entries.set(String(key.url ?? key), value),
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    location: { origin },
    addEventListener: (type, listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    registration: {
      showNotification: async (...args) => shown.push(args),
      getNotifications: async () => [],
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url) => opened.push(url),
    },
  };
  const context = vm.createContext({
    self,
    URL,
    Request,
    Response,
    Map,
    Set,
    Promise,
    caches: { open: async () => cache },
    fetch: async () => {
      throw Error("Unexpected network");
    },
  });
  vm.runInContext(source, context);
  const emit = async (type, properties) => {
    const pending = [];
    const event = {
      ...properties,
      waitUntil: (promise) => pending.push(promise),
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    await Promise.all(pending);
  };
  const bind = async (value) => {
    let result;
    await emit("message", {
      data: { type: "FOREMANHQ_PUSH_ACCOUNT", account: value },
      ports: [
        {
          postMessage: (value) => {
            result = value;
          },
        },
      ],
    });
    assert.equal(result.ok, true);
  };
  return { emit, bind, shown, opened, self, context };
}
test("push uses account-bound generic notification and waitUntil", async () => {
  const h = harness();
  await h.bind(account);
  await h.emit("push", {
    data: {
      json: () => ({
        type: "job-chat",
        account,
        url,
        body: "Private message",
        title: "Private job",
      }),
    },
  });
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0][0], "ForemanHQ Chat");
  assert.equal(h.shown[0][1].body.includes("Private"), false);
});
test("malformed, foreign account, signed-out and external URL pushes are ignored", async () => {
  const h = harness();
  await h.bind(account);
  for (const invalid of [
    { type: "job-chat", account: "b".repeat(64), url },
    { type: "job-chat", account, url: "https://evil.test/" },
    { type: "job-chat", account, url: "/dashboard?redirect=evil" },
    null,
  ]) {
    await h.emit("push", { data: { json: () => invalid } });
  }
  await h.emit("push", {
    data: {
      json: () => {
        throw Error("malformed");
      },
    },
  });
  await h.bind(null);
  await h.emit("push", {
    data: { json: () => ({ type: "job-chat", account, url }) },
  });
  await h.emit("push", {
    data: { json: () => ({ type: "job-chat", account: "", url }) },
  });
  assert.equal(h.shown.length, 0);
});
test("click focuses an existing chat window, navigates another or opens one", async () => {
  const h = harness();
  await h.bind(account);
  let focused = 0;
  let navigated = 0;
  let closed = 0;
  const notification = {
    data: { type: "job-chat", url, account },
    close: () => closed++,
  };
  h.self.clients.matchAll = async () => [{ url, focus: async () => focused++ }];
  await h.emit("notificationclick", { notification });
  assert.equal(focused, 1);
  assert.equal(h.opened.length, 0);
  h.self.clients.matchAll = async () => [
    {
      url: `${origin}/dashboard`,
      navigate: async (target) => {
        assert.equal(target, url);
        navigated++;
        return { focus: async () => focused++ };
      },
    },
  ];
  await h.emit("notificationclick", { notification });
  assert.equal(navigated, 1);
  assert.equal(focused, 2);
  h.self.clients.matchAll = async () => [];
  await h.emit("notificationclick", { notification });
  assert.equal(h.opened[0], url);
  assert.equal(closed, 3);
});
test("click refuses another account or malicious destination, and logout closes visible notifications", async () => {
  const h = harness();
  await h.bind(account);
  let closed = 0;
  h.self.registration.getNotifications = async () => [
    { data: { type: "job-chat" }, close: () => closed++ },
  ];
  await h.bind(null);
  assert.equal(closed, 1);
  await h.emit("notificationclick", {
    notification: { data: { type: "job-chat", url, account }, close() {} },
  });
  await h.bind(account);
  await h.emit("notificationclick", {
    notification: {
      data: { type: "job-chat", url: "https://evil.test/", account },
      close() {},
    },
  });
  assert.equal(h.opened.length, 0);
});
test("private image attachments bypass both image caching and background image warmers", async () => {
  const h = harness();
  const privateUrl = new URL(
    `${origin}/api/job-chat/attachments/private/image`,
  );
  assert.equal(
    h.context.isCacheableImageRequest(privateUrl, { destination: "image" }),
    false,
  );
  let intercepted = false;
  await h.emit("fetch", {
    request: { method: "GET", url: privateUrl.href, destination: "image" },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
  const optimizedUrl = new URL(
    `${origin}/_next/image?url=${encodeURIComponent(privateUrl.pathname)}&w=64&q=75`,
  );
  assert.equal(
    h.context.isCacheableImageRequest(optimizedUrl, { destination: "image" }),
    false,
  );
  await h.emit("fetch", {
    request: { method: "GET", url: optimizedUrl.href, destination: "image" },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
  // General shell preloads must not accept private APIs either.
  const fetches = [];
  h.context.fetch = async (request) => {
    fetches.push(request.url);
    return new Response("shell");
  };
  await h.emit("message", {
    data: {
      type: "FOREMENHQ_CACHE_APP_SHELL",
      urls: [privateUrl.href, optimizedUrl.href],
    },
  });
  assert.equal(fetches.includes(privateUrl.href), false);
  assert.equal(fetches.includes(optimizedUrl.href), false);
  // fetch intentionally throws in harness: a warmer must not attempt this URL at all.
  await h.emit("message", {
    data: { type: "FOREMENHQ_CACHE_CATALOGUE_IMAGES", urls: [privateUrl.href] },
  });
});
