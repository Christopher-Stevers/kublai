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
vi.mock("~/hooks/use-supplier-email-preference",()=>({useSupplierEmailPreference:()=>({includeSupplierSku:false,disabled:false,set:vi.fn()})}));
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
    jobPricing: {requestApproval:{useMutation:()=>({isPending:false,mutate:vi.fn()})}},
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
              supplier: { id: "supplier", name: "Pipe Supply (Standard)", contacts: [] },
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
import OrdersPage from "~/app/jobs/orders/page";
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
      priceBookNameSnapshot: "Standard", supplierSkuSnapshot: "P1",
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
      orderedItemIds={["second", "first"]}
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
      orderedItemIds: ["second", "first"],
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
    await screen.findByText(/The order could not be saved\./);
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
    const send = await show(true);
    const toggle = screen.getByRole("button", { name: /Tool Room/ });
    fireEvent.click(toggle);
    fireEvent.change(
      screen.getByPlaceholderText(
        "Note for the tool room (needed by, drop-off, etc.)",
      ),
      { target: { value: "Needed Friday at the job trailer" } },
    );
    fireEvent.click(toggle);
    expect(screen.queryByText("Pipe", { exact: true })).not.toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(
      screen.getByPlaceholderText(
        "Note for the tool room (needed by, drop-off, etc.)",
      ),
    ).toHaveValue("Needed Friday at the job trailer");
    fireEvent.click(send);
    await waitFor(() =>
      expect(state.save).toHaveBeenCalledWith({
        orderedItemIds: ["second", "first"],
        materialListId: "list",
        supplierId: "supplier",
        sentTo: "Tool room",
        notes: "Needed Friday at the job trailer",
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

describe("preview send acknowledgement", () => {
  it("latches same-turn tool taps and visibly blocks every send while pending", async () => {
    let finish!: (value: { id: string }) => void;
    state.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    state.fetch.mockResolvedValue({ possible: [
      { ...order, isToolRequest: true },
      { ...order, id: "second-order", supplierId: "second-supplier" },
    ], sent: [] });
    render(<OrdersPreviewSheet open onOpenChange={vi.fn()} materialListId="list" hasToolItems />);
    const buttons = await screen.findAllByRole("button", { name: "Send", exact: true });
    act(() => {
      buttons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(state.save).toHaveBeenCalledOnce();
    expect(launched).toEqual([]);
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await act(async () => finish({ id: "accepted-request" }));
  });

  it("keeps edited email fields on unknown outcome and does not replay the attempt", async () => {
    state.save.mockRejectedValue(new Error("Connection lost"));
    const send = await show();
    fireEvent.click(screen.getByRole("button", { name: "Pipe Supply" }));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "draft@example.com" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Retained subject" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Retained body" } });
    fireEvent.change(screen.getByLabelText("Internal Notes"), { target: { value: "Retained note" } });
    fireEvent.click(send);
    await screen.findByText(/could not confirm the order was saved/);
    expect(screen.getByText(/Check Orders and your email app before trying again/)).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toHaveValue("draft@example.com");
    expect(screen.getByLabelText("Subject")).toHaveValue("Retained subject");
    expect(screen.getByLabelText("Email")).toHaveValue("Retained body");
    expect(screen.getByLabelText("Internal Notes")).toHaveValue("Retained note");
    expect(launched).toHaveLength(1);
    expect(state.save).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  });

  it("distinguishes an acknowledged order from a failed preview refresh", async () => {
    state.fetch.mockResolvedValueOnce({ possible: [order], sent: [] }).mockRejectedValue(new Error("Preview unavailable"));
    fireEvent.click(await show());
    await screen.findByText(/The order was saved, but this preview could not refresh/);
    expect(screen.getByText(/Email delivery is not confirmed here/)).toBeInTheDocument();
    expect(state.save).toHaveBeenCalledOnce();
    expect(launched).toHaveLength(1);
  });

  it("keeps a tool note on an unconfirmed request without retrying", async () => {
    state.save.mockRejectedValue(new Error("Connection lost"));
    const send = await show(true);
    fireEvent.click(screen.getByRole("button", { name: /Tool Room/ }));
    const note = screen.getByPlaceholderText("Note for the tool room (needed by, drop-off, etc.)");
    fireEvent.change(note, { target: { value: "Keep this delivery note" } });
    fireEvent.click(send);
    await screen.findByText(/could not confirm this tool request was saved/);
    expect(note).toHaveValue("Keep this delivery note");
    expect(screen.getByText(/Check Requests before trying again/)).toBeInTheDocument();
    expect(state.save).toHaveBeenCalledOnce();
    expect(launched).toEqual([]);
  });

  it("distinguishes a saved tool request from failed refresh", async () => {
    state.fetch.mockResolvedValueOnce({ possible: [order], sent: [] }).mockRejectedValue(new Error("Preview unavailable"));
    fireEvent.click(await show(true));
    await screen.findByText(/The tool request was saved, but this preview could not refresh/);
    expect(state.save).toHaveBeenCalledOnce();
    expect(launched).toEqual([]);
  });

  it("does not persist or retry when the native email handoff throws", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementationOnce(() => { throw new Error("Mail app unavailable"); });
    fireEvent.click(await show());
    await screen.findByText(/The email draft could not be opened/);
    expect(state.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  });

  it("preserves explicit Close while retaining the pending latch on reopen", async () => {
    let finish!: (value: { id: string }) => void;
    state.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const change = vi.fn();
    const view = render(<OrdersPreviewSheet open onOpenChange={change} materialListId="list" isToolRequest />);
    fireEvent.click(await screen.findByRole("button", { name: "Send", exact: true }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close", exact: true })[0]!);
    expect(change).toHaveBeenCalledWith(false);
    view.rerender(<OrdersPreviewSheet open={false} onOpenChange={change} materialListId="list" isToolRequest />);
    view.rerender(<OrdersPreviewSheet open onOpenChange={change} materialListId="list" isToolRequest />);
    expect(await screen.findByRole("button", { name: "Sending..." })).toBeDisabled();
    expect(state.save).toHaveBeenCalledOnce();
    await act(async () => finish({ id: "accepted-request" }));
  });

  it("locks the complete draft during dispatch so post-dispatch edits cannot be erased by refresh", async () => {
    let finish!: (value: { id: string }) => void;
    state.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    state.fetch.mockResolvedValueOnce({ possible: [{ ...order, email: { ...order.email,
      supplierSkuLines: [{ plain: "2 x Pipe", withSku: "2 x Pipe [SKU: P1]" }],
    } }], sent: [] }).mockRejectedValue(new Error("Preview unavailable"));
    const send = await show();
    fireEvent.click(screen.getByRole("button", { name: "Pipe Supply" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Dispatch subject" } });
    fireEvent.change(screen.getByLabelText("Internal Notes"), { target: { value: "Dispatch note" } });
    expect(screen.getByRole("checkbox", { name: "Include supplier SKU" })).toBeEnabled();
    fireEvent.click(send);
    for (const label of ["To", "CC", "Subject", "Email", "Internal Notes"])
      expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Include supplier SKU" })).toBeDisabled();
    // Programmatic events also cannot update maps behind the disabled UI.
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Too late" } });
    fireEvent.change(screen.getByLabelText("Internal Notes"), { target: { value: "Too late" } });
    await act(async () => finish({ id: "accepted-order" }));
    await screen.findByText(/The order was saved, but this preview could not refresh/);
    expect(screen.getByLabelText("Subject")).toHaveValue("Dispatch subject");
    expect(screen.getByLabelText("Internal Notes")).toHaveValue("Dispatch note");
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ notes: "Dispatch note" }));
    expect(state.save).toHaveBeenCalledOnce();
  });
});

describe("saved order email handoff", () => {
  // The email action lives in each order card's menu.
  const openActions = () =>
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Actions for order ORDER-001" }),
      { key: "Enter" },
    );
  it("prepares an unopened draft, then launches on a fresh tap before a slow resend save finishes", async () => {
    let finish!: () => void;
    state.resend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<OrdersPage />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Prepare email" }));
    await screen.findByLabelText("Subject");
    expect(state.loadDraft).toHaveBeenCalledOnce();
    expect(launched).toEqual([]);
    expect(state.resend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Changed resend" },
    });
    openActions();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resend" }));
    expect(launched).toHaveLength(1);
    expect(decodeURIComponent(launched[0]!.url)).toContain(
      "subject=Changed resend",
    );
    expect(state.resend).toHaveBeenCalledWith({
      orderId: "sent-order",
      sentTo: "orders@example.com",
      notes: "note",
    });
    // While the save runs the menu offers no second send.
    openActions();
    fireEvent.click((await screen.findAllByRole("menuitem"))[0]!);
    expect(launched).toHaveLength(1);
    expect(state.resend).toHaveBeenCalledOnce();
    await act(async () => finish());
  });
  it("cannot resend or open email without permission", () => {
    state.permitted = false;
    render(<OrdersPage />);
    openActions();
    const button = screen.getByRole("menuitem", { name: "Prepare email" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(launched).toEqual([]);
    expect(state.resend).not.toHaveBeenCalled();
  });
});

it("sends a tool line from an ordinary material list to the tool room without opening email", async () => {
  state.permitted = false;
  state.fetch.mockResolvedValue({ possible: [{ ...order, isToolRequest: true }], sent: [] });
  render(<OrdersPreviewSheet open onOpenChange={vi.fn()} materialListId="list" hasToolItems />);
  fireEvent.click(await screen.findByRole("button", { name: "Send" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith({ materialListId: "list", supplierId: "supplier", sentTo: "Tool room", notes: undefined }));
  expect(launched).toEqual([]);
});

it("passes the displayed list sequence to preview and send", async () => {
  const send = await show();
  expect(state.fetch).toHaveBeenCalledWith({ materialListId: "list", orderedItemIds: ["second", "first"] }, { staleTime: 0 });
  fireEvent.click(send);
  await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ orderedItemIds: ["second", "first"] })));
});
