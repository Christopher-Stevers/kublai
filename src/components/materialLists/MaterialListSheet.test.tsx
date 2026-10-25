import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MaterialListSheet } from "./MaterialListSheet";
import { materialSections } from "./MaterialSectionHeading";
import type { MaterialListTableRowProps } from "./MaterialListTableRow";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  useReplicacheSyncing: () => false,
  resolveReplicacheSyncStatus: () => "synced",
}));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({
    getReplicache: vi.fn(),
    mutateAndSync: vi.fn(),
  }),
}));
vi.mock("./MaterialListSyncIndicator", () => ({
  MaterialListSyncIndicator: () => null,
}));
vi.mock("~/components/materialLists/QuantityControls", () => ({
  QuantityControls: ({ quantity }: { quantity: number }) => (
    <span>qty {quantity}</span>
  ),
}));
vi.mock("~/components/materialLists/SupplierSelector", () => ({
  SupplierSelector: () => <span>supplier picker</span>,
}));
afterEach(cleanup);

type Item = MaterialListTableRowProps["item"];
const part = (id: string, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  quantity: "4",
  unitCost: "2",
  extendedPrice: "8",
  descriptionSnapshot: name,
  roomName: "Kitchen",
  ...extra,
});
const ordered = part("o1", "Valve", {
  sentOrderItemId: "oi1",
  sentOrder: {
    id: "ord",
    number: "PO-7",
    status: "sent",
    quantity: "10",
    receivedQuantity: "3",
    verificationStatus: "partial",
  },
  supplierPart: {
    id: "sp",
    supplierId: "s",
    supplierSku: null,
    lastKnownUnitCost: null,
    supplier: { id: "s", name: "Acme" },
  },
});
const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((cell) => cell.textContent);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

it("puts parts not ordered orderTable, then each order under receiving columns", () => {
  render(
    <MaterialListSheet
      items={[part("n1", "Elbow"), ordered]}
      materialListId="m"
      suppliers={[]}
      receiveFor={(item) =>
        item.sentOrder
          ? {
              ordered: item.sentOrder.quantity,
              received: item.sentOrder.receivedQuantity,
              status: item.sentOrder.verificationStatus,
              unit: "ea",
              onChange: vi.fn(),
            }
          : null
      }
    />,
  );
  const headings = screen.getAllByRole("heading");
  expect(headings.map((heading) => heading.parentElement?.textContent)).toEqual(
    ["Not ordered1 part", "PO-7Acme1 part"],
  );
  const [plainTable, orderTable] = screen.getAllByRole("table");
  expect(orderTable).toHaveAccessibleName("PO-7 parts");
  // The page brings up this order's receiving bar while the table shows.
  expect(orderTable).toHaveAttribute("data-order-id", "ord");
  expect(plainTable).not.toHaveAttribute("data-order-id");
  expect(screen.getByRole("link", { name: "PO-7" })).toHaveAttribute(
    "href",
    "/jobs/material-lists/m?orderId=ord",
  );
  expect(plainTable).toHaveAccessibleName("Not ordered parts");
  expect(headers(orderTable!)).toEqual([
    "Photo",
    "Part description",
    "Ordered",
    "Received",
    "Back ordered",
    "Room",
    "Supplier",
    "Each",
    "Total",
    "Sync",
    "Actions",
  ]);
  expect(headers(plainTable!).slice(1, 5)).toEqual([
    "Part description",
    "Room",
    "Qty",
    "Supplier",
  ]);
  const [row] = within(orderTable!).getAllByRole("row").slice(1);
  const values = cells(row!);
  expect(values[1]).toContain("Valve");
  expect(values[1]).toContain("Part received");
  expect(values[2]).toBe("10 ea");
  expect(within(row!).getByLabelText("Received: Valve")).toHaveValue(3);
  expect(values[4]).toBe("7 ea");
  expect(values[5]).toBe("Kitchen");
  expect(values[6]).toContain("Acme");
  expect(within(plainTable!).getByText("Elbow")).toBeInTheDocument();
});

it("shows ordered counts read only without receive controls", () => {
  render(
    <MaterialListSheet items={[ordered]} materialListId="m" suppliers={[]} />,
  );
  const table = screen.getByRole("table");
  expect(table).toHaveAccessibleName("PO-7 parts");
  expect(screen.getByRole("heading", { name: "PO-7" })).toBeInTheDocument();
  expect(within(table).getAllByRole("cell")[3]).toHaveTextContent("3");
  expect(
    within(table).queryByLabelText("Received: Valve"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Part received")).toBeInTheDocument();
});

it("keeps one plain table when nothing is ordered", () => {
  render(<MaterialListSheet items={[]} materialListId="m" suppliers={[]} />);
  expect(screen.getByRole("table")).toHaveAccessibleName("Material list");
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")[1]).toHaveTextContent(
    "Part description",
  );
});

it("only starts back orders for the order that has received parts, and resets when receipts are cleared", () => {
  const pending = (id: string, orderId: string, received = "0"): Item => ({
    ...ordered, id, sentOrderItemId: `line-${id}`,
    sentOrder: { ...ordered.sentOrder!, id: orderId, number: orderId, receivedQuantity: received },
  });
  const { rerender } = render(<MaterialListSheet items={[pending("a", "first"), pending("b", "first", "1"), pending("c", "second")]} materialListId="m" suppliers={[]} />);
  const first = screen.getByRole("table", { name: "first parts" });
  const second = screen.getByRole("table", { name: "second parts" });
  expect(within(first).getByRole("columnheader", { name: "Back ordered" })).toBeInTheDocument();
  expect(cells(within(first).getAllByRole("row")[1]!)[4]).toBe("10");
  expect(within(second).queryByRole("columnheader", { name: "Back ordered" })).not.toBeInTheDocument();
  expect(within(second).getByRole("columnheader", { name: "Awaiting delivery" })).toBeInTheDocument();
  rerender(<MaterialListSheet items={[pending("a", "first"), pending("b", "first"), pending("c", "second")]} materialListId="m" suppliers={[]} />);
  expect(screen.queryByRole("columnheader", { name: "Back ordered" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader", { name: "Awaiting delivery" })).toHaveLength(2);
});

it("puts the parts not ordered first, then a group per order", () => {
  const order = (id: string, number: string | null, status = "sent") => ({
    id,
    number,
    status,
  });
  const acme = { supplier: { name: "Acme" } };
  const items = [
    { id: "a" },
    {
      id: "b",
      sentOrderItemId: "x",
      sentOrder: order("o1", "PO-1"),
      supplierPart: acme,
    },
    {
      id: "c",
      sentOrderItemId: "y",
      sentOrder: order("o2", null, "cancelled"),
    },
    { id: "d", sentOrderItemId: "z", sentOrder: order("o1", "PO-1") },
    { id: "e" },
  ];
  expect(
    materialSections(items, "m").map((s) => [
      s.label,
      s.detail ?? null,
      s.orderId ?? null,
      s.items.map((i) => i.id),
    ]),
  ).toEqual([
    ["Not ordered", null, null, ["a", "e"]],
    ["PO-1", "Acme", "o1", ["b", "d"]],
    ["Order", "Cancelled", null, ["c"]],
  ]);
  expect(materialSections(items, "m")[2]!.href).toBe(
    "/jobs/material-lists/m?orderId=o2",
  );
  const plain: { id: string; sentOrderItemId?: string }[] = [{ id: "a" }];
  expect(materialSections(plain, "m")).toEqual([
    { key: "all", label: null, ordered: false, items: plain },
  ]);
});
