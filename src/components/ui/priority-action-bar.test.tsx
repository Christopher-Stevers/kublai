import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { PriorityActionBar } from "./priority-action-bar";

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
    "More",
    "Action 2",
    "Action 3",
    "Action 4",
  ]);
  const tab = screen.getByRole("button", { name: "More" });
  expect(tab).toHaveAttribute("data-count", "1");
  // A swipe up raises the shelf; a swipe down lowers it.
  fireEvent.pointerDown(tab, { clientY: 100 });
  fireEvent.pointerMove(tab, { clientY: 60 });
  fireEvent.click(tab);
  expect(tab).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Action 1" })).toBeVisible();
  fireEvent.pointerDown(tab, { clientY: 60 });
  fireEvent.pointerMove(tab, { clientY: 100 });
  fireEvent.click(tab);
  expect(tab).toHaveAttribute("aria-expanded", "false");
});
it("shows its label above the buttons", () => {
  render(
    <PriorityActionBar label="Material Total $10.00">{buttons(2)}</PriorityActionBar>,
  );
  expect(screen.getByText("Material Total $10.00")).toHaveAttribute(
    "data-action-bar-label",
  );
});
it("keeps the highest three on the right, with lower priorities on the shelf", () => {
  render(<PriorityActionBar>{buttons(6)}</PriorityActionBar>);
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "More",
    "Action 4",
    "Action 5",
    "Action 6",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(
    within(screen.getByRole("group", { name: "More actions" }))
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Action 1", "Action 2", "Action 3"]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
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
    screen.queryByRole("button", { name: "More" }),
  ).not.toBeInTheDocument();
  rerender(actions(true));
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "More",
    "Action 2",
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
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
  expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByRole("button", { name: "Count 1" })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
