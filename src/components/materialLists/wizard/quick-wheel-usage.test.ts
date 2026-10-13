import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  inwardSlots,
  readWheelUsage,
  recordWheelChoice,
  wheelUsageId,
  WHEEL_USAGE_KEY,
} from "./quick-wheel-usage";
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("retains separate counts for each stage and ignores corrupt storage", () => {
  recordWheelChoice("Catalog", "All");
  recordWheelChoice("Catalog", "All");
  recordWheelChoice("Size", "All");
  expect(readWheelUsage()[wheelUsageId("Catalog", "All")]).toBe(2);
  expect(readWheelUsage()[wheelUsageId("Size", "All")]).toBe(1);
  localStorage.setItem(WHEEL_USAGE_KEY, "broken");
  expect(readWheelUsage()).toEqual({});
  localStorage.setItem(
    WHEEL_USAGE_KEY,
    JSON.stringify({ negative: -1, string: "9", good: 3 }),
  );
  expect(readWheelUsage()).toEqual({ good: 3 });
});
it("does not interrupt selection when storage is blocked", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  });
  expect(() => recordWheelChoice("Size", "1 inch")).not.toThrow();
});
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
