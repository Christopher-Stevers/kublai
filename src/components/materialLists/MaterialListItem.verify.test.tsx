import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MaterialListItem } from "./MaterialListItem";
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({}),
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  resolveReplicacheSyncStatus: () => "synced",
  useReplicacheSyncing: () => false,
}));
vi.mock("./QuantityControls", () => ({ QuantityControls: () => null }));
vi.mock("./SupplierSelector", () => ({ SupplierSelector: () => null }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const item = {
  id: "i",
  sentOrderItemId: "oi",
  quantity: "10",
  unitCost: null,
  extendedPrice: null,
  descriptionSnapshot: "Valve",
  partDefinition: null,
  supplierPart: null,
};

it("shows an ordered part as a verify card that takes a tap", () => {
  vi.useFakeTimers();
  const onVerifyStateChange = vi.fn();
  render(
    <MaterialListItem
      item={item}
      materialListId="m"
      verifyMode
      verifyOrderedQuantity="10"
      verifyInitialReceivedQuantity="4"
      verifyCaption={<a href="/order">PO-1</a>}
      onVerifyStateChange={onVerifyStateChange}
    />,
  );
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("6");
  expect(screen.getByRole("link", { name: "PO-1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Verify part" }));
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onVerifyStateChange).toHaveBeenCalledWith({
    receivedQuantity: 10,
    verificationStatus: "complete",
  });
});

it("shows the verify card without taps for members who cannot receive", () => {
  render(
    <MaterialListItem
      item={item}
      materialListId="m"
      verifyMode
      verifyReadOnly
      verifyOrderedQuantity="10"
      verifyInitialReceivedQuantity="4"
    />,
  );
  expect(screen.getByText("Received")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Verify part" })).toBeNull();
});

it("keeps an untouched order awaiting delivery", () => {
  render(<MaterialListItem item={item} materialListId="m" verifyMode verifyInitialReceivedQuantity="0" />);
  expect(screen.queryByText("Back Ordered")).not.toBeInTheDocument();
  expect(screen.getByText("Awaiting delivery").nextSibling).toHaveTextContent("10");
});

it("marks an unreceived line back ordered once another line on its order is received", () => {
  const { rerender } = render(<MaterialListItem item={item} materialListId="m" verifyMode verifyInitialReceivedQuantity="0" />);
  rerender(<MaterialListItem item={item} materialListId="m" verifyMode verifyInitialReceivedQuantity="0" orderHasReceipts />);
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("10");
  rerender(<MaterialListItem item={item} materialListId="m" verifyMode verifyInitialReceivedQuantity="0" orderHasReceipts={false} />);
  expect(screen.queryByText("Back Ordered")).not.toBeInTheDocument();
  expect(screen.getByText("Awaiting delivery")).toBeInTheDocument();
});

it("starts receiving again from the saved counts when they change", () => {
  const { rerender } = render(
    <MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4" />,
  );
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("6");
  rerender(
    <MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity="7" />,
  );
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("3");
});

it("restores the saved receipt after a failed edit even when saved counts have not changed", () => {
  vi.useFakeTimers();
  const card = (revision: number) => <MaterialListItem item={item} materialListId="m" verifyMode
    verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4" verifyResetVersion={revision} />;
  const { rerender } = render(card(0));
  fireEvent.click(screen.getByRole("button", { name: "Verify part" }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("0");
  rerender(card(1));
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("6");
});

it("lets go of the window when a card goes away in the middle of a hold", () => {
  vi.useFakeTimers();
  const added = new Set<unknown>();
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const card = (received: string) => (
    <MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity={received} onVerifyStateChange={() => undefined} />
  );
  const { rerender, unmount } = render(card("4"));
  fireEvent.touchStart(screen.getByRole("button", { name: "Verify part" }), { touches: [{ clientY: 100 }] });
  for (const [type, listener] of add.mock.calls) if (type.startsWith("touch")) added.add(listener);
  expect(added.size).toBe(3);
  // A redraw gives the card new handlers before it goes away.
  rerender(card("5"));
  unmount();
  const removed = new Set<unknown>(remove.mock.calls.filter(([type]) => type.startsWith("touch")).map(([, listener]) => listener));
  for (const listener of added) expect(removed.has(listener)).toBe(true);
  add.mockRestore();
  remove.mockRestore();
});

it("blocks bulk during a delayed single tap and preserves cancellation on removal", async () => {
  vi.useFakeTimers();
  const { createReceiptIntentGate } = await import("~/lib/receipt-intent-gate");
  const gate = createReceiptIntentGate(), send = vi.fn();
  const view = render(<MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4"
    onVerifyStateChange={send} onVerifyPendingChange={active => gate.change("oi", active)} />);
  fireEvent.click(screen.getByRole("button", { name: "Verify part" }));
  expect(gate.tryStartBulk(false)).toBe(false); expect(send).not.toHaveBeenCalled();
  view.unmount();
  expect(send).not.toHaveBeenCalled();
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(send).not.toHaveBeenCalled(); expect(gate.hasQueued()).toBe(false);
});

it("replaces a delayed single tap with one double-tap problem intent", async () => {
  vi.useFakeTimers(); const send = vi.fn(), pending = vi.fn();
  render(<MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4"
    onVerifyStateChange={send} onVerifyPendingChange={pending} />);
  const card = screen.getByRole("button", { name: "Verify part" });
  fireEvent.click(card); fireEvent.click(card);
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(send).toHaveBeenCalledExactlyOnceWith({ receivedQuantity: 4, verificationStatus: "problem" });
  expect(pending.mock.calls).toEqual([[true], [false]]);
});

it("does not start a delayed single tap after read-only changes", () => {
  vi.useFakeTimers(); const send = vi.fn();
  const card = (locked: boolean) => <MaterialListItem item={item} materialListId="m" verifyMode verifyReadOnly={locked}
    verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4" onVerifyStateChange={send} />;
  const view = render(card(false)); view.rerender(card(true));
  fireEvent.click(screen.getByText("Valve"));
  act(() => vi.runAllTimers()); expect(send).not.toHaveBeenCalled();
});


it("dispatches keyboard completion and problem changes once under StrictMode", () => {
  vi.useFakeTimers(); const send = vi.fn();
  render(<StrictMode><MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4" onVerifyStateChange={send} /></StrictMode>);
  const card = screen.getByRole("button", { name: "Verify part" });
  fireEvent.keyDown(card, { key: "Enter" });
  expect(send).toHaveBeenCalledExactlyOnceWith({ receivedQuantity: 10, verificationStatus: "complete" });
  send.mockClear();
  fireEvent.click(card);
  fireEvent.click(card);
  act(() => vi.runAllTimers());
  expect(send).toHaveBeenCalledExactlyOnceWith({ receivedQuantity: 10, verificationStatus: "problem" });
});

it("rejects a same-turn card click or keyboard action after bulk starts, before readOnly rerenders", async () => {
  vi.useFakeTimers(); const { createReceiptIntentGate } = await import("~/lib/receipt-intent-gate");
  const gate = createReceiptIntentGate(), send = vi.fn();
  render(<MaterialListItem item={item} materialListId="m" verifyMode verifyOrderedQuantity="10" verifyInitialReceivedQuantity="4"
    canStartReceipt={gate.canStartReceipt} onVerifyStateChange={send} />);
  const card = screen.getByRole("button", { name: "Verify part" });
  expect(gate.tryStartBulk(false)).toBe(true);
  fireEvent.click(card); fireEvent.keyDown(card, { key: "Enter" });
  act(() => vi.runAllTimers()); expect(send).not.toHaveBeenCalled();
});
