import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawingOverlayPicker } from "./DrawingOverlayPicker";
afterEach(cleanup);
const drawings = [
  { id: "a", name: "A101" },
  { id: "b", name: "M101" },
  { id: "c", name: "M101 new", revision: "Rev 2" },
];
describe("overlay drawing picker", () => {
  it("allows any pair including an uploaded revision, independently of the current drawing", () => {
    const onCompare = vi.fn();
    render(
      <DrawingOverlayPicker
        drawings={drawings}
        initialFirstId="a"
        onClose={vi.fn()}
        onCompare={onCompare}
      />,
    );
    expect(screen.getByRole("button", { name: "Open overlay" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Drawing A"), {
      target: { value: "b" },
    });
    fireEvent.change(screen.getByLabelText("Drawing B"), {
      target: { value: "c" },
    });
    expect(
      screen.getAllByRole("option", { name: "Rev 2 · M101 new" }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(onCompare).toHaveBeenCalledWith("b", "c");
  });
  it("rejects the same source twice and never opens a removed drawing", () => {
    const props = {
      drawings,
      initialFirstId: "a",
      initialSecondId: "b",
      onClose: vi.fn(),
      onCompare: vi.fn(),
    };
    const view = render(<DrawingOverlayPicker {...props} />);
    fireEvent.change(screen.getByLabelText("Drawing B"), {
      target: { value: "a" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("two different");
    expect(screen.getByRole("button", { name: "Open overlay" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Drawing B"), {
      target: { value: "b" },
    });
    view.rerender(
      <DrawingOverlayPicker {...props} drawings={[drawings[0]!]} />,
    );
    expect(screen.getByRole("button", { name: "Open overlay" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onCompare).not.toHaveBeenCalled();
  });
});
