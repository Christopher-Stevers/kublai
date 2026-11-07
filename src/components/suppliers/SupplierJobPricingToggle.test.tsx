import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SupplierJobPricingToggle } from "./SupplierJobPricingToggle";
afterEach(cleanup);
it("defaults on and requests switching off", () => {
  const change = vi.fn();
  render(<SupplierJobPricingToggle onChange={change} />);
  const toggle = screen.getByRole("switch", { name: "Prefer Job Pricing" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(change).toHaveBeenCalledWith(false);
});
it("shows the saved off preference and can enable it", () => {
  const change = vi.fn();
  render(<SupplierJobPricingToggle checked={false} onChange={change} />);
  const toggle = screen.getByRole("switch");
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  expect(change).toHaveBeenCalledWith(true);
});
it("cannot change while disabled", () => {
  const change = vi.fn();
  render(<SupplierJobPricingToggle disabled onChange={change} />);
  fireEvent.click(screen.getByRole("switch"));
  expect(change).not.toHaveBeenCalled();
});
