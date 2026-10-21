import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AppTouchGestures } from "./AppTouchGestures";

it("blocks Safari page magnification without swallowing viewer gestures, and cleans up", () => {
  const view = render(<AppTouchGestures />);
  const observer = vi.fn();
  document.addEventListener("gesturechange", observer);
  const pinch = new Event("gesturechange", { bubbles: true, cancelable: true });
  document.dispatchEvent(pinch);
  expect(pinch.defaultPrevented).toBe(true);
  expect(observer).toHaveBeenCalledOnce();
  document.removeEventListener("gesturechange", observer);
  for (const type of ["touchmove", "pointermove", "wheel", "keydown"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  view.unmount();
  const after = new Event("gesturestart", { cancelable: true });
  document.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
