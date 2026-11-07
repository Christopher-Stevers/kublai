import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DrawingOverlayPicker } from "./DrawingOverlayPicker";
afterEach(cleanup);
it("groups drawings by set and preserves selection order across collapsed groups", () => {
  const drawings = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Sheet ${i}`, setId: i < 15 ? "a" : "b", setName: i < 15 ? "Architectural" : "Mechanical" }));
  const onCompare = vi.fn();
  render(<DrawingOverlayPicker drawings={drawings} initialFirstId="s0" initialSecondId="s1" onCompare={onCompare} onClose={vi.fn()} />);
  // Dialog is portalled.
  expect(document.querySelectorAll("details")).toHaveLength(2);
  expect(screen.getByText("Architectural")).toBeVisible();
  expect(screen.getByText("Mechanical")).toBeVisible();
  for (const group of document.querySelectorAll("details")) group.open = true;
  for (let i = 2; i < 30; i++) fireEvent.click(screen.getByLabelText(`Sheet ${i}`));
  fireEvent.click(screen.getByLabelText("Sheet 2"));
  fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
  expect(onCompare).toHaveBeenCalledWith("s0", "s1", drawings.slice(3).map(d => d.id));
});
it("can deselect the original drawing and rejects unavailable selections", () => {
  const drawings = [{ id: "a", name: "A101", setId: "set", setName: "Plans" }, { id: "b", name: "M101", setId: "set", setName: "Plans" }, { id: "c", name: "M101 revised", revision: "Rev 2", setId: "set", setName: "Plans" }];
  const onCompare = vi.fn(), onClose = vi.fn();
  const props = { drawings, initialFirstId: "a", onCompare, onClose };
  const view = render(<DrawingOverlayPicker {...props} />);
  document.querySelector("details")!.open = true;
  expect(screen.getByRole("button", { name: "Open overlay" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("A101"));
  fireEvent.click(screen.getByLabelText("M101"));
  fireEvent.click(screen.getByLabelText("Rev 2 · M101 revised"));
  fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
  expect(onCompare).toHaveBeenCalledWith("b", "c");
  view.rerender(<DrawingOverlayPicker {...props} drawings={drawings.slice(0, 2)} />);
  expect(screen.getByRole("button", { name: "Open overlay" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
});
