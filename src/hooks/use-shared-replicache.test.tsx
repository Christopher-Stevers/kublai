import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Replicache } from "replicache";
import { createSharedReplicacheReader } from "./use-shared-replicache";

it("shares one subscription, delivers updates to all consumers, and releases the last listener", () => {
  let deliver: (n: number) => void = () => {};
  const stop = vi.fn();
  const subscribe = vi.fn(
    (_read: unknown, { onData }: { onData: (value: number) => void }) => {
      deliver = onData;
      return stop;
    },
  );
  const rep = { subscribe } as unknown as Replicache;
  const warmed = vi.fn();
  const useRead = createSharedReplicacheReader(async () => 1, 0, warmed);
  const first = renderHook(() => useRead(rep));
  const second = renderHook(() => useRead(rep));
  expect(subscribe).toHaveBeenCalledTimes(1);
  act(() => deliver(7));
  expect(first.result.current).toBe(7);
  expect(second.result.current).toBe(7);
  expect(warmed).toHaveBeenCalledTimes(1);
  first.unmount();
  expect(stop).not.toHaveBeenCalled();
  second.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
  const again = renderHook(() => useRead(rep));
  expect(subscribe).toHaveBeenCalledTimes(2);
  act(() => deliver(9));
  expect(again.result.current).toBe(9);
  again.unmount();
});
