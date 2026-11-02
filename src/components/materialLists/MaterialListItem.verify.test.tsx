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
