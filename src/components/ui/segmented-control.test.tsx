import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

afterEach(cleanup);

const options = [
  { value: "a", label: "Overlay" },
  { value: "b", label: "Changes" },
  { value: "c", label: "Wipe", disabled: true },
] as const;

it("chooses by click and steps past disabled segments with the arrow keys", () => {
  const onChange = vi.fn();
  render(<SegmentedControl label="Mode" value="b" options={options} onChange={onChange} />);
  const group = screen.getByRole("radiogroup", { name: "Mode" });
  expect(screen.getByRole("radio", { name: "Changes" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("radio", { name: "Overlay" }));
  expect(onChange).toHaveBeenLastCalledWith("a");
  fireEvent.keyDown(group, { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith("a");
  expect(screen.getByRole("radio", { name: "Wipe" })).toBeDisabled();
});
