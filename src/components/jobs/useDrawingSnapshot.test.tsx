import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DrawingOfflineStore } from "~/lib/drawing-offline";
import { useDrawingSnapshot } from "./useDrawingSnapshot";
const state = vi.hoisted(() => ({
  account: {
    accountKey: "org:alice",
    store: { saveSnapshot: vi.fn(async () => undefined) },
  },
}));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not read a large legacy snapshot online and restores it when actually offline", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const read = vi.fn(async (_store: DrawingOfflineStore, _key: string) => ({
    rooms: ["saved"],
  }));
  const hook = renderHook(() => useDrawingSnapshot("floor-a", undefined, read));
  expect(read).not.toHaveBeenCalled();
  expect(hook.result.current.data).toBeUndefined();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });
  await waitFor(() =>
    expect(hook.result.current.data).toEqual({ rooms: ["saved"] }),
  );
  expect(hook.result.current.loading).toBe(false);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(hook.result.current.data).toBeUndefined(); // no stale offline fallback for permission/network errors online
});

it("never shows the previous floor while the next floor's saved data loads", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  let finish!: (value: { id: string }) => void;
  const read = vi.fn(async (_store: DrawingOfflineStore, key: string) =>
    key === "a"
      ? { id: "a" }
      : new Promise<{ id: string }>((resolve) => {
          finish = resolve;
        }),
  );
  const hook = renderHook(({ id }) => useDrawingSnapshot(id, undefined, read), {
    initialProps: { id: "a" },
  });
  await waitFor(() => expect(hook.result.current.data).toEqual({ id: "a" }));
  hook.rerender({ id: "b" });
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.loading).toBe(true);
  await act(async () => {
    finish({ id: "b" });
  });
  expect(hook.result.current.data).toEqual({ id: "b" });
});


it("opens locally while the browser still reports online, then applies live updates and access revocation", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const read = vi.fn(async () => ({ id: "saved" }));
  const hook = renderHook(({ live, revoked }: { live: { id: string } | undefined; revoked: boolean }) =>
    useDrawingSnapshot("drawing", live, read, { localFirst: true, accessRevoked: revoked }),
    { initialProps: { live: undefined, revoked: false } });
  await waitFor(() => expect(hook.result.current.data).toEqual({ id: "saved" }));
  hook.rerender({ live: { id: "updated" }, revoked: false });
  expect(hook.result.current.data).toEqual({ id: "updated" });
  hook.rerender({ live: { id: "updated" }, revoked: true });
  expect(hook.result.current.data).toBeUndefined();
});
