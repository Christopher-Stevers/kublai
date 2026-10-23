import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { MaterialListOrderPickerDialog } from "./VerifyOrderButton";
const state = vi.hoisted(() => ({
  orders: [] as {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: Date;
    sentAt: Date | null;
    supplier: { name: string; priceBookName: string } | null;
  }[],
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/trpc/react", () => ({
  api: {
    materialList: {
      getOrdersForMaterialList: {
        useQuery: () => ({
          data: state.orders,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
beforeEach(() => {
  state.orders = [
    {
      id: "order-one",
      orderNumber: "166-Fastening House",
      status: "sent",
      createdAt: new Date("2026-10-20T12:00:00Z"),
      sentAt: new Date("2026-10-21T19:41:00Z"),
      supplier: { name: "Fastening House", priceBookName: "Alma" },
    },
  ];
});
afterEach(cleanup);
it("shows title, supplier, then the actual sent timestamp on separate lines", () => {
  const close = vi.fn(),
    verify = vi.fn();
  render(
    <MaterialListOrderPickerDialog
      materialList={{ id: "list", name: "Materials" }}
      open
      onOpenChange={close}
      onVerifyOrder={verify}
    />,
  );
  const option = screen.getByRole("button", { name: /166-Fastening House/ });
  const lines = option.firstElementChild!.children;
  expect(lines).toHaveLength(3);
  expect(lines[0]).toHaveTextContent("166-Fastening House");
  expect(lines[1]).toHaveTextContent("Fastening House - Alma");
  expect(lines[2]).toHaveTextContent(
    `Sent ${format(state.orders[0]!.sentAt!, "MMM d, yyyy 'at' h:mm a")}`,
  );
  expect(option).not.toHaveTextContent("Created");
  expect(option).not.toHaveTextContent("(sent)");
  fireEvent.click(option);
  expect(close).toHaveBeenCalledWith(false);
  expect(verify).toHaveBeenCalledWith("order-one");
});
it("keeps three lines when a legacy order has no recorded supplier or sent time", () => {
  state.orders[0]!.sentAt = null;
  state.orders[0]!.supplier = null;
  render(
    <MaterialListOrderPickerDialog
      materialList={{ id: "list", name: "Materials" }}
      open
      onOpenChange={vi.fn()}
      onVerifyOrder={vi.fn()}
    />,
  );
  expect(screen.getByText("Supplier not recorded")).toBeInTheDocument();
  expect(screen.getByText("Sent date not recorded")).toBeInTheDocument();
  expect(screen.queryByText(/Oct 20/)).toBeNull();
});
