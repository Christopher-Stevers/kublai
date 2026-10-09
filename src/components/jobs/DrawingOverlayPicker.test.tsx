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
  it("adds more than 26 drawings, removes any selected layer, and avoids duplicating every option list", () => {
    const choices = Array.from({length:30},(_,i)=>({id:`sheet-${i}`,name:`Sheet ${i}`}));
    const onCompare=vi.fn();
    render(<DrawingOverlayPicker drawings={choices} initialFirstId="sheet-0" initialSecondId="sheet-1" onClose={vi.fn()} onCompare={onCompare} />);
    for(let i=2;i<30;i++) {
      fireEvent.click(screen.getByRole("button",{name:"Add drawing"}));
      fireEvent.change(screen.getByLabelText(i<26?`Drawing ${String.fromCharCode(65+i)}`:`Drawing ${i+1}`),{target:{value:`sheet-${i}`}});
    }
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button",{name:"Remove Drawing C"}));
    fireEvent.click(screen.getByRole("button",{name:"Open overlay"}));
    expect(onCompare).toHaveBeenCalledWith("sheet-0","sheet-1",choices.slice(3).map(choice=>choice.id));
  });
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
    expect(screen.getByRole("alert")).toHaveTextContent("different drawings");
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
