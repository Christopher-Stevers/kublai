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
  for (const [name, style] of [
    ["Supplier: not sent", materialProgressStyle(0)],
    [
      "ORDER-1: sent, awaiting full verification",
      {
        ...materialProgressStyle(100, "blue"),
        boxShadow: "inset 0 0 0 2px rgb(59 130 246 / 0.85)",
      },
    ],
    ["ORDER-2: fully verified", materialProgressStyle(100)],
  ] as const) {
    const tag = screen.getByLabelText(name);
    expect(tag).toHaveStyle(style);
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

it("fills a sent order's blue pill with green as its items are verified", () => {
  render(
    <MaterialListOrderNumbers
      orders={[
        {
          id: "a",
          number: "175-Next",
          complete: false,
          deliveredPercent: 0,
          state: "sent",
        },
        {
          id: "b",
          number: "176-Next",
          complete: false,
          deliveredPercent: 40,
          state: "sent",
        },
        {
          id: "c",
          number: "177-Next",
          complete: true,
          deliveredPercent: 100,
          state: "verified",
        },
      ]}
    />,
  );
  expect(
    screen.getByTitle("175-Next · sent, awaiting full verification"),
  ).toHaveStyle(materialProgressStyle(0, "blue"));
  expect(
    screen.getByTitle(
      "176-Next · sent, awaiting full verification · 40% received",
    ),
  ).toHaveStyle({
    ...materialProgressStyle(40, "blue"),
    boxShadow: "inset 0 0 0 2px rgb(59 130 246 / 0.85)",
  });
  expect(screen.getByLabelText("177-Next: fully verified")).not.toHaveStyle({
    boxShadow: "inset 0 0 0 2px rgb(59 130 246 / 0.85)",
  });
});
