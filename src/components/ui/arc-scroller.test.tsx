import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ArcScrollerSurface,
  arcDistance,
  arcFocus,
  arcGeometry,
  arcLoops,
  arcPoint,
  arcScrollDelta,
  useArcScrollerOptions,
  type ArcChoice,
} from "./arc-scroller";

const bounds = { left: 0, top: 0, right: 400, bottom: 800 };
const pointer = { pointerId: 3, pointerType: "touch", isPrimary: true, button: 0, clientX: 330, clientY: 400 };

function Stage({ options, title = "Select Size" }: { options: ArcChoice[]; title?: string }) {
  useArcScrollerOptions(title, options);
  return <p>Blank stage</p>;
}
const sizes = (select = vi.fn()) =>
  Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1} in`, select: () => select(i + 1) }));
const arc = () => document.querySelector<HTMLElement>("[data-arc-scroller]");
const focused = () => arc()!.querySelector("[data-focus]")?.getAttribute("aria-label");
const hold = () => {
  fireEvent.pointerDown(screen.getByText("Blank stage"), pointer);
  act(() => vi.advanceTimersByTime(400));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...bounds, x: 0, y: 0, width: 400, height: 800, toJSON() {},
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("hugs the thumb-side edge and bulges inward around the hold", () => {
  const right = arcGeometry(bounds, 400, "right")!;
  const middle = arcPoint(right, 0);
  const end = arcPoint(right, right.half);
  expect(middle.y).toBeCloseTo(400);
  expect(middle.x).toBeLessThan(end.x);
  expect(end.x).toBeCloseTo(352);
  const left = arcGeometry(bounds, 400, "left")!;
  expect(arcPoint(left, 0).x).toBeCloseTo(400 - middle.x);
  // Too small to fit an arc.
  expect(arcGeometry({ left: 0, top: 0, right: 200, bottom: 200 }, 100, "right")).toBeNull();
});

it("turns a swipe along the arc into scrolling by whole choices", () => {
  const geometry = arcGeometry(bounds, 400, "right")!;
  const from = arcPoint(geometry, 0);
  const to = arcPoint(geometry, -2);
  expect(arcScrollDelta(geometry, from, to)).toBeCloseTo(2);
  expect(arcScrollDelta(geometry, to, from)).toBeCloseTo(-2);
});

it("loops long lists round with one empty slot at the end, and keeps short lists whole", () => {
  const geometry = arcGeometry(bounds, 400, "right")!;
  expect(arcLoops(12, geometry)).toBe(true);
  expect(arcLoops(4, geometry)).toBe(false);
  // At the first choice, the last sits two steps above it with the gap between.
  expect(arcDistance(11, 0, 12, geometry)).toBe(-2);
  expect(arcDistance(12, 0, 12, geometry)).toBe(-1);
  expect(arcFocus(-1, 12, geometry)).toBeNull();
  expect(arcFocus(-2, 12, geometry)).toBe(11);
  expect(arcFocus(15, 12, geometry)).toBe(2);
  // Short lists stop at their ends.
  expect(arcDistance(3, 0, 4, geometry)).toBe(3);
  expect(arcFocus(-2, 4, geometry)).toBe(0);
});

it("scrolls past the last choice back round to the first, and the check picks the middle choice", () => {
  const select = vi.fn();
  render(
    <ArcScrollerSurface>
      <Stage options={sizes(select)} />
    </ArcScrollerSurface>,
  );
  hold();
  fireEvent.pointerUp(window, pointer);
  act(() => { vi.advanceTimersByTime(500); });
  expect(focused()).toBe("5 in");
  for (let i = 0; i < 8; i++) {
    fireEvent.keyDown(window, { key: "ArrowDown" });
    act(() => { vi.advanceTimersByTime(600); });
  }
  // Eight steps from 5 in: past 12 in, over the gap without stopping, round to 1 in.
  expect(focused()).toBe("1 in");
  expect(document.querySelector("[data-arc-gap]")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose 1 in" }));
  expect(select).toHaveBeenCalledWith(1);
});

it("opens on a hold, survives the lift, scrolls by swipe, and picks a tapped choice", () => {
  const select = vi.fn();
  const click = vi.fn();
  render(
    <ArcScrollerSurface>
      <div onClick={click}>
        <Stage options={sizes(select)} />
      </div>
    </ArcScrollerSurface>,
  );
  hold();
  expect(arc()).toHaveAttribute("aria-label", "Select Size");
  const first = focused();
  fireEvent.pointerUp(window, pointer);
  // The lift's click lands nowhere.
  fireEvent.click(screen.getByText("Blank stage"));
  expect(click).not.toHaveBeenCalled();
  expect(arc()).not.toBeNull();

  const geometry = arcGeometry(bounds, 400, "right")!;
  const start = arcPoint(geometry, 0);
  const end = arcPoint(geometry, -3);
  fireEvent.pointerDown(arc()!, { ...pointer, pointerId: 4, clientX: start.x, clientY: start.y });
  fireEvent.pointerMove(window, { ...pointer, pointerId: 4, clientX: end.x, clientY: end.y });
  fireEvent.pointerUp(window, { ...pointer, pointerId: 4, clientX: end.x, clientY: end.y });
  act(() => vi.advanceTimersByTime(1000));
  expect(focused()).not.toBe(first);
  act(() => vi.advanceTimersByTime(500));
  fireEvent.click(screen.getByRole("button", { name: focused()! }));
  expect(select).toHaveBeenCalledOnce();
  // Without dismiss the arc stays for the next step.
  expect(arc()).not.toBeNull();
});

it("closes on a backdrop tap, Escape, or a dismissing choice, and skips disabled choices", () => {
  const done = vi.fn();
  render(
    <ArcScrollerSurface>
      <Stage options={[
        { label: "Locked", select: done, disabled: true },
        { label: "Finish", select: done, dismiss: true },
      ]} />
    </ArcScrollerSurface>,
  );
  fireEvent.contextMenu(screen.getByText("Blank stage"), { button: 2, clientX: 330, clientY: 400 });
  fireEvent.click(screen.getByRole("button", { name: "Locked" }));
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(arc()!);
  expect(arc()).toBeNull();
  fireEvent.contextMenu(screen.getByText("Blank stage"), { button: 2, clientX: 330, clientY: 400 });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(arc()).toBeNull();
  fireEvent.contextMenu(screen.getByText("Blank stage"), { button: 2, clientX: 330, clientY: 400 });
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
  expect(done).toHaveBeenCalledOnce();
  expect(arc()).toBeNull();
});

it("offers Back from later steps and ignores holds on controls", () => {
  const back = vi.fn();
  render(
    <ArcScrollerSurface onBack={back}>
      <button>Card</button>
      <Stage options={sizes()} />
    </ArcScrollerSurface>,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "Card" }), pointer);
  act(() => vi.advanceTimersByTime(400));
  expect(arc()).toBeNull();
  fireEvent.pointerUp(window, pointer);
  hold();
  fireEvent.click(screen.getByRole("button", { name: "Back one step" }));
  expect(back).toHaveBeenCalledOnce();
});
