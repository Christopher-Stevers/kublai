import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useQueuedReceiptIntent } from "./use-queued-receipt-intent";
import { createReceiptIntentGate } from "~/lib/receipt-intent-gate";
import { useTableReceive } from "~/components/materialLists/TableReceive";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("blocks bulk throughout debounce, reschedules and the microtask handoff to a real request", async () => {
  vi.useFakeTimers();
  const gate = createReceiptIntentGate();
  let requestPending = false;
  const send = vi.fn(() =>
    queueMicrotask(() => {
      requestPending = true;
    }),
  );
  const { result } = renderHook(() =>
    useQueuedReceiptIntent((active) => gate.change("line", active)),
  );
  act(() => result.current.schedule(send, 500));
  expect(gate.tryStartBulk(requestPending)).toBe(false);
  act(() => {
    vi.advanceTimersByTime(200);
    result.current.schedule(send, 500);
  });
  await act(async () => {
    await vi.runAllTicks();
  });
  expect(gate.tryStartBulk(requestPending)).toBe(false);
  act(() => vi.advanceTimersByTime(500));
  expect(send).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.runAllTicks();
  });
  expect(gate.hasQueued()).toBe(false);
  expect(gate.tryStartBulk(requestPending)).toBe(false);
  requestPending = false;
  expect(gate.tryStartBulk(requestPending)).toBe(true);
  expect(gate.tryStartBulk(false)).toBe(false);
  gate.finishBulk();
  expect(gate.tryStartBulk(false)).toBe(true);
});

it("flushes an authorized table intent exactly once on removal", async () => {
  vi.useFakeTimers();
  const gate = createReceiptIntentGate(),
    send = vi.fn();
  const hook = renderHook(() =>
    useTableReceive({
      ordered: 10,
      received: 2,
      status: "partial",
      onChange: send,
      onPendingChange: (active) => gate.change("line", active),
    }),
  );
  act(() => hook.result.current.step(1));
  expect(gate.tryStartBulk(false)).toBe(false);
  hook.unmount();
  expect(send).toHaveBeenCalledExactlyOnceWith({
    receivedQuantity: 3,
    verificationStatus: "partial",
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(send).toHaveBeenCalledOnce();
  expect(gate.hasQueued()).toBe(false);
});

it("prevents stale table callbacks and focused-input blur from scheduling after bulk locks controls", () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const hook = renderHook(
    ({ locked }) =>
      useTableReceive({
        ordered: 10,
        received: 2,
        status: "partial",
        readOnly: locked,
        onChange: send,
      }),
    { initialProps: { locked: false } },
  );
  act(() => hook.result.current.setText("7"));
  const stale = hook.result.current;
  hook.rerender({ locked: true });
  act(() => {
    stale.step(1);
    stale.toggleAll();
    stale.toggleProblem();
    stale.commitText();
    vi.runAllTimers();
  });
  expect(send).not.toHaveBeenCalled();
  expect(hook.result.current.received).toBe(2);
});

it("rejects same-turn table intents immediately after bulk starts, before readOnly rerenders", () => {
  vi.useFakeTimers();
  const gate = createReceiptIntentGate(),
    send = vi.fn();
  const hook = renderHook(() =>
    useTableReceive({
      ordered: 10,
      received: 2,
      status: "partial",
      onChange: send,
      canStartReceipt: gate.canStartReceipt,
    }),
  );
  const stale = hook.result.current;
  expect(gate.tryStartBulk(false)).toBe(true);
  act(() => {
    stale.step(1);
    stale.toggleAll();
    stale.toggleProblem();
    vi.runAllTimers();
  });
  expect(send).not.toHaveBeenCalled();
  expect(hook.result.current.received).toBe(2);
});

it("rejects offline bulk dispatch without reserving a reconnect replay", () => {
  const gate = createReceiptIntentGate();
  expect(gate.tryStartBulk(false, false)).toBe(false);
  expect(gate.canStartReceipt()).toBe(true);
  expect(gate.tryStartBulk(false, true)).toBe(true);
});
