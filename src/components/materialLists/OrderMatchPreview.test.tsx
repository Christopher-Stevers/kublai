import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { OrderMatchPreview } from "./OrderMatchPreview";
import type { OrderMatchComparison } from "~/lib/order-match-comparison";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const data: OrderMatchComparison = {
  orderId: "order",
  orderNumber: "183-Fastening House",
  orderDate: "2026-10-28",
  slipDate: "2026-10-29",
  rows: [
    {
      order: {
        description: "Rod hanger box",
        quantity: 10,
        unit: "box",
        piecesPerPack: 25,
      },
      slip: { description: "ROD HANGER", quantity: 250, unit: null },
    },
  ],
};
it("shows four read-only columns, date proximity, packaging and source access", async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json(data));
  vi.stubGlobal("fetch", fetcher);
  render(
    <OrderMatchPreview
      jobId="job"
      documentId="doc"
      orderId="order"
      readingKey="saved"
      sourceUrl="/source.pdf"
    />,
  );
  const table = await screen.findByRole("table");
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((x) => x.textContent),
  ).toEqual(["Order Description", "Order Qty", "Slip Description", "Slip Qty"]);
  expect(screen.getByText("1 day after order")).toBeInTheDocument();
  expect(screen.getByText("25 per box")).toBeInTheDocument();
  expect(screen.getByText("250")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View Slip" })).toHaveAttribute(
    "href",
    "/source.pdf",
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toContain("compareOrderId=order");
});
it("loads an alternate comparison without posting or changing the slip", async () => {
  const fetcher = vi.fn(async (url: string) =>
    Response.json({
      ...data,
      orderId: new URL(url, "https://example.test").searchParams.get(
        "compareOrderId",
      ),
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <OrderMatchPreview
      jobId="job"
      documentId="doc"
      orderId="order"
      readingKey="saved"
      sourceUrl="/source.pdf"
    />,
  );
  await screen.findByRole("table");
  view.rerender(
    <OrderMatchPreview
      jobId="job"
      documentId="doc"
      orderId="alternate"
      readingKey="saved"
      sourceUrl="/source.pdf"
    />,
  );
  await screen.findByRole("table");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toContain("compareOrderId=alternate");
});
