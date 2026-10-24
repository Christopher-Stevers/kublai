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

it("puts ordered parts first under their own receiving columns", () => {
  render(
    <MaterialListSheet
      items={[part("n1", "Elbow"), ordered]}
      materialListId="m"
      suppliers={[]}
      receiveFor={(item) =>
        item.sentOrder
          ? {
              orderId: item.sentOrder.id,
              orderNumber: item.sentOrder.number,
              orderHref: "/x",
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
    ["Ordered1 part", "Not ordered1 part"],
  );
  const [first, second] = screen.getAllByRole("table");
  expect(first).toHaveAccessibleName("Ordered parts");
  expect(second).toHaveAccessibleName("Not ordered parts");
  expect(headers(first!)).toEqual([
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
  expect(headers(second!).slice(1, 5)).toEqual([
    "Part description",
    "Room",
    "Qty",
    "Supplier",
  ]);
  const [row] = within(first!).getAllByRole("row").slice(1);
  const values = cells(row!);
  expect(values[1]).toContain("Valve");
  expect(values[1]).toContain("PO-7");
  expect(values[2]).toBe("10 ea");
  expect(within(row!).getByLabelText("Received: Valve")).toHaveValue(3);
  expect(values[4]).toBe("7 ea");
  expect(values[5]).toBe("Kitchen");
  expect(values[6]).toContain("Acme");
  expect(within(second!).getByText("Elbow")).toBeInTheDocument();
});

it("shows ordered counts read only without receive controls", () => {
  render(
    <MaterialListSheet items={[ordered]} materialListId="m" suppliers={[]} />,
  );
  const table = screen.getByRole("table");
  expect(table).toHaveAccessibleName("Ordered parts");
  expect(screen.getByRole("heading", { name: "Ordered" })).toBeInTheDocument();
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

it("orders sections with ordered parts first", () => {
  const items = [{ id: "a" }, { id: "b", sentOrderItemId: "x" }, { id: "c" }];
  expect(
    materialSections(items).map((s) => [s.label, s.items.map((i) => i.id)]),
  ).toEqual([
    ["Ordered", ["b"]],
    ["Not ordered", ["a", "c"]],
  ]);
  const plain: { id: string; sentOrderItemId?: string }[] = [{ id: "a" }];
  expect(materialSections(plain)).toEqual([
    { key: "all", label: null, items: plain },
  ]);
  expect(materialSections([{ id: "b", sentOrderItemId: "x" }])).toHaveLength(1);
});
