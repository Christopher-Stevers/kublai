vi.mock("~/lib/replicache-material-list", () => ({ requestMaterialListReplicacheSync: vi.fn() }));
vi.mock("~/components/materialLists/DeliveryCalendarSettings", () => ({ DeliveryCalendarSettings: () => null }));
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
  resend: vi.fn(),
  loadDraft: vi.fn(),
  permitted: true,
  online: true,
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => state.online,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      materialList: {
        previewOrders: { fetch: state.fetch, invalidate: vi.fn() },
        getOrdersForMaterialList: { invalidate: vi.fn() },
        listOrders: { invalidate: vi.fn() },
        getOrderEmailContent: { fetch: state.loadDraft },
      },
      assets: { listRequests: { invalidate: vi.fn() } },
    }),
    user: {
      getMyRole: {
        useQuery: () => ({
          isLoading: false,
          data: { permissions: { can: { "orders.send": state.permitted } } },
        }),
      },
    },
    materialList: {
      undoOrder: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      sendGeneratedOrder: { useMutation: () => ({ mutateAsync: state.save }) },
      markOrderSent: { useMutation: () => ({ mutateAsync: state.resend }) },
      listOrders: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              id: "sent-order",
              notes: "note",
              sentTo: "orders@example.com",
              orderNumber: "ORDER-001",
              job: { id: "job", name: "Job" },
              supplier: { id: "supplier", name: "Pipe Supply", contacts: [] },
              materialList: { name: "List" },
              createdAt: new Date(),
            },
          ],
        }),
      },
    },
  },
}));
vi.mock("~/hooks/use-offline-documents", () => ({
  useOfflineOrders: (data: unknown) => ({
    data,
    cacheLoaded: true,
    isOfflineFallback: false,
  }),
}));
import OrdersPage from "~/app/dashboard/orders/page";
import { OrdersPreviewSheet } from "./OrdersPreviewSheet";
const order = {
  id: "possible-supplier",
  supplierId: "supplier",
  notes: "",
  supplier: {
    id: "supplier",
    name: "Pipe Supply",
    contactEmail: "orders@example.com",
  },
  items: [
    {
      id: "item",
      quantity: "2",
      descriptionSnapshot: "Pipe",
      supplierSkuSnapshot: "P1",
    },
  ],
  email: {
    to: ["orders@example.com"],
    cc: ["buyer@example.com"],
    subject: "Pipe order",
    body: "2 x Pipe\nDeliver Friday",
  },
};
let launched: Array<{ url: string; target: string }>;
beforeEach(() => {
  state.permitted = true;
  state.online = true;
  state.fetch.mockReset().mockResolvedValue({ possible: [order], sent: [] });
  state.save.mockReset().mockResolvedValue({ id: "sent-order" });
  state.resend.mockReset().mockResolvedValue(undefined);
  state.loadDraft.mockReset().mockResolvedValue(order.email);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  launched = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    launched.push({ url: this.href, target: this.target });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function show(tool = false) {
  render(
    <OrdersPreviewSheet
      open
      onOpenChange={vi.fn()}
      materialListId="list"
      isToolRequest={tool}
    />,
  );
  return screen.findByRole("button", { name: "Send" });
}
describe("supplier email handoff", () => {
  it("launches the edited native draft in the tap before a slow save finishes, and ignores repeat taps", async () => {
    let finish!: (value: { id: string }) => void;
    state.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const send = await show();
    fireEvent.click(screen.getByRole("button", { name: "Pipe Supply" }));
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "one@example.com, two@example.com" },
    });
    fireEvent.change(screen.getByLabelText("CC"), {
      target: { value: "changed@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Urgent pipe" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "Edited\nbody" },
    });
    fireEvent.change(screen.getByLabelText("Internal Notes"), {
      target: { value: "Save this note" },
    });
    fireEvent.click(send);
    expect(launched).toHaveLength(1);
    expect(launched[0]?.target).toBe("_self");
    expect(decodeURIComponent(launched[0]!.url)).toBe(
      "mailto:one@example.com,two@example.com?subject=Urgent pipe&body=Edited\nbody&cc=changed@example.com",
    );
    expect(state.save).toHaveBeenCalledWith({
      materialListId: "list",
      supplierId: "supplier",
      sentTo: "one@example.com, two@example.com",
      notes: "Save this note",
    });
    fireEvent.click(send);
    expect(state.save).toHaveBeenCalledOnce();
    await act(async () => finish({ id: "sent-order" }));
  });
  it.each(["not-an-email", ""])(
    "does not open email or save an invalid recipient %s",
    async (value) => {
      const send = await show();
      fireEvent.click(screen.getByRole("button", { name: "Pipe Supply" }));
      fireEvent.change(screen.getByLabelText("To"), {
        target: { value },
      });
      fireEvent.click(send);
      expect(
        screen.getByText(/Enter at least one valid To email/),
      ).toBeInTheDocument();
      expect(launched).toEqual([]);
      expect(state.save).not.toHaveBeenCalled();
    },
  );
  it("reports a failed save and keeps the order available rather than displaying Sent", async () => {
    state.save.mockRejectedValue(new Error("The order could not be saved."));
    fireEvent.click(await show());
    await screen.findByText("The order could not be saved.");
    expect(screen.queryByText("Sent", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
  it("reopens a previously saved draft without creating another order", async () => {
    state.fetch.mockResolvedValue({
      possible: [],
      sent: [{ ...order, id: "sent-order", sentAt: new Date() }],
    });
    render(
      <OrdersPreviewSheet open onOpenChange={vi.fn()} materialListId="list" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open email" }));
    expect(launched).toHaveLength(1);
    expect(state.save).not.toHaveBeenCalled();
  });
  it("keeps tool requests in-app and sends them without a mail link", async () => {
    state.permitted = false;
    fireEvent.click(await show(true));
    await waitFor(() =>
      expect(state.save).toHaveBeenCalledWith({
        materialListId: "list",
        supplierId: "supplier",
        sentTo: "Tool room",
        notes: undefined,
      }),
    );
    expect(launched).toEqual([]);
  });
  it("cannot launch a supplier email without order permission", () => {
    state.permitted = false;
    render(
      <OrdersPreviewSheet open onOpenChange={vi.fn()} materialListId="list" />,
    );
    expect(screen.getByText("Not Allowed")).toBeInTheDocument();
    expect(launched).toEqual([]);
    expect(state.fetch).not.toHaveBeenCalled();
  });
});

describe("saved order email handoff", () => {
  it("prepares an unopened draft, then launches on a fresh tap before a slow resend save finishes", async () => {
    let finish!: () => void;
    state.resend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<OrdersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare email" }));
    const resend = await screen.findByRole("button", {
      name: "Resend",
    });
    expect(state.loadDraft).toHaveBeenCalledOnce();
    expect(launched).toEqual([]);
    expect(state.resend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Changed resend" },
    });
    fireEvent.click(resend);
    expect(launched).toHaveLength(1);
    expect(decodeURIComponent(launched[0]!.url)).toContain(
      "subject=Changed resend",
    );
    expect(state.resend).toHaveBeenCalledWith({
      orderId: "sent-order",
      sentTo: "orders@example.com",
      notes: "note",
    });
    fireEvent.click(resend);
    expect(state.resend).toHaveBeenCalledOnce();
    await act(async () => finish());
  });
  it("cannot resend or open email without permission", () => {
    state.permitted = false;
    render(<OrdersPage />);
    const button = screen.getByRole("button", { name: "Prepare email" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(launched).toEqual([]);
    expect(state.resend).not.toHaveBeenCalled();
  });
});
