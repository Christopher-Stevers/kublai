import { act, cleanup, renderHook } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatJoin } from "./use-chat-join";
const state = vi.hoisted(() => ({ authority: {} as object, active: true }));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/lib/app-page-activity", () => ({
  isAppPageActive: () => state.active,
}));
const dispatch = vi.fn<() => Promise<unknown>>(),
  refresh = vi.fn<() => Promise<unknown>>(),
  readMembership = vi.fn<() => Promise<{ joined: boolean }>>(),
  onError = vi.fn();
const options = {
  identity: "actor:job",
  canStart: () => true,
  dispatch,
  refresh,
  readMembership,
  onError,
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.authority = {};
  state.active = true;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  dispatch.mockResolvedValue({});
  refresh.mockResolvedValue(undefined);
  readMembership.mockResolvedValue({ joined: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("latches same-turn calls and releases accepted ACK without waiting for refresh", async () => {
  const request = deferred<unknown>();
  dispatch.mockReturnValue(request.promise);
  refresh.mockReturnValue(new Promise(() => undefined));
  const { result } = renderHook(() => useChatJoin(options));
  let first!: Promise<void>;
  act(() => {
    first = result.current.run();
    void result.current.run();
  });
  expect(result.current.pending).toBe(true);
  await act(async () => {
    await Promise.resolve();
  });
  expect(dispatch).toHaveBeenCalledOnce();
  await act(async () => {
    request.resolve({});
    await first;
  });
  expect(result.current.pending).toBe(false);
  expect(refresh).toHaveBeenCalledOnce();
  expect(readMembership).not.toHaveBeenCalled();
});
it.each(["offline", "authority", "activity"])(
  "does not dispatch or replay after admission loses %s",
  async (mode) => {
    const { result } = renderHook(() => useChatJoin(options));
    await act(async () => {
      const run = result.current.run();
      if (mode === "offline")
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          value: false,
        });
      if (mode === "authority") state.authority = {};
      if (mode === "activity") state.active = false;
      await run;
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    state.active = true;
    await act(async () => Promise.resolve());
    expect(dispatch).not.toHaveBeenCalled();
  },
);
it("checks unknown ACK before another explicit join; a failed check never resends", async () => {
  dispatch.mockRejectedValue(Error("ACK lost"));
  readMembership.mockRejectedValue(Error("offline"));
  const { result } = renderHook(() => useChatJoin(options));
  await act(async () => result.current.run());
  expect(result.current.needsCheck).toBe(true);
  expect(dispatch).toHaveBeenCalledOnce();
  await act(async () => result.current.run());
  expect(dispatch).toHaveBeenCalledOnce();
  expect(readMembership).toHaveBeenCalledTimes(2);
  readMembership.mockResolvedValue({ joined: false });
  await act(async () => result.current.run());
  expect(result.current.needsCheck).toBe(false);
  expect(dispatch).toHaveBeenCalledOnce();
  dispatch.mockResolvedValue({});
  await act(async () => result.current.run());
  expect(dispatch).toHaveBeenCalledTimes(2);
});
it("does not leak an old actor failure or read through its replacement", async () => {
  const request = deferred<unknown>();
  dispatch.mockReturnValue(request.promise);
  const { result, rerender } = renderHook(
    ({ identity }) => useChatJoin({ ...options, identity }),
    { initialProps: { identity: "one" } },
  );
  let run!: Promise<void>;
  act(() => {
    run = result.current.run();
  });
  await act(async () => Promise.resolve());
  rerender({ identity: "two" });
  await act(async () => {
    request.reject(Error("old"));
    await run;
  });
  expect(onError).not.toHaveBeenCalled();
  expect(readMembership).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("Activity hide/resume fences old completion and allows a new attempt", async () => {
  const request = deferred<unknown>();
  dispatch.mockReturnValueOnce(request.promise);
  let hidden = false;
  function Wrapper({ children }: { children: ReactNode }) {
    return <Activity mode={hidden ? "hidden" : "visible"}>{children}</Activity>;
  }
  const { result, rerender } = renderHook(() => useChatJoin(options), {
    wrapper: Wrapper,
  });
  let run!: Promise<void>;
  act(() => {
    run = result.current.run();
  });
  await act(async () => Promise.resolve());
  hidden = true;
  rerender();
  hidden = false;
  rerender();
  expect(result.current.pending).toBe(false);
  await act(async () => {
    request.reject(Error("old"));
    await run;
  });
  expect(onError).not.toHaveBeenCalled();
  await act(async () => result.current.run());
  expect(dispatch).toHaveBeenCalledTimes(2);
});
it("bounds unknown membership read and cancels its deadline on unmount", async () => {
  vi.useFakeTimers();
  dispatch.mockRejectedValue(Error("ACK lost"));
  readMembership.mockReturnValue(new Promise(() => undefined));
  const { result, unmount } = renderHook(() => useChatJoin(options));
  let run!: Promise<void>;
  await act(async () => {
    run = result.current.run();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.pending).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
    await run;
  });
  expect(result.current.pending).toBe(false);
  expect(result.current.needsCheck).toBe(true);
  expect(dispatch).toHaveBeenCalledOnce();
  await act(async () => {
    run = result.current.run();
    await Promise.resolve();
  });
  unmount();
  await act(async () => run);
  expect(vi.getTimerCount()).toBe(0);
  expect(dispatch).toHaveBeenCalledOnce();
});
it("never joins or requests membership while already offline", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  const { result } = renderHook(() => useChatJoin(options));
  await act(async () => result.current.run());
  expect(dispatch).not.toHaveBeenCalled();
  expect(readMembership).not.toHaveBeenCalled();
  expect(result.current.pending).toBe(false);
});

it("a synchronous refresh failure cannot turn a confirmed join into an unknown write", async () => {
  refresh.mockImplementation(() => {
    throw Error("read failed");
  });
  const { result } = renderHook(() => useChatJoin(options));
  await act(async () => result.current.run());
  expect(result.current.needsCheck).toBe(false);
  expect(readMembership).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("clears uncertain-ACK text after a fresh read proves membership without resending", async () => {
  dispatch.mockRejectedValue(Error("ACK lost"));
  readMembership.mockResolvedValue({ joined: true });
  const { result } = renderHook(() => useChatJoin(options));
  await act(async () => result.current.run());
  expect(dispatch).toHaveBeenCalledOnce();
  expect(result.current.needsCheck).toBe(false);
  expect(onError).toHaveBeenLastCalledWith("");
});

it.each(["identity", "authority"])(
  "%s replacement admits new work and old completion cannot clear its lock",
  async (mode) => {
    const old = deferred<unknown>(),
      next = deferred<unknown>();
    dispatch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(
      ({ identity }) => useChatJoin({ ...options, identity }),
      { initialProps: { identity: "one" } },
    );
    let first!: Promise<void>, second!: Promise<void>;
    act(() => {
      first = result.current.run();
    });
    await act(async () => Promise.resolve());
    if (mode === "authority") state.authority = {};
    rerender({ identity: mode === "identity" ? "two" : "one" });
    expect(result.current.pending).toBe(false);
    expect(result.current.needsCheck).toBe(false);
    act(() => {
      second = result.current.run();
    });
    await act(async () => Promise.resolve());
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.current.pending).toBe(true);
    await act(async () => {
      old.reject(Error("old actor"));
      await first;
    });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);
    await act(async () => result.current.run());
    expect(dispatch).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.resolve({});
      await second;
    });
    expect(result.current.pending).toBe(false);
  },
);
it("authority replacement drops uncertain check state and cancels the obsolete read deadline", async () => {
  dispatch.mockRejectedValueOnce(Error("ACK lost"));
  readMembership.mockReturnValue(new Promise(() => undefined));
  const { result, rerender } = renderHook(() => useChatJoin(options));
  let old!: Promise<void>;
  await act(async () => {
    old = result.current.run();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.needsCheck).toBe(true);
  state.authority = {};
  rerender();
  await act(async () => old);
  expect(result.current.pending).toBe(false);
  expect(result.current.needsCheck).toBe(false);
  dispatch.mockResolvedValue({});
  await act(async () => result.current.run());
  expect(dispatch).toHaveBeenCalledTimes(2);
});
it("accepted ACK while offline releases pending without a fresh read or fake membership", async () => {
  const ack = deferred<unknown>();
  dispatch.mockReturnValue(ack.promise);
  const { result } = renderHook(() => useChatJoin(options));
  let work!: Promise<void>;
  act(() => {
    work = result.current.run();
  });
  await act(async () => Promise.resolve());
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  await act(async () => {
    ack.resolve({});
    await work;
  });
  expect(result.current.pending).toBe(false);
  expect(result.current.needsCheck).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
  expect(readMembership).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
