import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TouchNavigation } from "./TouchNavigation";
import {
  DEFAULT_NAVIGATION,
  navigationSettingsSchema,
} from "~/lib/bim/navigation-settings";
import type { ModelScene, TouchJoystick } from "~/lib/bim/scene";
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
it("hides graphics without disabling input or unsubscribing from positions", () => {
  const unsubscribe = vi.fn();
  const subscribeTouchJoysticks = vi.fn(
    (fn: (sticks: TouchJoystick[]) => void) => {
      fn([{ side: "left", x: 80, y: 120, dx: 0.4, dy: 0 }]);
      return unsubscribe;
    },
  );
  const scene = { subscribeTouchJoysticks } as unknown as ModelScene;
  const { rerender, unmount } = render(
    <TouchNavigation scene={scene} settings={DEFAULT_NAVIGATION.touch} />,
  );
  expect(screen.getByTestId("joystick-left")).toBeTruthy();
  rerender(
    <TouchNavigation
      scene={scene}
      settings={{ ...DEFAULT_NAVIGATION.touch, showJoysticks: false }}
    />,
  );
  expect(screen.queryByTestId("joystick-left")).toBeNull();
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(subscribeTouchJoysticks).toHaveBeenCalledOnce();
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
