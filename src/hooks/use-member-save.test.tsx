import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMemberSave } from "./use-member-save";

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const write = deferred(), read = deferred();
  const save = vi.fn(() => write.promise);
  const refresh = vi.fn(async () => { await read.promise; });
  const onSaved = vi.fn();
  return { ...renderHook(() => useMemberSave({ save, refresh, onSaved })), write, read, save, refresh, onSaved };
}
beforeEach(() => vi.spyOn(navigator, "onLine", "get").mockReturnValue(true));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("locks synchronously before network progress and sends a rapid double press once", async () => {
  const h = setup();
  act(() => { h.result.current.save({ permissions: "proposed" }); h.result.current.save({ permissions: "second" }); });
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(h.save).toHaveBeenCalledWith({ permissions: "proposed" });
  expect(h.result.current.phase).toBe("saving");
  expect(h.result.current.locked).toBe(true);
  expect(h.refresh).not.toHaveBeenCalled();
  await act(async () => h.write.resolve());
  expect(h.result.current.phase).toBe("refreshing");
  expect(h.onSaved).not.toHaveBeenCalled();
  await act(async () => h.read.resolve());
  expect(h.onSaved).toHaveBeenCalledOnce();
  expect(h.result.current.phase).toBe("idle");
});

it("does not dispatch or queue offline writes", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const h = setup();
  act(() => h.result.current.save({}));
  expect(h.save).not.toHaveBeenCalled();
  expect(h.result.current.error).toMatch(/Reconnect before saving/);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  expect(h.save).not.toHaveBeenCalled();
});

it("keeps an unconfirmed attempt distinct from success and requires refresh before another write", async () => {
  const h = setup();
  act(() => h.result.current.save({}));
  await act(async () => h.write.reject(new Error("connection lost")));
  expect(h.result.current.phase).toBe("needs-refresh");
  expect(h.result.current.error).toMatch(/could not be confirmed/);
  act(() => h.result.current.save({}));
  expect(h.save).toHaveBeenCalledOnce();
  act(() => { h.result.current.refresh(); h.result.current.refresh(); });
  expect(h.refresh).toHaveBeenCalledOnce();
  await act(async () => h.read.resolve());
  expect(h.result.current.phase).toBe("idle");
  expect(h.onSaved).not.toHaveBeenCalled();
});

it("reports accepted write plus failed refresh without resending the mutation", async () => {
  const h = setup();
  act(() => h.result.current.save({}));
  await act(async () => h.write.resolve());
  await act(async () => h.read.reject(new Error("read failed")));
  expect(h.result.current.error).toMatch(/^Changes saved/);
  expect(h.result.current.phase).toBe("needs-refresh");
  act(() => h.result.current.save({}));
  expect(h.save).toHaveBeenCalledOnce();
  h.refresh.mockResolvedValueOnce(undefined);
  await act(async () => h.result.current.refresh());
  expect(h.result.current.phase).toBe("idle");
  expect(h.save).toHaveBeenCalledOnce();
});

it("retains the server explanation for a known permission refusal", async () => {
  const h = setup();
  act(() => h.result.current.save({}));
  await act(async () => h.write.reject(Object.assign(new Error("Your access to manage members was removed."), { data: { code: "FORBIDDEN" } })));
  expect(h.result.current.error).toMatch(/^Your access to manage members was removed\./);
  expect(h.result.current.phase).toBe("needs-refresh");
  expect(h.refresh).not.toHaveBeenCalled();
});

it("preserves the recovery lock when offline or when the recovery read fails", async () => {
  const h = setup();
  act(() => h.result.current.save({}));
  await act(async () => h.write.reject(new Error("denied")));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => h.result.current.refresh());
  expect(h.refresh).not.toHaveBeenCalled();
  expect(h.result.current.phase).toBe("needs-refresh");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => h.result.current.refresh());
  await act(async () => h.read.reject(new Error("read denied")));
  expect(h.result.current.error).toMatch(/could not be refreshed/);
  expect(h.result.current.locked).toBe(true);
});

it.each(["success", "failure"])("ignores late %s after member/account unmount", async (outcome) => {
  const h = setup();
  act(() => h.result.current.save({}));
  h.unmount();
  await act(async () => outcome === "success" ? h.write.resolve() : h.write.reject(new Error("late")));
  expect(h.refresh).not.toHaveBeenCalled();
  expect(h.onSaved).not.toHaveBeenCalled();
});

it("does not announce a saved result after its refresh outlives the view", async () => {
  const h = setup();
  act(() => h.result.current.save({}));
  await act(async () => h.write.resolve());
  h.unmount();
  await act(async () => h.read.resolve());
  expect(h.onSaved).not.toHaveBeenCalled();
});

it("bounds a paused refresh, preserves acceptance across retries and ignores late old reads", async () => {
  vi.useFakeTimers();
  const h = setup();
  act(() => h.result.current.save({}));
  await act(async () => h.write.resolve());
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(h.result.current.phase).toBe("needs-refresh");
  expect(h.result.current.error).toMatch(/^Changes saved\./);
  expect(h.save).toHaveBeenCalledOnce();
  const second = deferred();
  h.refresh.mockImplementationOnce(async () => { await second.promise; });
  act(() => h.result.current.refresh());
  await act(async () => h.read.resolve());
  expect(h.result.current.phase).toBe("refreshing");
  expect(h.onSaved).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(h.result.current.error).toMatch(/^Changes saved\./);
  h.refresh.mockResolvedValueOnce(undefined);
  await act(async () => h.result.current.refresh());
  expect(h.onSaved).toHaveBeenCalledOnce();
  expect(h.save).toHaveBeenCalledOnce();
  expect(h.result.current.phase).toBe("idle");
});
