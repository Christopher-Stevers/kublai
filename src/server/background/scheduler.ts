/** Bounded round-robin admission across features; a busy feature cannot fill both slots. */
export function backgroundScheduler(
  jobs: Array<{ name: string; run: () => Promise<void> }>,
  limit = 2,
  onError: (name: string) => void = () => undefined,
) {
  const active = new Map<string, Promise<void>>();
  let cursor = 0,
    stopped = false;
  return {
    tick() {
      if (stopped) return;
      for (
        let attempts = 0;
        attempts < jobs.length && active.size < limit;
        attempts++
      ) {
        const job = jobs[cursor++ % jobs.length]!;
        if (active.has(job.name)) continue;
        const work = Promise.resolve()
          .then(job.run)
          .catch(() => onError(job.name))
          .finally(() => {
            active.delete(job.name);
          });
        active.set(job.name, work);
      }
    },
    stop() {
      stopped = true;
      return Promise.allSettled(active.values());
    },
    active: () => [...active.keys()],
  };
}
