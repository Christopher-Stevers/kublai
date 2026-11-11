/** Supplemental passive listeners only. No DOM readiness observer, RAF loop,
 * geometry reads during input, prototype patches, scrolling or app changes. */
export function installFailedCellObservation({ target, input }) {
  if (!(target instanceof Element) || !target.isConnected)
    throw Error("Diagnostic target missing");
  if (input && !(input instanceof HTMLInputElement))
    throw Error("Diagnostic input invalid");
  const own = input && Object.getOwnPropertyDescriptor(input, "value");
  const descriptor =
    input &&
    (own ??
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"));
  if (
    input &&
    (!descriptor?.get || !descriptor.set || (own && !own.configurable))
  )
    throw Error("Input setter unsupported");
  const owner = target.closest('button,[data-slot="card"]') ?? target;
  const data = {
    events: [],
    commits: [],
    longTasks: [],
    eventTiming: [],
    dropped: 0,
    supportedEntryTypes: PerformanceObserver.supportedEntryTypes ?? [],
  };
  let stopped = false,
    firstEvent = null;
  const push = (array, row) => {
    if (array.length < 100) array.push(row);
    else data.dropped++;
  };
  const record = (event) => {
    if (
      !event.isTrusted ||
      !(event.target instanceof Node) ||
      !owner.contains(event.target)
    )
      return;
    const at = performance.now();
    firstEvent ??= at;
    push(data.events, {
      type: event.type,
      at,
      eventTimeStamp: event.timeStamp,
      trusted: true,
      targetIsPressOwner: event.target === owner,
      targetIsOriginalLocator: event.target === target,
    });
    performance.mark("failed-cells-diagnostic:" + event.type);
  };
  const names = ["pointerdown", "pointerup", "pointercancel", "click"];
  for (const name of names) document.addEventListener(name, record, true);
  const observers = [];
  for (const type of ["longtask", "event"]) {
    if (!data.supportedEntryTypes.includes(type)) continue;
    const handle = (entries) => {
      for (const entry of entries) {
        const row = {
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        };
        if (type === "event")
          Object.assign(row, {
            processingStart: entry.processingStart,
            processingEnd: entry.processingEnd,
            interactionId: entry.interactionId,
          });
        push(type === "event" ? data.eventTiming : data.longTasks, row);
      }
    };
    const observer = new PerformanceObserver((list) =>
      handle(list.getEntries()),
    );
    observer.observe(
      type === "event" ? { type, durationThreshold: 16 } : { type },
    );
    observers.push({ observer, handle });
  }
  if (input)
    Object.defineProperty(input, "value", {
      ...descriptor,
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        const before = descriptor.get.call(this);
        descriptor.set.call(this, value);
        const after = descriptor.get.call(this);
        if (before !== after) {
          push(data.commits, {
            at: performance.now(),
            before: Number(before),
            after: Number(after),
            afterTrustedInput: firstEvent !== null,
          });
          performance.mark("failed-cells-diagnostic:input-property");
        }
      },
    });
  window.__failedCellsDiagnostic = {
    finish() {
      if (!stopped) {
        stopped = true;
        for (const name of names)
          document.removeEventListener(name, record, true);
        for (const { observer, handle } of observers) {
          handle(observer.takeRecords());
          observer.disconnect();
        }
        if (input) {
          if (own) Object.defineProperty(input, "value", own);
          else delete input.value;
        }
      }
      return {
        ...data,
        targetConnected: target.isConnected,
        inputConnected: input?.isConnected ?? null,
      };
    },
  };
}

/** Exact idempotent one-item allowance; no body is retained in reports. */
export function quantityPushIdentity(body, permission, latched) {
  if (
    !permission ||
    !Array.isArray(body?.mutations) ||
    body.mutations.length !== 1
  )
    return null;
  const mutation = body.mutations[0];
  if (
    mutation.name !== "updateItemQuantity" ||
    mutation.args?.itemId !== permission.itemId ||
    mutation.args?.materialListId !== permission.materialListId ||
    mutation.args?.quantity !== permission.quantity ||
    !Object.keys(mutation.args).every((key) =>
      ["itemId", "materialListId", "quantity", "token"].includes(key),
    ) ||
    !Number.isSafeInteger(mutation.id) ||
    mutation.id < 1 ||
    typeof mutation.clientID !== "string"
  )
    return null;
  const identity = JSON.stringify([
    mutation.id,
    mutation.clientID,
    mutation.name,
    mutation.args,
  ]);
  return latched === null || latched === identity ? identity : null;
}
export function assertNavigationPreconditions(state) {
  if (
    !state.targetVisible ||
    !state.targetEnabled ||
    state.destinationVisible ||
    state.pathname !== state.expectedPathname
  )
    throw Error("Navigation diagnostic source precondition failed");
}
export function assertCaptureBounds(
  elapsedMs,
  cpuBytes,
  traceBytes,
  priorBytes,
) {
  if (
    elapsedMs > 3000 ||
    cpuBytes > 5 * 1024 ** 2 ||
    traceBytes > 20 * 1024 ** 2 ||
    priorBytes + cpuBytes + traceBytes > 250 * 1024 ** 2
  )
    throw Error("Diagnostic capture/artifact bound");
}
