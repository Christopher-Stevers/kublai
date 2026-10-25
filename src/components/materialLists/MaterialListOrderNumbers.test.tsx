import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MaterialListOrderNumbers, PILL_CAP } from "./MaterialListOrderNumbers";
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
        ...materialProgressStyle(100, "blue", PILL_CAP),
        boxShadow: "inset 0 0 0 1px rgb(59 130 246 / 0.45)",
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
  ).toHaveStyle(materialProgressStyle(0, "blue", PILL_CAP));
  expect(
    screen.getByTitle(
      "176-Next · sent, awaiting full verification · 40% received",
    ),
  ).toHaveStyle({
    ...materialProgressStyle(40, "blue", PILL_CAP),
    boxShadow: "inset 0 0 0 1px rgb(59 130 246 / 0.45)",
  });
  expect(screen.getByLabelText("177-Next: fully verified")).not.toHaveStyle({
    boxShadow: "inset 0 0 0 1px rgb(59 130 246 / 0.45)",
  });
});

it("keeps both rounded ends of a sent pill blue, filling only the middle", () => {
  const blue = "rgb(37 99 235 / 0.3)", green = "rgb(22 163 74 / 0.35)";
  expect(materialProgressStyle(40, "blue", PILL_CAP).background).toBe(
    `linear-gradient(to right, ${blue} 0%, ${blue} 0.75rem, ${green} 0.75rem, ${green} calc(0.75rem + (100% - 2 * 0.75rem) * 0.4), ${blue} calc(0.75rem + (100% - 2 * 0.75rem) * 0.4), ${blue} 100%)`,
  );
  expect(materialProgressStyle(100, "blue", PILL_CAP).background).toContain(`${blue} 100%)`);
  expect(materialProgressStyle(100).background).not.toContain(blue);
});
