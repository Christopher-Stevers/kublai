import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, it, expect } from "vitest";
import { PackQuantityControls } from "./PackQuantityControls";
afterEach(cleanup);
function Example() {
  const [quantity, setQuantity] = useState(2);
  return <PackQuantityControls quantity={quantity} piecesPerPack={2000} bulkUnit="box" individualUnit="pcs" onChange={setQuantity} />;
}
it("shows bulk units above plain individual quantities", () => {
  render(<Example />);
  expect(screen.getByLabelText("Quantity in box")).toHaveValue("2");
  expect(screen.getByText("boxes")).toBeInTheDocument();
  expect(screen.getByText("4000 pcs")).toBeInTheDocument();
  expect(screen.queryByText(/\(x/)).not.toBeInTheDocument();
});
it("edits individual demand and returns to the normal layout on blur", () => {
  render(<Example />);
  fireEvent.click(screen.getByLabelText("Edit pcs: 4000"));
  fireEvent.change(screen.getByLabelText("Quantity in pcs"), {target:{value:"4007"}});
  expect(screen.getByLabelText("Quantity in box")).toHaveValue("3");
  expect(screen.getByLabelText("Quantity in box")).toHaveClass("h-9");
  fireEvent.blur(screen.getByLabelText("Quantity in pcs"));
  expect(screen.queryByLabelText("Quantity in pcs")).not.toBeInTheDocument();
  expect(screen.getByText("4007 pcs")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Quantity in box"), {target:{value:"4"}});
  expect(screen.getByText("8000 pcs")).toBeInTheDocument();
});
it("finishes individual editing with Enter", () => {
  render(<Example />);
  fireEvent.click(screen.getByLabelText("Edit pcs: 4000"));
  fireEvent.keyDown(screen.getByLabelText("Quantity in pcs"), {key:"Enter"});
  expect(screen.getByText("4000 pcs")).toBeInTheDocument();
});
