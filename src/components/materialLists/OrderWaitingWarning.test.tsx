import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { orderStillWaiting } from "~/lib/order-waiting";
import { OrderWaitingWarning } from "./OrderWaitingWarning";
import { DeliveryTracker } from "./DeliveryTracker";
import { materialSections } from "./MaterialSectionHeading";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";

afterEach(cleanup);

const item = (
  id: string,
  description: string,
  ordered: number,
  received: number,
  unit = "ea",
): ReceiptOrderItem => ({
  id,
  description,
  sku: "",
  aliases: [],
  ordered,
  received,
  verificationStatus: "pending",
  unit,
  piecesPerPack: null,
  individualUnit: null,
});

it("waits only once receiving has begun, and lists what is still to come", () => {
  expect(
    orderStillWaiting([item("a", "Valve", 10, 0), item("b", "Elbow", 4, 0)]),
  ).toEqual([]);
  expect(
    orderStillWaiting([
      item("a", "Valve", 10, 6),
      item("b", "Elbow", 4, 0),
      item("c", "Tee", 2, 2),
      item("d", "Cap", 1, 3),
    ]),
  ).toEqual([
    { description: "Valve", outstanding: 4, unit: "ea" },
    { description: "Elbow", outstanding: 4, unit: "ea" },
  ]);
  expect(orderStillWaiting([item("a", "Valve", 10, 10)])).toEqual([]);
});

it("shows a labelled triangle that opens the outstanding items", () => {
  render(
    <OrderWaitingWarning
      items={[
        { description: "Copper pipe", outstanding: 3, unit: "m" },
        { description: "Valve", outstanding: 4, unit: "ea" },
      ]}
    />,
  );
  const triangle = screen.getByRole("button", {
    name: "Still waiting for material: 2 items",
  });
  expect(triangle).toHaveAttribute(
    "title",
    "Still waiting for material\n3 m · Copper pipe\n4 · Valve",
  );
  fireEvent.keyDown(triangle, { key: "Enter" });
  const menu = screen.getByRole("menu");
  expect(menu).toHaveTextContent("Still waiting for material");
  expect(menu).toHaveTextContent("3 mCopper pipe");
  expect(menu).toHaveTextContent("4Valve");
});

it("shows nothing when the order waits for nothing", () => {
  const { container } = render(<OrderWaitingWarning items={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it("marks the order receiving summary when an order came short", () => {
  render(<DeliveryTracker items={[item("a", "Valve", 10, 6)]} slips={[]} />);
  expect(
    screen.getByRole("button", { name: "Still waiting for material: 1 item" }),
  ).toBeInTheDocument();
  cleanup();
  render(<DeliveryTracker items={[item("a", "Valve", 10, 0)]} slips={[]} />);
  expect(
    screen.queryByRole("button", { name: /Still waiting for material/ }),
  ).toBeNull();
});

it("gives an order section on the material list what it still waits for", () => {
  const order = (receivedQuantity: string) => ({
    id: "o1",
    number: "PO-1",
    status: "sent",
    quantity: "10",
    receivedQuantity,
  });
  const sections = materialSections(
    [
      {
        id: "a",
        sentOrderItemId: "x",
        sentOrder: order("6"),
        partDefinition: { displayName: "Valve" },
      },
      {
        id: "b",
        sentOrderItemId: "y",
        sentOrder: order("10"),
        descriptionSnapshot: "Elbow",
      },
    ],
    "m",
  );
  expect(sections[0]!.waiting).toEqual([
    { description: "Valve", outstanding: 4, unit: "" },
  ]);
  const unstarted = materialSections(
    [{ id: "a", sentOrderItemId: "x", sentOrder: order("0") }],
    "m",
  );
  expect(unstarted[0]!.waiting).toBeUndefined();
});
