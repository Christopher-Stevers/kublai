import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { PackQuantityControls } from "./PackQuantityControls";
afterEach(cleanup);
function Example() {
  const [quantity, setQuantity] = useState(2);
  return (
    <PackQuantityControls
      quantity={quantity}
      piecesPerPack={50}
      onChange={setQuantity}
    />
  );
}
describe("pack and piece editing", () => {
  it("defaults to packs and preserves exact piece needs with whole-pack display", () => {
    render(<Example />);
    expect(screen.getByLabelText("Quantity in packs")).toHaveValue("2");
    expect(screen.getByText("(x100)")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Edit pieces: 100"));
    fireEvent.change(screen.getByLabelText("Quantity in pieces"), {
      target: { value: "70" },
    });
    expect(screen.getByLabelText("Pack quantity")).toHaveTextContent("2");
    expect(screen.getByText("(x70)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Switch to packs"));
    expect(screen.getByLabelText("Quantity in packs")).toHaveValue("2");
    fireEvent.change(screen.getByLabelText("Quantity in packs"), {
      target: { value: "3" },
    });
    expect(screen.getByText("(x150)")).toBeInTheDocument();
  });
  it("switches to pieces when decreasing beyond the pack list", () => {
    render(<Example />);
    fireEvent.click(screen.getByLabelText("Decrease quantity"));
    fireEvent.click(screen.getByLabelText("Decrease quantity"));
    expect(screen.getByLabelText("Quantity in pieces")).toBeInTheDocument();
  });
});
