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
      contentType: "application/jsonl",
      count: 1,
    }),
  );
  await assert.rejects(
    decodeObservedTrpcResponse({
      body: body.trimEnd(),
      contentType: "application/jsonl",
      count: 1,
    }),
    /truncated/,
  );
});
