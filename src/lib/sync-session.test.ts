import { afterEach, expect, it, vi } from "vitest";
import { getDefaultPuller, getDefaultPusher, type WriteTransaction } from "replicache";
import { attachSyncSession, bindSyncSession, getSyncSessionStatus, retrySyncSession } from "./sync-session";
const cleanups: Array<() => void> = [];
const body = { pullVersion: 1 as const, profileID: "profile", clientGroupID: "group", cookie: null, schemaVersion: "v1" };
const pushBody = { pushVersion: 1 as const, profileID: "profile", clientGroupID: "group", schemaVersion: "v1", mutations: [{ id: 1, name: "setQuantity", args: { quantity: 3 }, timestamp: 1, clientID: "client" }] };
const ok = () => Response.json({ cookie: "next", lastMutationIDChanges: {}, patch: [] });
function client() {
  const rep = {
    auth: "", pullURL: "https://example.test/pull", pushURL: "https://example.test/push",
    puller: getDefaultPuller({ pullURL: "https://example.test/pull", auth: "" }),
    pusher: getDefaultPusher({ pushURL: "https://example.test/push", auth: "" }),
    pull: vi.fn(async () => { await rep.puller(body, "pull-id"); }),
    push: vi.fn(async () => { await rep.pusher(pushBody, "push-id"); }),
  };
  const detach = attachSyncSession(rep); cleanups.push(detach);
  return { rep, detach };
}
function session(refresh = vi.fn(async (): Promise<string | null> => "fresh-test-token"), userId = "user-a") {
  const unbind = bindSyncSession({ userId, refresh }); cleanups.push(unbind);
  return refresh;
}
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["pull", "push"] as const)("retries a rejected %s once with a fresh token and identical request IDs/body", async kind => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(ok());
  vi.stubGlobal("fetch", fetch);
  const refresh = session(); const { rep } = client();
  await rep[kind]();
  expect(refresh).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
  const first = fetch.mock.calls[0]![0] as Request, second = fetch.mock.calls[1]![0] as Request;
  expect(second.headers.get("authorization")).toBe("Bearer fresh-test-token");
  expect(second.headers.get("x-replicache-requestid")).toBe(first.headers.get("x-replicache-requestid"));
  expect(await second.text()).toBe(await first.text());
  expect(rep.auth).toBe("");
  expect(getSyncSessionStatus()).toBe("ready");
});
it("shares one session refresh across catalogue and material requests", async () => {
  let finish!: (value: string) => void;
  const refresh = session(vi.fn(() => new Promise<string>(resolve => { finish = resolve; })));
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => request.headers.get("authorization")?.startsWith("Bearer ") ? ok() : Response.json({}, { status: 401 })));
  const a = client(), b = client();
  const attempts = Promise.all([a.rep.pull(), b.rep.pull()]);
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(getSyncSessionStatus()).toBe("refreshing");
  finish("token"); await attempts;
  expect(getSyncSessionStatus()).toBe("ready");
});
it("stops rejected background requests, then retries the existing outbox after recovery", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 401 })); vi.stubGlobal("fetch", fetch);
  const refresh = session(vi.fn(async (): Promise<string | null> => null)); const { rep } = client();
  await rep.push(); expect(getSyncSessionStatus()).toBe("sign-in-required");
  await rep.pull(); await rep.push(); expect(fetch).toHaveBeenCalledOnce();
  refresh.mockResolvedValue("fresh"); fetch.mockImplementation(async (request: Request) => request.headers.get("authorization")?.startsWith("Bearer ") ? ok() : Response.json({}, { status: 401 }));
  await retrySyncSession();
  expect(rep.push).toHaveBeenCalledTimes(3); expect(getSyncSessionStatus()).toBe("ready");
  const requests = await Promise.all(fetch.mock.calls.map(async ([r]) => JSON.parse(await (r as Request).text()) as typeof pushBody));
  expect(requests.filter(r => r.pushVersion).every(r => r.mutations[0]?.id === 1)).toBe(true);
});
it("does not loop when fresh credentials are also rejected", async () => {
  const fetch = vi.fn(async () => Response.json({}, { status: 401 })); vi.stubGlobal("fetch", fetch);
  const refresh = session(); const { rep } = client();
  await rep.pull(); await rep.pull();
  expect(refresh).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
  expect(getSyncSessionStatus()).toBe("sign-in-required");
});
it.each([403, 500])("does not reauthenticate or retry HTTP %s", async status => {
  const fetch = vi.fn(async () => Response.json({}, { status })); vi.stubGlobal("fetch", fetch);
  const refresh = session(); const { rep } = client(); await rep.push();
  expect(fetch).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
  expect(getSyncSessionStatus()).toBe("connection-error");
});
it("reports a lost connection without claiming sign-in expired", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const refresh = session(); const { rep } = client(); await expect(rep.pull()).rejects.toThrow();
  expect(refresh).not.toHaveBeenCalled(); expect(getSyncSessionStatus()).toBe("connection-error");
});
it("times out a stalled session refresh without getting stuck reconnecting", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 401 })));
  session(vi.fn(() => new Promise<string>(() => {}))); const { rep } = client();
  const attempt = expect(rep.pull()).rejects.toThrow("Session refresh timed out");
  await vi.advanceTimersByTimeAsync(10_001); await attempt;
  expect(getSyncSessionStatus()).toBe("connection-error");
});
it("ignores a late recovery and does not replay edits under another account", async () => {
  let finish!: (value: string) => void;
  const refresh = session(vi.fn(() => new Promise<string>(resolve => { finish = resolve; })));
  const fetch = vi.fn(async () => Response.json({}, { status: 401 })); vi.stubGlobal("fetch", fetch);
  const { rep } = client(); const attempt = expect(rep.push()).rejects.toThrow("Sync session changed");
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  session(vi.fn(async () => "other-token"), "user-b"); finish("old-token"); await attempt;
  await rep.push(); expect(fetch).toHaveBeenCalledOnce(); expect(getSyncSessionStatus()).toBe("sign-in-required");
});
it("a successful catalogue request cannot clear a material-list failure", async () => {
  session(vi.fn(async (): Promise<string | null> => null));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValue(ok()));
  const a = client(), b = client(); await a.rep.push(); await b.rep.pull();
  expect(getSyncSessionStatus()).toBe("sign-in-required"); a.detach(); expect(getSyncSessionStatus()).toBe("ready");
});

