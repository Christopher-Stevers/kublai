import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TouchNavigation, thumbPosition } from "./TouchNavigation";
import {
  DEFAULT_NAVIGATION,
  navigationSettingsSchema,
} from "~/lib/bim/navigation-settings";
import type { ModelScene } from "~/lib/bim/scene";
afterEach(cleanup);
it("adds touch defaults without resetting existing keyboard preferences", () => {
  const old = structuredClone(DEFAULT_NAVIGATION) as Partial<
    typeof DEFAULT_NAVIGATION
  >;
  delete old.touch;
  old.keys!.forward = ["KeyT", null];
  const migrated = navigationSettingsSchema.parse(old);
  expect(migrated.keys.forward[0]).toBe("KeyT");
  expect(migrated.touch).toEqual(DEFAULT_NAVIGATION.touch);
});
it("uses a dead zone and clamps diagonal thumb travel", () => {
  expect(thumbPosition(2, 2, 50)).toEqual({ x: 0, y: 0 });
  const p = thumbPosition(100, -100, 50);
  expect(Math.hypot(p.x, p.y)).toBeCloseTo(1);
  expect(p.y).toBeLessThan(0);
  expect(thumbPosition(25, 0, 50).x).toBeGreaterThan(0);
  expect(thumbPosition(25, 0, 50).x).toBeLessThan(1);
});
it("clears both thumb inputs when hidden or interrupted", () => {
  const setThumb = vi.fn();
  const scene = { setThumb } as unknown as ModelScene;
  const { rerender } = render(
    <TouchNavigation
      scene={scene}
      settings={DEFAULT_NAVIGATION.touch}
      walking
    />,
  );
  expect(screen.getByRole("group", { name: /Left thumb/ })).toBeTruthy();
  expect(screen.getByRole("group", { name: /Right thumb/ })).toBeTruthy();
  setThumb.mockClear();
  fireEvent(window, new Event("blur"));
  expect(setThumb).toHaveBeenCalledWith("left", 0, 0);
  expect(setThumb).toHaveBeenCalledWith("right", 0, 0);
  setThumb.mockClear();
  rerender(
    <TouchNavigation
      scene={scene}
      settings={{ ...DEFAULT_NAVIGATION.touch, display: "off" }}
      walking
    />,
  );
  expect(screen.queryByRole("group")).toBeNull();
  expect(setThumb).toHaveBeenCalledWith("left", 0, 0);
  expect(setThumb).toHaveBeenCalledWith("right", 0, 0);
});
