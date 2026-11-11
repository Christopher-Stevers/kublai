import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import SuperJSON from "superjson";
import { decodeObservedTrpcResponse } from "./observed-trpc-response.mjs";
async function wire(data) {
  const stream = jsonlStreamProducer({
    data,
    serialize: SuperJSON.serialize,
    formatError: () => ({
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR" },
    }),
  });
  return new Response(stream).text();
}
test("real installed JSONL producer envelope: mixed deferred head/result/data with SuperJSON", async () => {
  const role = {
    accountScope: "synthetic:actor",
    appAccess: true,
    canEditExecutive: true,
    at: new Date("2026-11-11T00:00:00Z"),
  };
  const body = await wire({
    0: Promise.resolve({
      result: Promise.resolve({ data: Promise.resolve(role) }),
    }),
    1: Promise.resolve({
      result: Promise.resolve({
        data: Promise.resolve({ canEditExecutive: false }),
      }),
    }),
  });
  assert.ok(body.trim().split("\n").length > 1);
  assert.throws(() => JSON.parse(body));
  const rows = await decodeObservedTrpcResponse({
    body,
    requestAccept: "application/jsonl",
    contentType: "application/jsonl; charset=utf-8",
    count: 2,
  });
  assert.deepEqual(rows, [
    { ok: true, data: role },
    { ok: true, data: { canEditExecutive: false } },
  ]);
});
test("JSONL ordinary error and deferred rejection remain errors, never grants", async () => {
  const body = await wire({
    0: Promise.resolve({
      error: { code: -32003, data: { code: "FORBIDDEN" } },
    }),
    1: Promise.resolve({
      result: Promise.resolve({
        data: new Promise((_, reject) =>
          setTimeout(() => reject(Error("private failure detail")), 0),
        ),
      }),
    }),
  });
  const rows = await decodeObservedTrpcResponse({
    body,
    requestAccept: "application/jsonl",
    contentType: "application/jsonl",
    count: 2,
  });
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].errorCode, "FORBIDDEN");
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].errorCode, "DEFERRED_ERROR");
});
test("normal mutation JSON and batch SuperJSON success/error are decoded", async () => {
  const value = { shared: { sortMode: "recent" }, canEditExecutive: true };
  const row = { result: { data: SuperJSON.serialize(value) } };
  assert.deepEqual(
    await decodeObservedTrpcResponse({
      body: JSON.stringify(row),
      contentType: "application/json",
      count: 1,
    }),
    [{ ok: true, data: value }],
  );
  const rows = await decodeObservedTrpcResponse({
    body: JSON.stringify([
      row,
      {
        error: SuperJSON.serialize({
          code: -32003,
          data: { code: "FORBIDDEN" },
        }),
      },
    ]),
    contentType: "application/json",
    count: 2,
  });
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].errorCode, "FORBIDDEN");
});
test("malformed/missing/oversized observed bodies fail closed", async () => {
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: "not json",
      contentType: "application/json",
      count: 1,
    }),
  );
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: "{}",
      requestAccept: "application/jsonl",
      contentType: "application/jsonl",
      count: 1,
    }),
  );
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: "{}",
      contentType: "application/json",
      count: 2,
    }),
  );
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: "x".repeat(40),
      contentType: "application/json",
      count: 1,
      maxBytes: 20,
    }),
  );
});
test("actual-response wrapper bounds body wait/length without issuing any request", async () => {
  const { decodePlaywrightTrpcResponse } =
    await import("./observed-trpc-response.mjs");
  await assert.rejects(
    decodePlaywrightTrpcResponse(
      {
        headers: () => ({ "content-type": "application/json" }),
        request: () => ({ headers: () => ({}) }),
        body: () => new Promise(() => {}),
      },
      1,
      { timeoutMs: 5 },
    ),
    /body timeout/,
  );
  let read = false;
  await assert.rejects(
    decodePlaywrightTrpcResponse(
      {
        headers: () => ({ "content-length": "1000" }),
        body: () => {
          read = true;
          return Promise.resolve(Buffer.from("{}"));
        },
      },
      1,
      { maxBytes: 10 },
    ),
    /size bound/,
  );
  assert.equal(read, false);
});
test("complete observed JSONL cannot hide trailing corruption or a truncated final line", async () => {
  const body = await wire({
    0: Promise.resolve({
      result: Promise.resolve({
        data: Promise.resolve({ canEditExecutive: true }),
      }),
    }),
  });
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: body + "broken\n",
      requestAccept: "application/jsonl",
      contentType: "application/jsonl",
      count: 1,
    }),
  );
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: body.trimEnd(),
      requestAccept: "application/jsonl",
      contentType: "application/jsonl",
      count: 1,
    }),
    /truncated/,
  );
});
test("real tRPC fetch adapter streams JSONL under application/json; actual request selects decoder", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const t = initTRPC.create({ transformer: SuperJSON, isDev: false });
  const router = t.router({
    role: t.procedure.query(() => ({
      canEditExecutive: true,
      appAccess: true,
      accountScope: "fixture:actor",
    })),
    denied: t.procedure.query(() => {
      throw new TRPCError({ code: "FORBIDDEN" });
    }),
  });
  const request = new Request(
    "http://fixture.invalid/trpc/role,denied?batch=1",
    { headers: { "trpc-accept": "application/jsonl" } },
  );
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router,
    createContext: () => ({}),
  });
  assert.match(
    response.headers.get("content-type"),
    /^application\/json(?:;|$)/,
  );
  const body = Buffer.from(await response.arrayBuffer());
  const rows = await decodeObservedTrpcResponse({
    body,
    contentType: response.headers.get("content-type"),
    requestAccept: request.headers.get("trpc-accept"),
    count: 2,
  });
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].data.canEditExecutive, true);
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].errorCode, "FORBIDDEN");
  await assert.rejects(
    decodeObservedTrpcResponse({
      body,
      contentType: "application/json",
      requestAccept: null,
      count: 2,
    }),
  );
});
test("real server normal mutation JSON and nonstream error retain actual request contract", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const { decodePlaywrightTrpcResponse } =
    await import("./observed-trpc-response.mjs");
  const t = initTRPC.create({ transformer: SuperJSON, isDev: false });
  const router = t.router({
    save: t.procedure
      .input((value) => value)
      .mutation(({ input }) => ({ saved: input.mode })),
    denied: t.procedure.query(() => {
      throw new TRPCError({ code: "FORBIDDEN" });
    }),
  });
  for (const request of [
    new Request("http://fixture.invalid/trpc/save?batch=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 0: SuperJSON.serialize({ mode: "recent" }) }),
    }),
    new Request("http://fixture.invalid/trpc/denied?batch=1"),
  ]) {
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: request,
      router,
      createContext: () => ({}),
    });
    const headers = Object.fromEntries(response.headers),
      body = Buffer.from(await response.arrayBuffer());
    const rows = await decodePlaywrightTrpcResponse(
      {
        headers: () => headers,
        request: () => ({ headers: () => Object.fromEntries(request.headers) }),
        body: () => Promise.resolve(body),
      },
      1,
    );
    if (request.method === "POST") {
      assert.equal(rows[0].ok, true);
      assert.equal(rows[0].data.saved, "recent");
    } else {
      assert.equal(response.status, 403);
      assert.equal(rows[0].ok, false);
      assert.equal(rows[0].errorCode, "FORBIDDEN");
    }
  }
});
test("real streaming parse error is not mistaken for a grant on HTTP 200", async () => {
  const { initTRPC } = await import("@trpc/server");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const t = initTRPC.create({ transformer: SuperJSON, isDev: false });
  const router = t.router({
    role: t.procedure
      .input((value) => value)
      .query(() => ({ canEditExecutive: true })),
  });
  const request = new Request(
    "http://fixture.invalid/trpc/role?batch=1&input=%7B",
    { headers: { "trpc-accept": "application/jsonl" } },
  );
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router,
    createContext: () => ({}),
  });
  assert.equal(response.status, 200);
  const rows = await decodeObservedTrpcResponse({
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    requestAccept: request.headers.get("trpc-accept"),
    count: 1,
  });
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].errorCode, "BAD_REQUEST");
});
