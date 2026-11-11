import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import {
  collectObservedWire,
  stripObservationHeaders,
  CONTEXT_HEADER,
  REQUEST_HEADER,
  observationFailureCode,
} from "./proxy-wire-observer.mjs";
const stream = () =>
  Object.assign(new EventEmitter(), {
    headers: { "content-type": "application/json" },
  });
const body = Buffer.from(
  JSON.stringify([{ result: { data: { json: { canEditExecutive: true } } } }]),
);
test("collects split real bytes independently of downstream cancel, without issuing a request", async () => {
  const input = stream(),
    downstream = new EventEmitter();
  const pending = collectObservedWire(input, { requestAccept: null, count: 1 });
  input.emit("data", body.subarray(0, 10));
  downstream.emit("close");
  input.emit("data", body.subarray(10));
  input.emit("end");
  const observed = await pending;
  assert.equal(observed.rows[0].data.canEditExecutive, true);
  assert.equal(observed.wireBytes, body.length);
});
test("truncated/aborted, size, timeout and compression-output bounds fail with safe reason codes", async () => {
  for (const [action, code] of [
    [
      (s) => {
        s.emit("data", body.subarray(0, 5));
        s.emit("aborted");
      },
      "WIRE_ABORTED",
    ],
    [(s) => s.emit("data", Buffer.alloc(50)), "WIRE_SIZE_BOUND"],
    [(_) => {}, "WIRE_TIMEOUT"],
  ]) {
    const s = stream(),
      p = collectObservedWire(s, {
        requestAccept: null,
        count: 1,
        maxBytes: 40,
        timeoutMs: 5,
      });
    action(s);
    await assert.rejects(p, (error) => observationFailureCode(error) === code);
  }
  const s = stream();
  s.headers["content-encoding"] = "gzip";
  const compressed = gzipSync(Buffer.alloc(10000, 32));
  const p = collectObservedWire(s, {
    requestAccept: null,
    count: 1,
    maxBytes: 100,
  });
  s.emit("data", compressed);
  s.emit("end");
  await assert.rejects(
    p,
    (error) => observationFailureCode(error) === "WIRE_DECOMPRESSION_FAILED",
  );
});
test("valid compressed response decodes and context labels never reach the upstream headers", async () => {
  const s = stream();
  s.headers["content-encoding"] = "gzip";
  const p = collectObservedWire(s, { requestAccept: null, count: 1 });
  s.emit("data", gzipSync(body));
  s.emit("end");
  assert.equal((await p).rows[0].ok, true);
  const stripped = stripObservationHeaders({
    host: "127.0.0.1:3484",
    [CONTEXT_HEADER]: "producer",
    [REQUEST_HEADER]: "producer-2",
    "trpc-accept": "application/jsonl",
  });
  assert.equal(stripped.contextId, "producer");
  assert.equal(stripped.requestId, "producer-2");
  assert.equal(stripped.headers[CONTEXT_HEADER], undefined);
  assert.equal(stripped.headers[REQUEST_HEADER], undefined);
  assert.equal(stripped.headers["trpc-accept"], "application/jsonl");
  assert.equal(
    stripObservationHeaders({
      [CONTEXT_HEADER]: "consumer",
      [REQUEST_HEADER]: "producer-2",
    }).contextId,
    null,
  );
});
test("installed streaming client aborts its fetch signal after consuming a successful real-server result", async () => {
  const { initTRPC } = await import("@trpc/server");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const { createTRPCClient, httpBatchStreamLink } =
    await import("@trpc/client");
  const { default: SuperJSON } = await import("superjson");
  const t = initTRPC.create({ transformer: SuperJSON, isDev: false });
  const router = t.router({
    role: t.procedure.query(() => ({ canEditExecutive: true })),
  });
  let signal;
  const client = createTRPCClient({
    links: [
      httpBatchStreamLink({
        url: "http://fixture.invalid/trpc",
        transformer: SuperJSON,
        fetch: async (url, init) => {
          signal = init.signal;
          return fetchRequestHandler({
            endpoint: "/trpc",
            req: new Request(url, init),
            router,
            createContext: () => ({}),
          });
        },
      }),
    ],
  });
  assert.equal((await client.role.query()).canEditExecutive, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(signal.aborted, true);
});
