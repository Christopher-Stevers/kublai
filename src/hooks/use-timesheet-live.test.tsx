import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LiveCallbacks } from "~/lib/live-client";
import { useTimesheetLive } from "./use-timesheet-live";
const m = vi.hoisted(() => ({
  active: true,
  authority: {} as object,
  listeners: [] as LiveCallbacks[],
  stop: vi.fn(),
}));
vi.mock("~/lib/live-client", () => ({
  subscribeLiveEvents: vi.fn((_options: unknown, callbacks: LiveCallbacks) => {
    m.listeners.push(callbacks);
    return m.stop;
  }),
}));
vi.mock("~/lib/app-page-activity", () => ({ isAppPageActive: () => m.active }));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => m.authority,
}));
beforeEach(() => {
  vi.useFakeTimers();
  m.active = true;
  m.authority = {};
  m.listeners = [];
  m.stop.mockClear();
  vi.stubGlobal("EventSource", class {});
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = () =>
  act(async () => {
    vi.advanceTimersByTime(100);
  });
function setup(refresh = vi.fn(async () => undefined)) {
  const view = renderHook(
    ({ online, account, authorityScope }) =>
      useTimesheetLive({
        online,
        expectedAccount: account,
        authorityScope,
        refresh,
      }),
    {
      initialProps: {
        online: true,
        account: "org:actor",
        authorityScope: "worker",
      },
    },
  );
  return { ...view, refresh, listener: m.listeners[0]! };
}
it("coalesces hint/reset/connect catch-up without adding an interval", async () => {
  const h = setup();
  h.listener.status?.(true);
  h.listener.catchUp?.();
  h.listener.hint({ topic: "timesheets", version: 1 });
  h.listener.catchUp?.();
  await tick();
  expect(h.refresh).toHaveBeenCalledOnce();
  await act(async () => {
    vi.advanceTimersByTime(120000);
  });
  expect(h.refresh).toHaveBeenCalledOnce();
  h.listener.hint({ topic: "chat", version: 1 });
  await tick();
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("runs at most one trailing refresh for hints arriving during a pending read", async () => {
  let resolve!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const h = setup(refresh);
  h.listener.status?.(true);
  h.listener.catchUp?.();
  await tick();
  h.listener.hint({ topic: "timesheets", version: 2 });
  h.listener.hint({ topic: "timesheets", version: 3 });
  await act(async () => resolve());
  await tick();
  expect(refresh).toHaveBeenCalledTimes(2);
});
it.each(["hidden", "offline", "authority", "unmount"])(
  "drops pending work on %s and never refreshes the replaced actor",
  async (reason) => {
    const h = setup();
    h.listener.status?.(true);
    h.listener.catchUp?.();
    if (reason === "hidden") m.active = false;
    if (reason === "offline")
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    if (reason === "authority") m.authority = {};
    if (reason === "unmount") h.unmount();
    await tick();
    expect(h.refresh).not.toHaveBeenCalled();
  },
);
it("unsubscribes on account/authority-view changes and offline, reconnect catches up", async () => {
  const h = setup();
  h.listener.status?.(true);
  h.listener.catchUp?.();
  h.rerender({ online: true, account: "org:other", authorityScope: "manager" });
  h.listener.hint({ topic: "timesheets", version: 2 });
  await tick();
  expect(h.refresh).not.toHaveBeenCalled();
  expect(m.stop).toHaveBeenCalledOnce();
  const next = m.listeners[1]!;
  next.status?.(true);
  next.catchUp?.();
  await tick();
  expect(h.refresh).toHaveBeenCalledOnce();
  h.rerender({
    online: false,
    account: "org:other",
    authorityScope: "manager",
  });
  expect(m.stop).toHaveBeenCalledTimes(2);
});
it("catches synchronous and asynchronous read failures without granting authority", async () => {
  const refresh = vi
    .fn()
    .mockImplementationOnce(() => {
      throw Error("refused");
    })
    .mockRejectedValueOnce(Error("offline"));
  const h = setup(refresh);
  h.listener.status?.(true);
  h.listener.catchUp?.();
  await tick();
  h.listener.catchUp?.();
  await tick();
  expect(refresh).toHaveBeenCalledTimes(2);
});
