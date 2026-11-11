// Pure in-memory transport tests: no browser, fetch, ADB, sockets or app server.
import test from "node:test";
import assert from "node:assert/strict";
import { createCdpConnection } from "./cdp-transport.mjs";

class MockSocket extends EventTarget {
  sent = [];
  closeCalls = 0;
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closeCalls++;
    this.emit("close", { code: 1000, reason: "private reason" });
  }
  emit(type, fields = {}) {
    this.dispatchEvent(Object.assign(new Event(type), fields));
  }
  reply(value) {
    this.emit("message", { data: JSON.stringify(value) });
  }
}
function fixture(options = {}) {
  let id = 0;
  const active = new Map();
  const timers = {
    setTimeout(callback) {
      active.set(++id, callback);
      return id;
    },
    clearTimeout(key) {
      active.delete(key);
    },
  };
  const socket = new MockSocket();
  const observations = [];
  const connection = createCdpConnection(socket, {
    ...options,
    timers,
    observe: (event) => observations.push(event),
  });
  return {
    socket,
    connection,
    active,
    observations,
    expire() {
      const callbacks = [...active.values()];
      active.clear();
      callbacks.forEach((fn) => fn());
    },
  };
}
async function opened(options) {
  const f = fixture(options);
  f.socket.emit("open");
  await f.connection.ready;
  assert.equal(f.active.size, 0);
  return f;
}

test("post-open close rejects every pending command and clears their timers", async () => {
  const f = await opened();
  const a = assert.rejects(f.connection.send("Page.navigate"), {
    kind: "socket-closed",
    method: "Page.navigate",
  });
  const b = assert.rejects(f.connection.send("Runtime.evaluate"), {
    kind: "socket-closed",
  });
  assert.equal(f.connection.pendingCount, 2);
  f.socket.emit("close", { code: 1006, reason: "private URL or message" });
  await Promise.all([a, b]);
  assert.equal(f.connection.pendingCount, 0);
  assert.equal(f.active.size, 0);
  assert.deepEqual(f.observations, [
    { kind: "socket-close", intentional: false, code: 1006 },
  ]);
  await assert.rejects(f.connection.send("Page.enable"), {
    kind: "socket-closed",
  });
});

test("socket error rejects pending calls immediately with no event payload", async () => {
  const f = await opened();
  const rejected = assert.rejects(f.connection.send("Page.navigate"), {
    kind: "socket-error",
  });
  f.socket.emit("error", { message: "private message" });
  await rejected;
  assert.equal(f.active.size, 0);
  assert.equal(f.connection.pendingCount, 0);
  assert.deepEqual(f.observations, [
    { kind: "socket-error", intentional: false },
  ]);
});

test("protocol rejection keeps numeric error code and omits private error text", async () => {
  const f = await opened();
  const result = f.connection.send("Page.navigate");
  const rejected = assert.rejects(
    result,
    (error) =>
      error.kind === "command-error" &&
      error.code === -32000 &&
      !error.message.includes("PRIVATE"),
  );
  f.socket.reply({
    id: 1,
    error: { code: -32000, message: "PRIVATE", data: "PRIVATE" },
  });
  await rejected;
  assert.equal(f.active.size, 0);
  assert.equal(f.connection.pendingCount, 0);
  f.connection.close();
});

test("command timeout removes pending entry, ignores late reply and allows cleanup", async () => {
  const f = await opened();
  const rejected = assert.rejects(f.connection.send("Page.navigate"), {
    kind: "timeout",
  });
  f.expire();
  await rejected;
  f.socket.reply({ id: 1, result: { ignored: "PRIVATE" } });
  assert.equal(f.connection.pendingCount, 0);
  assert.equal(f.active.size, 0);
  f.connection.close();
  assert.equal(f.socket.closeCalls, 1);
});

test("explicit cleanup settles pending calls and only whitelisted event names escape", async () => {
  const f = await opened({ eventNames: ["Page.frameNavigated"] });
  f.socket.reply({ method: "Page.frameNavigated", params: { url: "PRIVATE" } });
  f.socket.reply({
    method: "Runtime.consoleAPICalled",
    params: { text: "PRIVATE" },
  });
  const rejected = assert.rejects(f.connection.send("Runtime.evaluate"), {
    kind: "runner-closed",
  });
  f.connection.close();
  await rejected;
  assert.equal(f.connection.pendingCount, 0);
  assert.equal(f.active.size, 0);
  assert.deepEqual(f.observations, [
    { kind: "event", name: "Page.frameNavigated" },
    { kind: "socket-close", intentional: true, code: 1000 },
  ]);
});

test("open timeout and synchronous send failure leave no pending timers", async () => {
  const opening = fixture();
  const openRejected = assert.rejects(opening.connection.ready, {
    kind: "open-timeout",
  });
  opening.expire();
  await openRejected;
  opening.connection.close();
  assert.equal(opening.active.size, 0);
  const f = await opened();
  f.socket.send = () => {
    throw Error("PRIVATE");
  };
  await assert.rejects(f.connection.send("Page.enable"), {
    kind: "send-failed",
  });
  assert.equal(f.connection.pendingCount, 0);
  assert.equal(f.active.size, 0);
  f.connection.close();
});
