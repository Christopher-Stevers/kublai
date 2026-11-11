import { hashKey, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";

export interface InstantChange<T> {
  commit?: (result: T) => void;
  rollback: () => void;
  finish?: () => void;
}

const active = new WeakMap<QueryClient, Set<string>>();
const pendingQueries = new WeakSet<object>();
export const isInstantQueryPending = (query: object) => pendingQueries.has(query);

/** A short-lived optimistic edit, not an offline queue. Lock one cached record
 * until its request settles, so two failed edits cannot restore one another.
 * A refresh, eviction or account wipe supersedes the snapshot: rollback must
 * never overwrite it or bring private data back after sign-out. */
export function beginInstantQueryUpdate<T, TResult = unknown>(
  client: QueryClient,
  queryKey: QueryKey,
  update: (previous: T) => T,
  reconcile?: (result: TResult, current: T) => T,
): InstantChange<TResult> {
  const hash = hashKey(queryKey);
  let locks = active.get(client);
  if (!locks) {
    locks = new Set();
    active.set(client, locks);
  }
  if (locks.has(hash)) throw new Error("This change is still being saved.");
  locks.add(hash);
  const query: Query | undefined = client.getQueryCache().find({ queryKey, exact: true });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    locks.delete(hash);
    if (query) {
      pendingQueries.delete(query);
      // Notify the persistence subscriber after the marker clears. An accepted
      // response may not alter the optimistic value, but it is now safe to save.
      if (client.getQueryCache().find({ queryKey, exact: true }) === query)
        client.setQueryData(queryKey, client.getQueryData(queryKey));
    }
  };

  // Query cancellation reverts synchronously; do it before taking the snapshot.
  // Do not wait for transport cancellation before showing the user's edit.
  void client.cancelQueries({ queryKey, exact: true });
  if (query) pendingQueries.add(query);
  const previous = client.getQueryData<T>(queryKey);
  let optimistic: T | undefined;
  try {
    if (previous !== undefined) optimistic = client.setQueryData<T>(queryKey, update(previous));
  } catch (error) {
    finish();
    throw error;
  }
  const stillOwned = () => !finished && previous !== undefined &&
    client.getQueryCache().find({ queryKey, exact: true }) === query &&
    client.getQueryData<T>(queryKey) === optimistic;

  return {
    rollback: () => {
      if (stillOwned()) client.setQueryData(queryKey, previous);
    },
    commit: (result) => {
      if (stillOwned() && reconcile && optimistic !== undefined) {
        client.setQueryData(queryKey, reconcile(result, optimistic));
      }
    },
    finish,
  };
}