it("holds an existing outbox while its session is unbound", async () => {
  const unbind = bindSyncSession({ userId: "user-a", refresh: async () => "token" });
  cleanups.push(unbind);
  const { rep } = client();
  const fetch = vi.fn(async () => ok()); vi.stubGlobal("fetch", fetch);
  unbind();
  await rep.push();
  expect(fetch).not.toHaveBeenCalled();
  expect(getSyncSessionStatus()).toBe("sign-in-required");
});

it("keeps a real Replicache mutation queued through sign-in failure and acknowledges it once after recovery", async () => {
  const { Replicache } = await import("replicache");
  const rep = new Replicache({ name: crypto.randomUUID(), kvStore: "mem", pullInterval: null, pushDelay: 60_000,
    mutators: { setQuantity: async (tx: WriteTransaction, quantity: number) => { await tx.put("quantity", quantity); } },
  });
  let permitted = false;
  const applied = new Map<string, number>();
  const fetch = vi.fn(async (request: Request) => {
    if (!permitted) return Response.json({}, { status: 401 });
    const input = JSON.parse(await request.text()) as typeof pushBody;
    if (input.pushVersion) {
      for (const m of input.mutations) applied.set(m.clientID, m.id);
      return Response.json({});
    }
    return Response.json({ cookie: "received", lastMutationIDChanges: Object.fromEntries(applied), patch: [{ op: "put", key: "quantity", value: 7 }] });
  });
  vi.stubGlobal("fetch", fetch);
  session(vi.fn(async (): Promise<string | null> => null));
  try {
    await rep.mutate.setQuantity(7);
    const pending = await rep.experimentalPendingMutations();
    expect(pending).toHaveLength(1);
    rep.pullURL = "https://example.test/pull"; rep.pushURL = "https://example.test/push";
    const detach = attachSyncSession(rep); cleanups.push(detach);
    await rep.push({ now: true });
    expect(getSyncSessionStatus()).toBe("sign-in-required");
    expect(await rep.experimentalPendingMutations()).toEqual(pending);
    expect(await rep.query(tx => tx.get("quantity"))).toBe(7);
    permitted = true;
    await retrySyncSession();
    await vi.waitFor(async () => expect(await rep.experimentalPendingMutations()).toEqual([]));
    expect([...applied.values()]).toEqual([1]);
    expect(await rep.query(tx => tx.get("quantity"))).toBe(7);
  } finally { await rep.close(); }
});
