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
const dev = vi.hoisted(() => ({ enabled: true }));
vi.mock("~/components/app/DevFeaturesProvider", () => ({ useDevFeatures: () => dev.enabled }));
afterEach(() => { cleanup(); dev.enabled = true; });
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
    screen.queryByRole("button", { name: /Expand all actions|Collapse actions/ }),
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
it("shelves all but the highest two permitted actions", () => {
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
    "",
    "Scan slip",
    "Add Part",
  ]);
  expect(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ })).toHaveAttribute(
    "data-count",
    "3",
  );
  fireEvent.click(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ }));
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
  expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["", "Receive", "Add Part"]);
  fireEvent.click(screen.getByRole("button", { name: "Add Part" }));
  expect(add).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ }));
  expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["Mark none received", "Mark all received", "Notes", "", "Receive", "Add Part"]);
});

it("offers search alongside Receive and Add Part in both list and receiving bars", () => {
  const onChange = vi.fn();
  const search = {value:"", onChange, label:"Search material list"};
  const view = render(<MaterialListActions {...base} canAdd canOrder search={search} packingSlips={<button>Receive</button>} />);
  fireEvent.click(screen.getByRole("button",{name:"Search material list"}));
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:"coupling"}});
  expect(onChange).toHaveBeenCalledWith("coupling");
  view.unmount();
  render(<OrderReceiveActions onNotes={()=>{}} onAdd={()=>{}} search={search} packingSlips={<button>Receive</button>} />);
  expect(screen.getByRole("button",{name:"Search material list"})).toBeVisible();
  expect(screen.getByRole("button",{name:"Receive"})).toBeVisible();
  expect(screen.getByRole("button",{name:"Add Part"})).toBeVisible();
});

it("hides Get Quote with Dev off even when quote permission is granted", () => {
  dev.enabled = false;
  render(<MaterialListActions {...base} canQuote canOrder canAdd />);
  expect(screen.queryByText("Get Quote")).not.toBeInTheDocument();
});

it("shows bulk receipt intent without implying received totals or allowing a second write", () => {
  const all = vi.fn(), none = vi.fn();
  const view = render(<OrderReceiveActions label="Order 142" onNotes={vi.fn()}
    onMarkAllReceived={all} onMarkNoneReceived={none} receivingAll />);
  expect(screen.getByRole("status")).toHaveTextContent("Updating received quantities…");
  fireEvent.click(screen.getByRole("button", { name: "Mark all received" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark none received" }));
  expect(all).not.toHaveBeenCalled();
  expect(none).not.toHaveBeenCalled();
  view.rerender(<OrderReceiveActions label="Order 142" onNotes={vi.fn()}
    onMarkAllReceived={all} onMarkNoneReceived={none} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("Order 142")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark all received" })).toBeEnabled();
});
