import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SavedOrderReading } from "./SavedOrderReading";
import { makeReceivingOrderReading } from "~/lib/receiving-order-reading";
afterEach(cleanup);
it("labels partial saved details honestly and changes refresh copy without offering receiving controls", () => {
  const reading = makeReceivingOrderReading(
    {
      id: "order",
      jobId: "job",
      materialListId: "list",
      orderNumber: "PO-1",
      supplier: { name: "Supplier" },
      items: Array.from({ length: 40 }, (_, id) => ({
        id: String(id),
        descriptionSnapshot: `Part ${id}`,
        supplierSkuSnapshot: null,
        quantity: "10",
      })),
    },
    "job",
  )!;
  const view = render(
    <SavedOrderReading reading={reading} refreshing online />,
  );
  expect(screen.getByRole("region", { name: "Saved order" })).toBeVisible();
  expect(screen.getByText("Refreshing…")).toBeVisible();
  expect(screen.getByText("Showing 32 of 40 saved lines.")).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(32);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(
    <SavedOrderReading reading={reading} refreshing={false} online={false} />,
  );
  expect(screen.queryByText("Refreshing…")).toBeNull();
  expect(screen.getByText("Offline. Showing saved details.")).toBeVisible();
  view.rerender(
    <SavedOrderReading reading={reading} refreshing={false} online />,
  );
  expect(
    screen.getByText("Current order unavailable. Showing saved details."),
  ).toBeVisible();
});
