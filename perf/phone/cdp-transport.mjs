// Direct, explicitly owned target transport. Never discovers other targets.
export class CdpTransportError extends Error {
  constructor(kind, method, code) {
    super(`Page CDP ${kind}${method ? `: ${method}` : ""}`);
    this.name = "CdpTransportError";
    this.kind = kind;
    this.method = method;
    if (Number.isInteger(code)) this.code = code;
  }
}

export function createCdpConnection(
  socket,
  {
    timeoutMs = 30_000,
    openTimeoutMs = 10_000,
    eventNames = [],
    observe = () => {},
    timers = globalThis,
  } = {},
) {
  let nextId = 0,
    opened = false,
    terminal,
    intentionalClose = false;
  const pending = new Map();
  const allowedEvents = new Set(eventNames);
  let resolveOpen, rejectOpen;
  const ready = new Promise((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  const openTimer = timers.setTimeout(
    () => fail(new CdpTransportError("open-timeout")),
    openTimeoutMs,
  );
  function fail(error) {
    if (terminal) return;
    terminal = error;
    timers.clearTimeout(openTimer);
    if (!opened) rejectOpen(error);
    for (const call of pending.values()) {
      timers.clearTimeout(call.timer);
      call.reject(new CdpTransportError(error.kind, call.method, error.code));
    }
    pending.clear();
  }
  socket.addEventListener(
    "open",
    () => {
      if (terminal) return;
      opened = true;
      timers.clearTimeout(openTimer);
      resolveOpen();
    },
    { once: true },
  );
  socket.addEventListener("close", (event) => {
    observe({
      kind: "socket-close",
      intentional: intentionalClose,
      ...(Number.isInteger(event.code) ? { code: event.code } : {}),
    });
    fail(new CdpTransportError("socket-closed"));
  });
  socket.addEventListener("error", () => {
    observe({ kind: "socket-error", intentional: intentionalClose });
    fail(new CdpTransportError("socket-error"));
  });
  socket.addEventListener("message", ({ data }) => {
    if (terminal) return;
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      fail(new CdpTransportError("invalid-message"));
      return;
    }
    if (!message || typeof message !== "object") {
      fail(new CdpTransportError("invalid-message"));
      return;
    }
    const call = pending.get(message.id);
    if (!call) {
      if (allowedEvents.has(message.method))
        observe({ kind: "event", name: message.method });
      return; // Event payloads, unknown replies and other events are discarded.
    }
    pending.delete(message.id);
    timers.clearTimeout(call.timer);
    if (message.error) {
      call.reject(
        new CdpTransportError("command-error", call.method, message.error.code),
      );
    } else call.resolve(message.result);
  });
  return {
    ready,
    get pendingCount() {
      return pending.size;
    },
    send(method, params = {}, commandTimeoutMs = timeoutMs) {
      if (terminal)
        return Promise.reject(new CdpTransportError(terminal.kind, method));
      if (!opened)
        return Promise.reject(new CdpTransportError("not-open", method));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = timers.setTimeout(() => {
          pending.delete(id);
          reject(new CdpTransportError("timeout", method));
        }, commandTimeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch {
          fail(new CdpTransportError("send-failed", method));
        }
      });
    },
    close() {
      if (intentionalClose) return;
      intentionalClose = true;
      fail(new CdpTransportError("runner-closed"));
      try {
        socket.close();
      } catch {
        /* Already closed; pending calls are settled. */
      }
    },
  };
}
