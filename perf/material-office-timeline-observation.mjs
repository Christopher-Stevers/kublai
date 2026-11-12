// No observer of DOM changes, geometry reads or continuous RAF loop.
export function installOfficeObservation(target) {
  if (!(target instanceof Element) || !target.isConnected)
    throw Error("Actual locator target required");
  const owner = target.closest('[data-slot="card"],button,a') ?? target;
  const events = [],
    longTasks = [],
    eventTiming = [];
  let stopped = false,
    dropped = 0;
  const push = (a, x) => {
    if (a.length < 100) a.push(x);
    else dropped++;
  };
  const record = (e) => {
    if (e.isTrusted && e.target instanceof Node && owner.contains(e.target)) {
      push(events, {
        type: e.type,
        eventTimeStamp: e.timeStamp,
        at: performance.now(),
        trusted: e.isTrusted,
        targetIsLocator: e.target === target,
      });
      performance.mark("office-timeline:" + e.type);
    }
  };
  const names = ["pointerdown", "pointerup", "pointercancel", "click"];
  for (const n of names) document.addEventListener(n, record, true);
  const observers = [];
  for (const type of ["longtask", "event"]) {
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes(type))
      continue;
    const handle = (entries) => {
      for (const e of entries) {
        const row = {
          name: e.name,
          startTime: e.startTime,
          duration: e.duration,
        };
        if (type === "event")
          Object.assign(row, {
            processingStart: e.processingStart,
            processingEnd: e.processingEnd,
            interactionId: e.interactionId,
          });
        push(type === "event" ? eventTiming : longTasks, row);
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
  window.__officeTimeline = {
    finish() {
      if (!stopped) {
        stopped = true;
        for (const n of names) document.removeEventListener(n, record, true);
        for (const { observer, handle } of observers) {
          handle(observer.takeRecords());
          observer.disconnect();
        }
      }
      return {
        timeOrigin: performance.timeOrigin,
        observedAt: performance.now(),
        events,
        longTasks,
        eventTiming,
        dropped,
        supportedEntryTypes: PerformanceObserver.supportedEntryTypes ?? [],
        measures: performance
          .getEntriesByType("measure")
          .filter((e) => e.name === "foremenhq:tap-to-paint")
          .map((e) => ({
            name: e.name,
            startTime: e.startTime,
            duration: e.duration,
            endTime: e.startTime + e.duration,
          })),
      };
    },
  };
}
