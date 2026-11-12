import test from "node:test";
import assert from "node:assert/strict";
import {
  projectApiTrace,
  decodeTraceFiles,
  requestPath,
  allowReadRequest,
} from "./material-office-timeline-records.mjs";
test("API phases preserve clocks/call association but strip payloads/errors/log content", () => {
  const rows = projectApiTrace([
    {
      type: "before",
      callId: "call@1",
      startTime: 100,
      class: "Frame",
      method: "click",
      params: { headers: { secret: 1 }, postData: "body" },
      apiName: "secret",
    },
    { type: "input", callId: "call@1" },
    {
      type: "after",
      callId: "call@1",
      endTime: 130,
      result: { secret: 1 },
      error: { message: "secret" },
    },
    { type: "event", params: { headers: "secret" } },
  ]);
  assert.deepEqual(rows, [
    {
      type: "before",
      callId: "call@1",
      startTime: 100,
      class: "Frame",
      method: "click",
    },
    { type: "input", callId: "call@1" },
    { type: "after", callId: "call@1", endTime: 130 },
  ]);
});
test("request metadata strips queries/IDs/origin and write guard rejects nonempty push", () => {
  assert.equal(
    requestPath(
      "http://localhost:3485/api/trpc/job.get?input=secret",
      "http://localhost:3485",
    ),
    "/api/trpc/job.get",
  );
  assert.equal(
    requestPath(
      "http://localhost:3485/jobs/private-id",
      "http://localhost:3485",
    ),
    "/other",
  );
  for (const mutations of [[], [{}]])
    assert.equal(
      allowReadRequest(
        {
          url: () => "http://localhost:3485/api/replicache/material-lists/push",
          method: () => "POST",
          postDataJSON: () => ({ mutations }),
        },
        "http://localhost:3485",
      ),
      mutations.length === 0,
    );
  assert.equal(
    allowReadRequest(
      { url: () => "http://production/api/perf", method: () => "POST" },
      "http://localhost:3485",
    ),
    false,
  );
});

test("installed trace envelope keeps clock anchor and classifies fixed actionability log only", () =>
  assert.deepEqual(
    projectApiTrace([
      {
        type: "context-options",
        monotonicTime: 100,
        wallTime: 1000,
        options: { secret: 1 },
      },
      {
        type: "log",
        callId: "x",
        time: 120,
        message: "waiting for element to be visible, enabled and stable",
      },
    ]),
    [
      { type: "context-options", monotonicTime: 100, wallTime: 1000 },
      { type: "log", callId: "x", time: 120, logKind: "actionability" },
    ],
  ));

test("real installed trace shapes decode only with empty network and complete phases", () => {
  const text = [
    { type: "context-options", monotonicTime: 10, wallTime: 100 },
    {
      type: "before",
      callId: "call@1",
      startTime: 20,
      class: "Frame",
      method: "click",
      params: { selector: "internal-text=synthetic" },
    },
    { type: "input", callId: "call@1", point: { x: 1, y: 2 } },
    {
      type: "log",
      callId: "call@1",
      time: 30,
      message: "performing click action",
    },
    { type: "after", callId: "call@1", endTime: 40 },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  assert.equal(decodeTraceFiles(text, Buffer.alloc(0)).length, 5);
  assert.throws(() => decodeTraceFiles(text, Buffer.from("headers body")));
  assert.throws(() => decodeTraceFiles("{}", Buffer.alloc(0)));
  assert.throws(() => decodeTraceFiles("{invalid", Buffer.alloc(0)));
});
