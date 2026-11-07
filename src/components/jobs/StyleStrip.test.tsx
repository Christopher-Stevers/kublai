import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StyleStrip } from "./StyleStrip";

afterEach(cleanup);

it("puts colours, widths and the end control on one line, each list scrolling on its own", () => {
  const onColor = vi.fn(), onWidth = vi.fn();
  render(
    <StyleStrip color="#DC2626" onColor={onColor} colorLabel="Colours" customColorLabel="Custom"
      width={3} onWidth={onWidth} end={<button type="button">Fill</button>} />,
  );
  const colours = screen.getByRole("group", { name: "Colours" });
  const widths = screen.getByRole("radiogroup", { name: "Line width" });
  const row = colours.parentElement!;
  expect(widths.parentElement).toBe(row);
  expect(row.lastElementChild).toBe(screen.getByRole("button", { name: "Fill" }));
  for (const list of [colours, widths]) expect(list).toHaveClass("flex-1", "basis-0", "min-w-0", "overflow-x-auto");
  expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("radio", { name: "Width 3" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Width 10" }));
  expect(onWidth).toHaveBeenCalledWith(10);
  fireEvent.change(screen.getByLabelText("Custom"), { target: { value: "#00ff88" } });
  expect(onColor).toHaveBeenCalledWith("#00ff88");
});

it("shows only the colours when there is no width to choose", () => {
  render(<StyleStrip color="#2563eb" onColor={vi.fn()} colorLabel="Colours" />);
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
});

it("turns a vertical wheel into sideways scrolling until the list ends", () => {
  render(<StyleStrip color="#2563eb" onColor={vi.fn()} colorLabel="Colours" />);
  const colours = screen.getByRole("group", { name: "Colours" });
  Object.defineProperty(colours, "scrollWidth", { configurable: true, value: 400 });
  Object.defineProperty(colours, "clientWidth", { configurable: true, value: 150 });
  const wheel = new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true });
  colours.dispatchEvent(wheel);
  expect(colours.scrollLeft).toBe(60);
  expect(wheel.defaultPrevented).toBe(true);
  colours.scrollLeft = 250;
  const atEnd = new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true });
  colours.dispatchEvent(atEnd);
  expect(atEnd.defaultPrevented).toBe(false);
});
