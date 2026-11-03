import { onBackgroundHint } from "./hints";

/** Packing slips are read while someone waits on the Receive screen, so they
 * never queue behind other features and take none of their slots. They start
 * when one is queued, and the next starts as soon as one is read. */
const WAITED_ON = new Set(["packing-slips"]);

/** Bounded round-robin admission across features; a busy feature cannot fill both slots. */
export function backgroundScheduler(
  /** A run resolving true found work, and a waited-on feature looks again. */
  jobs: Array<{ name: string; run: () => Promise<unknown> }>,
  limit = 2,
  onError: (name: string) => void = () => undefined,
) {
  const active = new Map<string, Promise<void>>();
  let cursor = 0,
    stopped = false;
  const start = (job: (typeof jobs)[number]) => {
    const work = Promise.resolve()
      .then(job.run)
      .then(
        (found) => found === true,
        () => {
          onError(job.name);
          return false;
        },
      )
      .then((found) => {
        active.delete(job.name);
        if (found && WAITED_ON.has(job.name) && !stopped) start(job);
      });
    active.set(job.name, work);
  };
  const busy = () =>
    [...active.keys()].filter((name) => !WAITED_ON.has(name)).length;
  const unsubscribe = onBackgroundHint((hint) => {
    if (hint.topic !== "work" || stopped || active.has(hint.feature)) return;
    const job = jobs.find((j) => j.name === hint.feature);
    if (job) start(job);
  });
  return {
    tick() {
      if (stopped) return;
      for (const job of jobs)
        if (WAITED_ON.has(job.name) && !active.has(job.name)) start(job);
      for (
        let attempts = 0;
        attempts < jobs.length && busy() < limit;
        attempts++
      ) {
        const job = jobs[cursor++ % jobs.length]!;
        if (active.has(job.name) || WAITED_ON.has(job.name)) continue;
        start(job);
      }
    },
    stop() {
      stopped = true;
      unsubscribe();
      return Promise.allSettled(active.values());
    },
    active: () => [...active.keys()],
  };
}
