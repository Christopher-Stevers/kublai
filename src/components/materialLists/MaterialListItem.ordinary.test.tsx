import { StrictMode } from "react";
import type { useQueuedReceiptIntent } from "~/hooks/use-queued-receipt-intent";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MaterialListItem,
  type MaterialListItemProps,
} from "./MaterialListItem";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  receipt: vi.fn(),
  supplier: vi.fn(),
}));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({
    saveQuantity: mocks.save,
    getReplicache: () => ({ mutate: { removeItem: mocks.remove } }),
    mutateAndSync: (value: Promise<unknown>) => value,
  }),
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  resolveReplicacheSyncStatus: (pending: boolean) =>
    pending ? "pending" : "synced",
  useReplicacheSyncing: () => false,
}));
vi.mock("~/hooks/use-queued-receipt-intent", async (importOriginal) => {
  const actual = await importOriginal<{
    useQueuedReceiptIntent: typeof useQueuedReceiptIntent;
  }>();
  return {
    useQueuedReceiptIntent: (
      ...args: Parameters<typeof actual.useQueuedReceiptIntent>
    ) => {
      mocks.receipt();
      return actual.useQueuedReceiptIntent(...args);
    },
  };
});
vi.mock("./SupplierSelector", () => ({
  SupplierSelector: (props: unknown) => {
    mocks.supplier(props);
    return <span>Supplier choice</span>;
  },
}));
const item: MaterialListItemProps["item"] = {
  id: "item",
  quantity: "2",
  unitCost: null,
  extendedPrice: null,
  descriptionSnapshot: "Valve",
  partDefinition: {
    id: "part",
    displayName: "Valve",
    imageUrl: null,
    material: null,
    piecesPerPack: 1,
  },
  supplierPart: null,
  addedBy: { id: "crew", name: "Jo Smith", email: null },
  roomName: "Level 1",
};
const base = { item, materialListId: "list" };
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.receipt.mockClear();
  mocks.supplier.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("ordinary quantity edits persist immediately to their owning list and retain pending draft on rerender", async () => {
  const view = render(<MaterialListItem {...base} />);
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "9" },
  });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    materialListId: "list",
    itemId: "item",
    quantity: 9,
  });
  view.rerender(
    <MaterialListItem {...base} item={{ ...item, pendingSync: true }} />,
  );
  expect(screen.getByLabelText("Quantity")).toHaveValue("9");
  expect(
    screen.getByLabelText("Added by Jo Smith. Pending sync."),
  ).toBeVisible();
  expect(screen.getByText("Room: Level 1")).toBeVisible();
  expect(mocks.receipt).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
  });
});
it("preserves pack quantities and supplier inputs, while tools keep plain quantities and no supplier selector", () => {
  const packed = {
    ...item,
    partDefinition: {
      ...item.partDefinition!,
      piecesPerPack: 6,
      bulkUnit: "box",
      individualUnit: "pcs",
    },
    selectedSupplierId: "supplier",
  };
  const view = render(<MaterialListItem {...base} item={packed} />);
  expect(screen.getByLabelText("Quantity in box")).toBeVisible();
  expect(mocks.supplier).toHaveBeenLastCalledWith(
    expect.objectContaining({
      itemId: "item",
      materialListId: "list",
      currentSupplierId: "supplier",
      partDefinitionId: "part",
    }),
  );
  view.rerender(<MaterialListItem {...base} item={packed} isToolRequest />);
  expect(screen.getByLabelText("Quantity")).toBeVisible();
  expect(screen.getByText("Tool room")).toBeVisible();
  expect(screen.queryByText("Supplier choice")).toBeNull();
  expect(mocks.receipt).not.toHaveBeenCalled();
});
it("preserves the destructive menu and its single-flight removal guard", async () => {
  render(<MaterialListItem {...base} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "More for Valve" }), {
    key: "Enter",
  });
  const remove = await screen.findByRole("menuitem", { name: "Delete" });
  fireEvent.click(remove);
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
    materialListId: "list",
    itemId: "item",
  });
  fireEvent.keyDown(screen.getByRole("button", { name: "More for Valve" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  expect(mocks.remove).toHaveBeenCalledOnce();
});
it("sent identity or order always retains the existing receipt-capable path even without verifyMode", () => {
  const view = render(
    <MaterialListItem
      {...base}
      item={{ ...item, sentOrderItemId: "order-line" }}
    />,
  );
  expect(mocks.receipt).toHaveBeenCalled();
  expect(screen.queryByLabelText("Quantity")).toBeNull();
  mocks.receipt.mockClear();
  view.rerender(
    <MaterialListItem
      {...base}
      item={{
        ...item,
        sentOrder: {
          id: "order",
          number: "PO-1",
          status: "sent",
          quantity: "2",
          receivedQuantity: "0",
          verificationStatus: "pending",
        },
      }}
    />,
  );
  expect(mocks.receipt).toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "PO-1" })).toHaveAttribute(
    "href",
    "/jobs/material-lists/list?orderId=order",
  );
});
it("ordinary-to-receipt initializes saved values and leaving receipt cancels its ephemeral pending click", async () => {
  vi.useFakeTimers();
  const send = vi.fn(),
    pending = vi.fn();
  const view = render(
    <StrictMode>
      <MaterialListItem {...base} />
    </StrictMode>,
  );
  expect(mocks.receipt).not.toHaveBeenCalled();
  view.rerender(
    <StrictMode>
      <MaterialListItem
        {...base}
        verifyMode
        verifyOrderedQuantity="10"
        verifyInitialReceivedQuantity="4"
        onVerifyStateChange={send}
        onVerifyPendingChange={pending}
      />
    </StrictMode>,
  );
  expect(screen.getByText("Back Ordered").nextSibling).toHaveTextContent("6");
  fireEvent.click(screen.getByRole("button", { name: "Verify part" }));
  expect(pending).toHaveBeenCalledWith(true);
  view.rerender(
    <StrictMode>
      <MaterialListItem {...base} />
    </StrictMode>,
  );
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(send).not.toHaveBeenCalled();
  expect(pending).toHaveBeenLastCalledWith(false);
  expect(screen.queryByText("Received")).toBeNull();
  expect(screen.getByLabelText("Quantity")).toBeVisible();
});
it("switching away during a receipt hold releases window listeners without invoking the old owner", async () => {
  vi.useFakeTimers();
  const send = vi.fn(),
    add = vi.spyOn(window, "addEventListener"),
    remove = vi.spyOn(window, "removeEventListener");
  const view = render(
    <MaterialListItem {...base} verifyMode onVerifyStateChange={send} />,
  );
  fireEvent.touchStart(screen.getByRole("button", { name: "Verify part" }), {
    touches: [{ clientY: 100 }],
  });
  const listeners = add.mock.calls.filter(([event]) =>
    event.startsWith("touch"),
  );
  expect(listeners).toHaveLength(3);
  view.rerender(<MaterialListItem {...base} />);
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  for (const [event, listener] of listeners)
    expect(remove).toHaveBeenCalledWith(event, listener);
  expect(send).not.toHaveBeenCalled();
});
it("an account-key remount cannot retain the previous ordinary quantity draft or receipt timer", async () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const view = render(
    <MaterialListItem
      key="account-a"
      {...base}
      verifyMode
      onVerifyStateChange={send}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify part" }));
  view.rerender(<MaterialListItem key="account-b" {...base} />);
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Quantity")).toHaveValue("2");
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "7" },
  });
  view.rerender(
    <MaterialListItem key="account-c" {...base} materialListId="other-list" />,
  );
  expect(screen.getByLabelText("Quantity")).toHaveValue("2");
});
