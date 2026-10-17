import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { learnWheelHand, thumbClearance } from "./quick-wheel-hand";
import {
  quickWheelLayout,
  curvedChoiceAt,
  WHEEL_CHOICE_DIAMETER,
} from "./quick-wheel-layout";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("learns each device's side, keeps it for centre gestures, and adapts after switching", () => {
  for (let i = 0; i < 8; i++) expect(learnWheelHand(350, 0, 390)).toBe("right");
  expect(learnWheelHand(195, 0, 390)).toBe("right");
  for (let i = 0; i < 4; i++) learnWheelHand(35, 0, 390);
  expect(learnWheelHand(195, 0, 390)).toBe("left");
});
it("works when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  });
  expect(learnWheelHand(350, 0, 390)).toBe("right");
  expect(learnWheelHand(35, 0, 390)).toBe("left");
});
for (const hand of ["left", "right"] as const) {
  it(`keeps choices clear of the ${hand} thumb and matches the visible hit targets`, () => {
    const x = hand === "right" ? 325 : 65,
      y = 450;
    const bounds = { left: 12, top: 100, right: 378, bottom: 756 };
    const layout = quickWheelLayout(x, y, 170, 6, bounds, hand);
    expect(layout.kind).toBe("curved");
    if (layout.kind !== "curved") throw Error("Expected fan");
    expect(layout.choices).toHaveLength(6);
    layout.choices.forEach(({ label }, index) => {
      expect(
        thumbClearance(label.x, label.y, x, y, hand),
      ).toBeGreaterThanOrEqual(WHEEL_CHOICE_DIAMETER / 2 + 38);
      expect(label.x - 52).toBeGreaterThanOrEqual(bounds.left);
      expect(label.x + 52).toBeLessThanOrEqual(bounds.right);
      expect(label.y - 52).toBeGreaterThanOrEqual(bounds.top);
      expect(label.y + 52).toBeLessThanOrEqual(bounds.bottom);
      expect(curvedChoiceAt(layout, label.x, label.y, x, y)).toBe(index);
      layout.choices
        .slice(index + 1)
        .forEach((other) =>
          expect(
            Math.hypot(label.x - other.label.x, label.y - other.label.y),
          ).toBeGreaterThanOrEqual(112),
        );
    });
    expect(curvedChoiceAt(layout, x, y, x, y)).toBeNull();
  });
}

it("protects both a vertical thumb and one angled toward the hand side", () => {
  expect(thumbClearance(336, 628, 350, 450, "right")).toBeLessThan(90);
  expect(thumbClearance(390, 550, 350, 450, "right")).toBe(0);
  expect(thumbClearance(10, 550, 50, 450, "left")).toBe(0);
  expect(thumbClearance(200, 350, 350, 450, "right")).toBeGreaterThan(90);
});
