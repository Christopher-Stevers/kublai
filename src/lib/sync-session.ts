import type { Replicache } from "replicache";

export type SyncSessionStatus = "ready" | "refreshing" | "sign-in-required" | "connection-error";
type Binding = { userId: string | null; refresh: () => Promise<string | null> };
type Client = { status: SyncSessionStatus; retry: () => Promise<void> };
const clients = new Set<Client>();
const listeners = new Set<() => void>();
let binding: Binding | undefined;
let refresh: { binding: Binding; promise: Promise<string | null> } | undefined;

export const subscribeSyncSession = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function getSyncSessionStatus(): SyncSessionStatus {
  for (const status of ["sign-in-required", "connection-error", "refreshing"] as const)
    if ([...clients].some(client => client.status === status)) return status;
  return "ready";
}
function notify() { listeners.forEach(listener => listener()); }

/** Only the current Clerk session may supply a recovery token. Never persist it. */
export function bindSyncSession(next: Binding) {
  binding = next;
  // A completed sign-in can resume the existing database, including its outbox.
  void retrySyncSession();
  return () => { if (binding === next) binding = undefined; };
}
export async function retrySyncSession() {
  await Promise.allSettled([...clients].filter(client => client.status !== "ready").map(async client => {
    client.status = "refreshing";
    notify();
    await client.retry();
  }));
}

function freshToken(current: Binding) {
  if (refresh?.binding === current) return refresh.promise;
  let timer: ReturnType<typeof setTimeout>;
  const promise = Promise.race([
    Promise.resolve().then(() => current.refresh()),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Session refresh timed out")), 10_000);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (refresh?.promise === promise) refresh = undefined;
  });
  refresh = { binding: current, promise };
  return promise;
}

/** Preserve Replicache's request IDs, mutation IDs, parsing and acknowledgement.
 * Retry only an explicit 401, once, with fresh credentials. Never reset storage.
 */
export function attachSyncSession(rep: Pick<Replicache, "puller" | "pusher" | "pullURL" | "pushURL" | "auth" | "pull" | "push">) {
  let active = true;
  let owner = binding?.userId;
  const client: Client = {
    status: "ready",
    retry: async () => { await rep.push({ now: true }); await rep.pull({ now: true }); },
  };
  clients.add(client);
  const setStatus = (status: SyncSessionStatus) => {
    if (active && client.status !== status) { client.status = status; notify(); }
  };
  const denied = () => ({ httpRequestInfo: { httpStatusCode: 401, errorMessage: "Sign in again to sync" } });
  async function run<T extends { httpRequestInfo: { httpStatusCode: number } }>(request: (auth: string) => Promise<T>): Promise<T | ReturnType<typeof denied>> {
    if (!active) throw new Error("Sync client closed");
    // Stop repeatedly sending the same rejected requests until a fresh sign-in,
    // reconnect, return to the app, or explicit Retry gives recovery a chance.
    if (client.status === "sign-in-required") return denied();
    const current = binding;
    owner ??= current?.userId;
    if (owner && owner !== current?.userId) {
      setStatus("sign-in-required");
      return denied();
    }
    const stillCurrent = () => {
      if (!active || current !== binding) throw new Error("Sync session changed");
    };
    try {
      let result = await request(rep.auth);
      stillCurrent();
      if (result.httpRequestInfo.httpStatusCode === 401) {
        if (!current) { setStatus("connection-error"); return result; }
        setStatus("refreshing");
        const token = await freshToken(current);
        stillCurrent();
        if (!token) { setStatus("sign-in-required"); return result; }
        result = await request(`Bearer ${token}`);
        stillCurrent();
      }
      setStatus(result.httpRequestInfo.httpStatusCode === 401 ? "sign-in-required"
        : result.httpRequestInfo.httpStatusCode === 200 ? "ready" : "connection-error");
      return result;
    } catch (error) {
      if (active && current === binding) setStatus("connection-error");
      throw error;
    }
  }
  const puller = rep.puller, pusher = rep.pusher;
  rep.puller = (body, requestID) => run(async auth => auth === rep.auth ? puller(body, requestID)
    : (await import("replicache")).getDefaultPuller({ pullURL: rep.pullURL, auth })(body, requestID));
  rep.pusher = (body, requestID) => run(async auth => auth === rep.auth ? pusher(body, requestID)
    : (await import("replicache")).getDefaultPusher({ pushURL: rep.pushURL, auth })(body, requestID));
  return () => { active = false; clients.delete(client); notify(); };
}
