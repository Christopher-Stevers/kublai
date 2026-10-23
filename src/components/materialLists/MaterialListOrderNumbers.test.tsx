import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MaterialListOrderNumbers } from "./MaterialListOrderNumbers";
import { materialProgressStyle } from "~/lib/material-progress-style";
afterEach(cleanup);
it("keeps status colors and accessible labels with one shared order icon", () => {
  render(
    <MaterialListOrderNumbers
      orders={[
        {
          id: "pending",
          number: "Supplier",
          complete: false,
          deliveredPercent: 0,
          state: "potential",
        },
        {
          id: "sent",
          number: "ORDER-1",
          complete: false,
          deliveredPercent: 100,
          state: "sent",
        },
        {
          id: "verified",
          number: "ORDER-2",
          complete: true,
          deliveredPercent: 100,
          state: "verified",
        },
      ]}
    />,
  );
  for (const [name, percent] of [
    ["Supplier: not sent", 0],
    ["ORDER-1: sent, awaiting full verification", 50],
    ["ORDER-2: fully verified", 100],
  ] as const) {
    const tag = screen.getByLabelText(name);
    expect(tag).toHaveStyle(materialProgressStyle(percent));
    expect(tag.querySelector("svg")).toBeNull();
  }
  const group = screen.getByRole("group", { name: "Orders" });
  expect(group.querySelectorAll("svg")).toHaveLength(1);
  expect(group.firstElementChild).toHaveClass("lucide-shopping-cart");
});
it("keeps cached order numbers at sent until full verification is known", () => {
  render(<MaterialListOrderNumbers numbers={["ORDER-3"]} />);
  expect(
    screen.getByLabelText("ORDER-3: sent, awaiting full verification"),
  ).toHaveAttribute("data-order-state", "sent");
});

it("omits the order icon when there are no pills", () => {
  const { container } = render(<MaterialListOrderNumbers orders={[]} />);
  expect(screen.queryByRole("group", { name: "Orders" })).toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});
