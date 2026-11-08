import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { BarSearchButton, PriorityActionBar } from "./priority-action-bar";

afterEach(cleanup);
const buttons = (n: number) =>
  Array.from({ length: n }, (_, i) => <button key={i}>Action {i + 1}</button>);
for (const n of [1, 2, 3]) {
  it(`shows all ${n} actions in existing left-to-right priority order`, () => {
    render(<PriorityActionBar>{buttons(n)}</PriorityActionBar>);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(
      Array.from({ length: n }, (_, i) => `Action ${i + 1}`),
    );
  });
}
it("shows no bar for an empty permission set", () => {
  const { container } = render(
    <PriorityActionBar>
      {false}
      {null}
      {undefined}
    </PriorityActionBar>,
  );
  expect(container).toBeEmptyDOMElement();
});
it("shelves the lowest of four actions, never showing more than three", () => {
  render(<PriorityActionBar>{buttons(4)}</PriorityActionBar>);
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "",
    "Action 3",
    "Action 4",
  ]);
  const tab = screen.getByRole("button", { name: /Expand all actions|Collapse actions/ });
  expect(tab).toHaveAttribute("data-count", "2");
  expect(tab.closest("[data-action-bar-row]")).not.toBeNull();
  expect(tab).not.toHaveAttribute("data-action-bar-tab");
  fireEvent.click(tab);
  expect(tab).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Action 1" })).toBeVisible();
  fireEvent.click(tab);
  expect(tab).toHaveAttribute("aria-expanded", "false");
});
it("shows its label above the buttons", () => {
  render(
    <PriorityActionBar label="Material Total $10.00">
      {buttons(2)}
    </PriorityActionBar>,
  );
  expect(screen.getByText("Material Total $10.00")).toHaveAttribute(
    "data-action-bar-label",
  );
});
it("keeps the highest two beside overflow, with lower priorities on the shelf", () => {
  render(<PriorityActionBar>{buttons(6)}</PriorityActionBar>);
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "",
    "Action 5",
    "Action 6",
  ]);
  fireEvent.click(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ }));
  expect(
    within(screen.getByRole("group", { name: "More actions" }))
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Action 1", "Action 2", "Action 3", "Action 4"]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ })).toHaveFocus();
  expect(
    screen.queryByRole("button", { name: "Action 1" }),
  ).not.toBeInTheDocument();
});
it("filters permissions and fragments before counting and responds to changes", () => {
  const actions = (allowed: boolean) => (
    <PriorityActionBar>
      <>
        {buttons(2)}
        {allowed && <button>Order</button>}
      </>
      <button>Add Part</button>
    </PriorityActionBar>
  );
  const { rerender } = render(actions(false));
  expect(screen.queryByText("Order")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Expand all actions|Collapse actions/ }),
  ).not.toBeInTheDocument();
  rerender(actions(true));
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "",
    "Order",
    "Add Part",
  ]);
  rerender(actions(false));
  expect(screen.queryByText("Order")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(3);
});
it("keeps temporarily disabled actions visible without activating them", () => {
  const run = vi.fn();
  render(
    <PriorityActionBar>
      <button disabled onClick={run}>
        Order
      </button>
    </PriorityActionBar>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Order" }));
  expect(run).not.toHaveBeenCalled();
});
it("retains custom action state when selecting it closes the overflow tray", () => {
  function Stateful() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
  }
  render(
    <PriorityActionBar>
      <Stateful />
      {buttons(4)}
    </PriorityActionBar>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ }));
  fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
  expect(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ }));
  expect(screen.getByRole("button", { name: "Count 1" })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

it("still limits a wider bar to three slots", () => {
  const width = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(700);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() { /* fixed-width fixture */ }
      disconnect() { /* no observer resources */ }
    },
  );
  try {
    render(<PriorityActionBar>{buttons(7)}</PriorityActionBar>);
    const tab = screen.getByRole("button", { name: /Expand all actions|Collapse actions/ });
    expect(tab.getAttribute("data-count")).toBe("5");
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => !b.closest("[data-action-bar-shelf]"))
        .map((b) => b.textContent),
    ).toEqual([
      "",
      "Action 6",
      "Action 7",
    ]);
  } finally {
    width.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("widens the search across the bar and shrinks it back with the X", () => {
  function Bar() {
    const [value, setValue] = useState("");
    return (
      <PriorityActionBar
        search={{ value, onChange: setValue, label: "Search parts" }}
      >
        <BarSearchButton />
        <button>Receive</button>
      </PriorityActionBar>
    );
  }
  render(<Bar />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const input = screen.getByRole("searchbox", { name: "Search parts" });
  expect(input).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
  fireEvent.change(input, { target: { value: "cap" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("searchbox")).toHaveValue("cap");
  fireEvent.click(screen.getByRole("button", { name: "Close search" }));
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Receive" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
});

it("renders a custom view toggle above the action row", () => {
  const toggle = vi.fn();
  render(
    <PriorityActionBar
      tabAction={
        <button data-action-bar-tab onClick={toggle}>
          Chosen Parts (2)
        </button>
      }
    >
      {buttons(3)}
    </PriorityActionBar>,
  );
  const tab = screen.getByRole("button", { name: "Chosen Parts (2)" });
  expect(tab.closest("[data-action-bar-row]")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Expand all actions|Collapse actions/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(tab);
  expect(toggle).toHaveBeenCalledOnce();
});

it("keeps Receive and New List available beside desktop search, including a restored filter", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  function DesktopBar() {
    const [value, onChange] = useState("copper");
    return (
      <PriorityActionBar
        search={{ value, onChange, label: "Find parts", inlineDesktop: true }}
      >
        <BarSearchButton />
        <button>Receive</button>
        <button>New List</button>
      </PriorityActionBar>
    );
  }
  try {
    render(<DesktopBar />);
    const search = screen.getByRole("searchbox", { name: "Find parts" });
    expect(search).toHaveValue("copper");
    fireEvent.change(search, { target: { value: "cap" } });
    expect(search).toHaveValue("cap");
    expect(screen.getByRole("button", { name: "Receive" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New List" })).toBeVisible();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("expands every extra action at once and leaves primary controls mounted", () => {
  render(<PriorityActionBar>{buttons(25)}</PriorityActionBar>);
  const primary = screen.getByRole("button", { name: "Action 25" });
  fireEvent.click(screen.getByRole("button", { name: "Expand all actions" }));
  expect(within(screen.getByRole("group", { name: "More actions" })).getAllByRole("button")).toHaveLength(23);
  expect(screen.getAllByRole("button")).toHaveLength(26);
  expect(screen.getByRole("button", { name: "Action 25" })).toBe(primary);
  fireEvent.click(screen.getByRole("button", { name: "Collapse actions" }));
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Action 25" })).toBe(primary);
});

it("groups named shelf actions under a heading without displacing primary actions", () => {
  render(<PriorityActionBar>
    <button>General option</button>
    <button data-action-group="AI Tools">Read drawing</button>
    <button data-action-group="AI Tools">Read legend</button>
    {buttons(3)}
  </PriorityActionBar>);
  expect(screen.queryByRole("heading", {name: "AI Tools"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Expand all actions"}));
  const ai = screen.getByRole("region", {name: "AI Tools"});
  expect(within(ai).getByRole("heading", {name: "AI Tools"})).toBeInTheDocument();
  expect(within(ai).getAllByRole("button").map(button => button.textContent)).toEqual(["Read drawing", "Read legend"]);
  expect(within(ai).queryByRole("button", {name: "General option"})).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name: "Action 3"})).toBeVisible();
});

it("counts the combined search/overflow control as one slot and shelves Tools", () => {
  const {container} = render(<PriorityActionBar search={{value:"",onChange:vi.fn(),label:"Find drawings",split:true}}>
    <button>Tools</button><button>Markup</button><button>Measure</button>
  </PriorityActionBar>);
  expect(container.querySelector("[data-action-bar-row]")!.children).toHaveLength(3);
  expect(screen.getByRole("button", {name:"Find drawings"}).closest("[data-action-slot]")).toBe(screen.getByRole("button", {name:"Expand all actions"}).closest("[data-action-slot]"));
  expect(screen.queryByRole("button",{name:"Tools"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Expand all actions"}));
  expect(within(screen.getByRole("group",{name:"More actions"})).getByRole("button",{name:"Tools"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Find drawings"}));
  expect(screen.getByRole("searchbox",{name:"Find drawings"})).toBeVisible();
});

it("keeps named tool sections in overflow even when the primary row has room", () => {
  render(<PriorityActionBar search={{value:"",onChange:vi.fn(),label:"Search drawings",split:true}}>
    <button data-action-group="Tools">Viewing</button><button>Measure</button>
  </PriorityActionBar>);
  expect(screen.getByRole("button",{name:"Measure"})).toBeVisible();
  expect(screen.queryByRole("button",{name:"Viewing"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Expand all actions"}));
  expect(within(screen.getByRole("region",{name:"Tools"})).getByRole("button",{name:"Viewing"})).toBeVisible();
});
