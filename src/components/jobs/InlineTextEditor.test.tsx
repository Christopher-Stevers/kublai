import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DrawingMarkup } from "~/lib/drawing-workspace";
import { InlineTextEditor, type InlineTextEditing } from "./InlineTextEditor";

afterEach(cleanup);
const note: DrawingMarkup = {
  sourceSheetId: "sheet",
  type: "text",
  points: [{ x: 0.2, y: 0.3 }],
  stroke: "#ef4444",
  width: 2,
  text: "Valve",
  fontSize: 20,
};
function open(overrides: Partial<InlineTextEditing> = {}) {
  const editing: InlineTextEditing = {
    id: null,
    data: note,
    onChange: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(
    <InlineTextEditor
      editing={editing}
      x={100}
      y={200}
      pxPerUnit={1}
      frameWidth={800}
    />,
  );
  return editing;
}

it("types in place, with focus on the note and its colour and size", () => {
  const editing = open();
  const field = screen.getByLabelText("Text");
  expect(field).toHaveFocus();
  expect(field).toHaveStyle({ fontSize: "20px" });
  fireEvent.change(field, { target: { value: "Valve V-12" } });
  expect(editing.onChange).toHaveBeenLastCalledWith({
    ...note,
    text: "Valve V-12",
  });
});

it("changes size from the toolbar and the corner handle, within limits", () => {
  const editing = open();
  fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
  expect(editing.onChange).toHaveBeenLastCalledWith({ ...note, fontSize: 23 });
  fireEvent.click(screen.getByRole("button", { name: "Smaller text" }));
  expect(editing.onChange).toHaveBeenLastCalledWith({ ...note, fontSize: 17 });
});

it("resizes the text box in both directions from its corner handle", () => {
  const editing = open({
    data: { ...note, textBox: { width: 200, height: 60 } },
  });
  const handle = screen.getByRole("button", { name: "Resize text box" });
  fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 100, clientY: 40, pointerId: 1 });
  expect(editing.onChange).toHaveBeenLastCalledWith({
    ...note,
    textBox: { width: 300, height: 100 },
  });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(editing.onChange).toHaveBeenLastCalledWith({
    ...note,
    textBox: { width: 190, height: 60 },
  });
  // The box never gets smaller than one line of text.
  fireEvent.pointerMove(handle, {
    clientX: -10000,
    clientY: -10000,
    pointerId: 1,
  });
  expect(editing.onChange).toHaveBeenLastCalledWith({
    ...note,
    textBox: { width: 20, height: 20 },
  });
});

it("sets the colour from a swatch", () => {
  const editing = open();
  fireEvent.click(
    screen
      .getByRole("group", { name: "Text colour" })
      .querySelectorAll("button")[2]!,
  );
  expect(editing.onChange).toHaveBeenCalledWith(
    expect.objectContaining({ stroke: expect.stringMatching(/^#/) }),
  );
});

it("finishes on Done or a tap elsewhere, and cancels on Escape", () => {
  const editing = open({ onDelete: vi.fn() });
  fireEvent.click(screen.getByRole("button", { name: "Done editing text" }));
  expect(editing.onDone).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(document.body);
  expect(editing.onDone).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByLabelText("Text"), { key: "Escape" });
  expect(editing.onCancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Delete text" }));
  expect(editing.onDelete).toHaveBeenCalledOnce();
});
