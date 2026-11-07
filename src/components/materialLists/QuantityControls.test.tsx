import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuantityControls } from "./QuantityControls";
const { update } = vi.hoisted(() => ({
  update:
    vi.fn<
      (input: {
        quantity: number;
        itemId: string;
        materialListId: string;
      }) => Promise<void>
    >(),
}));
vi.mock("~/lib/replicache-material-list", () => ({
  saveQuantityDurably: update,
}));
vi.mock("~/lib/performance-marks", () => ({ markUserAction: vi.fn() }));
beforeEach(() => {
  update.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const props = { itemId: "item", materialListId: "list", quantity: 2 };
describe("durable quantity edits", () => {
  it("starts the local write before unmount, without a blur or timer", async () => {
    const view = render(<QuantityControls {...props} />);
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "20" },
    });
    view.unmount();
    expect(update).toHaveBeenCalledWith({
      itemId: "item",
      materialListId: "list",
      quantity: 20,
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
  it("keeps rapid edits ordered and increment uses the latest value", async () => {
    render(<QuantityControls {...props} />);
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByLabelText("Increase quantity"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(update.mock.calls.map((call) => call[0].quantity)).toEqual([
      3, 30, 31,
    ]);
  });
  it("shows storage failure and permits an Enter/blur retry", async () => {
    update.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    render(<QuantityControls {...props} />);
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "7" },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Quantity")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.blur(screen.getByLabelText("Quantity"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Quantity")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });
  it("does not persist empty or zero input", async () => {
    render(<QuantityControls {...props} />);
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "0" },
    });
    fireEvent.blur(screen.getByLabelText("Quantity"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Quantity")).toHaveValue("2");
  });
});

describe("required and purchase quantity display", () => {
  it("edits only the required amount while updating the supplier-adjusted amount immediately", async () => {
    render(
      <QuantityControls {...props} quantity={37} orderMultiple="25" compact />,
    );
    expect(screen.getByLabelText("Quantity")).toHaveValue("37");
    expect(screen.getByLabelText("Order quantity: 50")).toHaveTextContent(
      "(50)",
    );
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "51" },
    });
    expect(screen.getByLabelText("Order quantity: 75")).toHaveTextContent(
      "(75)",
    );
    expect(update).toHaveBeenCalledWith({
      itemId: "item",
      materialListId: "list",
      quantity: 51,
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
  it("updates purchasing when suppliers change without rewriting demand", () => {
    const view = render(
      <QuantityControls {...props} quantity={37} orderMultiple="25" />,
    );
    view.rerender(
      <QuantityControls {...props} quantity={37} orderMultiple="10" />,
    );
    expect(screen.getByLabelText("Quantity")).toHaveValue("37");
    expect(screen.getByLabelText("Order quantity: 40")).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });
});
