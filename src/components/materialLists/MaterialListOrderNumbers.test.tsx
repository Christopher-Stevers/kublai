import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MaterialListOrderNumbers } from "./MaterialListOrderNumbers";
import { materialProgressStyle } from "~/lib/material-progress-style";
afterEach(cleanup);
it("shows orange, half-green and full-green tags with a distinct symbol in each state", () => {
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
  for (const [name, percent, icon] of [
    ["Supplier: not sent", 0, "lucide-clock-3"],
    ["ORDER-1: sent, awaiting full verification", 50, "lucide-send"],
    ["ORDER-2: fully verified", 100, "lucide-circle-check"],
  ] as const) {
    const tag = screen.getByLabelText(name);
    expect(tag).toHaveStyle(materialProgressStyle(percent));
    expect(tag.querySelector("svg")).toHaveClass(icon);
  }
});
it("keeps cached order numbers at sent until full verification is known", () => {
  render(<MaterialListOrderNumbers numbers={["ORDER-3"]} />);
  expect(
    screen.getByLabelText("ORDER-3: sent, awaiting full verification"),
  ).toHaveAttribute("data-order-state", "sent");
});
