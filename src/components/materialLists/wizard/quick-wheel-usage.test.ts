import { expect, it } from "vitest";
import { inwardSlots } from "./quick-wheel-usage";
it("orders slots by distance to screen centre, with stable ties", () => {
  expect(
    inwardSlots(
      [
        { x: 0, y: 0 },
        { x: 80, y: 80 },
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ],
      { x: 100, y: 100 },
    ),
  ).toEqual([2, 3, 1, 0]);
});
