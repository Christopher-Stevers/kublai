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
  rankArcChoices,
  useArcScrollerOptions,
  type ArcChoice,
} from "./arc-scroller";
import { wheelUsageId } from "~/lib/order-wheel-usage";

const bounds = { left: 0, top: 0, right: 400, bottom: 800 };
const pointer = { pointerId: 3, pointerType: "touch", isPrimary: true, button: 0, clientX: 330, clientY: 400 };

function Stage({ options, title = "Select Size" }: { options: ArcChoice[]; title?: string }) {
  useArcScrollerOptions(title, options);
  return <p>Blank stage</p>;
}
const sizes = (select = vi.fn()): ArcChoice[] =>
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
  expect(end.x).toBeCloseTo(336);
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
  expect(focused()).toBe("4 in");
  for (let i = 0; i < 9; i++) {
    fireEvent.keyDown(window, { key: "ArrowDown" });
    act(() => { vi.advanceTimersByTime(600); });
  }
  // Nine steps from 4 in: past 12 in, over the gap without stopping, round to 1 in.
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

it("glides with the mouse wheel and comes to rest on a whole choice", () => {
  render(
    <ArcScrollerSurface>
      <Stage options={sizes()} />
    </ArcScrollerSurface>,
  );
  fireEvent.contextMenu(screen.getByText("Blank stage"), { button: 2, clientX: 330, clientY: 400 });
  expect(focused()).toBe("4 in");
  const first = arc()!.querySelector<HTMLElement>('[aria-label="5 in"]')!.style.transform;
  fireEvent.wheel(arc()!, { deltaY: 40 });
  act(() => { vi.advanceTimersByTime(32); });
  // Part way between choices rather than a whole step at once.
  const moving = arc()!.querySelector<HTMLElement>('[aria-label="5 in"]')!.style.transform;
  expect(moving).not.toBe(first);
  expect(focused()).toBe("4 in");
  fireEvent.wheel(arc()!, { deltaY: 40 });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(focused()).toBe("5 in");
});

const popularSizes = ["11 in", "9 in", "12 in", "8 in", "5 in", "2 in", "10 in", "1 in", "7 in"];
const sizeUsage = Object.fromEntries(popularSizes.map((label, rank) => [wheelUsageId("Select Size", label), 100 - rank]));

it("centres the eight most-used shortcuts before a gap and the entire original list", () => {
  const options = sizes();
  const ranked = rankArcChoices("Select Size", options, sizeUsage);
  expect(ranked.slice(0, 8).map(choice => choice?.label)).toEqual([
    "10 in", "5 in", "12 in", "11 in", "9 in", "8 in", "2 in", "1 in",
  ]);
  expect(ranked[8]).toBeNull();
  expect(ranked.slice(9)).toEqual(options);
  expect(options.map(choice => choice.label)).toEqual(Array.from({ length: 12 }, (_, index) => `${index + 1} in`));
});

it("only promotes usable choices with real history, with stable ties and an unchanged no-history list", () => {
  const options = sizes();
  options[0]!.disabled = true;
  const ranked = rankArcChoices("Select Size", options, {
    [wheelUsageId("Select Size", "1 in")]: 100,
    [wheelUsageId("Select Size", "2 in")]: 5,
    [wheelUsageId("Select Size", "3 in")]: 5,
    [wheelUsageId("Select Size", "4 in")]: -1,
    [wheelUsageId("Select Size", "5 in")]: Infinity,
    [wheelUsageId("Select Material", "6 in")]: 100,
  });
  expect(ranked.slice(0, 3).map(choice => choice?.label ?? null)).toEqual(["2 in", "3 in", null]);
  expect(ranked.slice(3)).toEqual(options);
  expect(rankArcChoices("Select Size", options, {})).toEqual(options);
});

it("opens on the favourite, skips the separator both ways, and keeps regular choices in order", () => {
  const select = vi.fn();
  render(<ArcScrollerSurface usage={sizeUsage}><Stage options={sizes(select)} /></ArcScrollerSurface>);
  hold();
  fireEvent.pointerUp(window, pointer);
  act(() => { vi.advanceTimersByTime(500); });
  expect(focused()).toBe("11 in");
  expect(arc()!.querySelector("[data-focus]")).toHaveAttribute("data-arc-section", "frequent");
  fireEvent.click(screen.getByRole("button", { name: "Choose 11 in" }));
  expect(select).toHaveBeenCalledExactlyOnceWith(11);
  const step = (key = "ArrowDown") => {
    fireEvent.keyDown(window, { key });
    act(() => { vi.advanceTimersByTime(600); });
  };
  for (let i = 0; i < 5; i++) step();
  expect(focused()).toBe("1 in");
  expect(arc()!.querySelector("[data-focus]")).toHaveAttribute("data-arc-section", "regular");
  expect(arc()!.querySelector('[data-arc-gap="frequent"]')).not.toBeNull();
  step("ArrowUp");
  expect(arc()!.querySelector("[data-focus]")).toHaveAttribute("data-arc-section", "frequent");
  step();
  const regular = [focused()];
  for (let i = 1; i < 12; i++) { step(); regular.push(focused()); }
  expect(regular).toEqual(Array.from({ length: 12 }, (_, index) => `${index + 1} in`));
  fireEvent.click(screen.getByRole("button", { name: "Choose 12 in" }));
  expect(select.mock.calls).toEqual([[11], [12]]);
  step();
  expect(focused()).toBe("10 in");
  expect(arc()!.querySelector("[data-focus]")).toHaveAttribute("data-arc-section", "frequent");
  step("ArrowUp");
  expect(focused()).toBe("12 in");
});

it("resets each new stage to its own most-used choice and refreshes the shortcut callback", () => {
  const oldSelect = vi.fn(), latestSelect = vi.fn();
  const usage = { ...sizeUsage, [wheelUsageId("Select Category", "Tee")]: 20 };
  const view = render(<ArcScrollerSurface usage={usage}><Stage options={sizes(oldSelect)} /></ArcScrollerSurface>);
  fireEvent.contextMenu(screen.getByText("Blank stage"), { button: 2, clientX: 330, clientY: 400 });
  expect(focused()).toBe("11 in");
  view.rerender(<ArcScrollerSurface usage={usage}><Stage options={sizes(latestSelect)} /></ArcScrollerSurface>);
  fireEvent.click(screen.getByRole("button", { name: "Choose 11 in" }));
  expect(oldSelect).not.toHaveBeenCalled();
  expect(latestSelect).toHaveBeenCalledExactlyOnceWith(11);
  view.rerender(<ArcScrollerSurface usage={usage}><Stage title="Select Category" options={[
    { label: "Elbow", select: latestSelect }, { label: "Tee", select: latestSelect },
  ]} /></ArcScrollerSurface>);
  expect(focused()).toBe("Tee");
  expect(arc()).toHaveAttribute("aria-label", "Select Category");
});
