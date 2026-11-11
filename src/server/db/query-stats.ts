import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request database query counter. Every query is a network round trip
 * to Postgres, so the count is the best predictor of endpoint latency.
 */
export type QueryStats = {
  count: number;
  databaseMs: number;
  parent?: QueryStats;
};

const storage = new AsyncLocalStorage<QueryStats>();

export function withQueryStats<T>(fn: () => Promise<T>) {
  // Nested scopes (e.g. a script timing a whole tRPC call) all see the query.
  const stats: QueryStats = {
    count: 0,
    databaseMs: 0,
    parent: storage.getStore(),
  };
  return storage.run(stats, async () => ({ result: await fn(), stats }));
}

/** Capture the request scope before a lazy database query starts. */
export function startDatabaseTimer() {
  const scope = storage.getStore();
  if (!scope) return () => undefined;
  const start = performance.now();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const duration = performance.now() - start;
    for (let stats: QueryStats | undefined = scope; stats; stats = stats.parent)
      stats.databaseMs += duration;
  };
}

export function recordQuery() {
  for (let stats = storage.getStore(); stats; stats = stats.parent) {
    stats.count += 1;
  }
}
