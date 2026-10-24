import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TableReceiveControls, type TableReceive } from "./TableReceive";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const base: TableReceive = {
  orderId: "o",
  orderNumber: "PO-7",
  orderHref: "/dashboard/material-lists/m?orderId=o",
  ordered: 10,
  received: 2,
  status: "partial",
  unit: "ea",
};
const show = (receive: Partial<TableReceive> = {}) => {
  const onChange = vi.fn();
  const view = render(
    <TableReceiveControls
      receive={{ ...base, onChange, ...receive }}
      name="Valve"
    />,
  );
  return { onChange, view };
};

it("saves stepper taps once after a pause", () => {
  vi.useFakeTimers();
  const { onChange } = show();
  expect(screen.getByText("Part received")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /PO-7/ })).toHaveAttribute(
    "href",
    base.orderHref,
  );
  const more = screen.getByRole("button", { name: "One more received: Valve" });
  fireEvent.click(more);
  fireEvent.click(more);
  fireEvent.click(
    screen.getByRole("button", { name: "One less received: Valve" }),
  );
  expect(screen.getByLabelText("Received: Valve")).toHaveValue(3);
  expect(screen.getByText("Back ordered 7 ea")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({
    receivedQuantity: 3,
    verificationStatus: "partial",
  });
});

it("sends a waiting count when the row goes away", () => {
  vi.useFakeTimers();
  const { onChange, view } = show();
  fireEvent.click(
    screen.getByRole("button", { name: "One more received: Valve" }),
  );
  view.unmount();
  expect(onChange).toHaveBeenCalledWith({
    receivedQuantity: 3,
    verificationStatus: "partial",
  });
});

it("receives all, marks a problem and takes a typed count", () => {
  const { onChange } = show();
  fireEvent.click(screen.getByRole("button", { name: /All/ }));
  expect(onChange).toHaveBeenLastCalledWith({
    receivedQuantity: 10,
    verificationStatus: "complete",
  });
  expect(screen.getByText("All received")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  fireEvent.click(screen.getByRole("button", { name: /Problem/ }));
  expect(onChange).toHaveBeenLastCalledWith({
    receivedQuantity: 10,
    verificationStatus: "problem",
  });
  expect(screen.getByRole("button", { name: /Problem/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const input = screen.getByLabelText("Received: Valve");
  fireEvent.change(input, { target: { value: "40" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith({
    receivedQuantity: 10,
    verificationStatus: "problem",
  });
  fireEvent.change(input, { target: { value: "4" } });
  fireEvent.blur(input);
  expect(onChange).toHaveBeenLastCalledWith({
    receivedQuantity: 4,
    verificationStatus: "problem",
  });
});

it("shows saved counts that come back", () => {
  const { view } = show();
  view.rerender(
    <TableReceiveControls
      receive={{ ...base, received: 6, status: "partial" }}
      name="Valve"
    />,
  );
  expect(screen.getByLabelText("Received: Valve")).toHaveValue(6);
});

it("only shows the count when the member cannot receive", () => {
  show({
    readOnly: true,
    received: 10,
    status: "complete",
    badge: <span>Slip +4</span>,
  });
  expect(screen.getByText("All received")).toBeInTheDocument();
  expect(screen.getByText("Slip +4")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Received: Valve")).not.toBeInTheDocument();
});
