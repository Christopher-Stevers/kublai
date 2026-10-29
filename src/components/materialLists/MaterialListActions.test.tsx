import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  MaterialListActions,
  OrderReceiveActions,
} from "./MaterialListActions";
vi.mock("~/components/materialLists/prefabs/SaveAsPrefabDialog", () => ({
  SaveAsPrefabDialog: () => null,
}));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => null,
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
afterEach(cleanup);
const base = {
  total: 10,
  canGenerate: true,
  onOrder: vi.fn(),
  onQuote: vi.fn(),
  onAdd: vi.fn(),
  materialListId: "list",
};
it("never renders denied Order or Quote actions, including in overflow", () => {
  render(
    <MaterialListActions
      {...base}
      canOrder={false}
      canQuote={false}
      canAdd
      packingSlips={<button>Scan slip</button>}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Order" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Get Quote")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "More" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Save as Prefab",
    "Scan slip",
    "Add Part",
  ]);
});
it("fails closed before permissions load", () => {
  render(<MaterialListActions {...base} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("shelves all but the highest three permitted actions", () => {
  render(
    <MaterialListActions
      {...base}
      canOrder
      canQuote
      canAdd
      packingSlips={<button>Scan slip</button>}
    />,
  );
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "More",
    "Order",
    "Scan slip",
    "Add Part",
  ]);
  expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
    "data-count",
    "2",
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("button", { name: "Get Quote" }));
  expect(base.onQuote).toHaveBeenCalledOnce();
});
it("hides receiving writes when the caller has no receive permission", () => {
  render(
    <OrderReceiveActions
      onNotes={vi.fn()}
      packingSlips={<button>Packing slips</button>}
    />,
  );
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Notes",
    "Packing slips",
  ]);
});
it("prioritizes Add and Receive while keeping Mark none fifth", () => {
  const add = vi.fn();
  render(<OrderReceiveActions onNotes={vi.fn()} onAdd={add}
    packingSlips={<button>Receive</button>} onMarkAllReceived={vi.fn()} onMarkNoneReceived={vi.fn()} />);
  expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["More", "Notes", "Receive", "Add"]);
  fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
  expect(add).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["More", "Mark none received", "Mark all received", "Notes", "Receive", "Add"]);
});
