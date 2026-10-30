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
      matchScore: 89,
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
it("shows read-only pairs with a central score, date proximity, packaging and source access", async () => {
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
  ).toEqual([
    "Order Description",
    "Order Qty",
    "Match",
    "Slip Description",
    "Slip Qty",
  ]);
  expect(screen.getByText("1 day after order")).toBeInTheDocument();
  expect(screen.getByText("25 per box")).toBeInTheDocument();
  expect(
    screen.getByLabelText("Product match score: 89 out of 100"),
  ).toHaveTextContent("89");
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

it("distinguishes unmatched and unknown scores without inventing confidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...data,
        rows: [
          { ...data.rows[0], matchScore: 0, order: null },
          { ...data.rows[0], matchScore: undefined },
          { ...data.rows[0], matchScore: 100 },
        ],
      }),
    ),
  );
  render(
    <OrderMatchPreview
      jobId="job"
      documentId="doc"
      orderId="order"
      readingKey="saved"
      sourceUrl="/source.pdf"
    />,
  );
  await screen.findByRole("table");
  expect(
    screen.getByLabelText("Product match score: 0 out of 100"),
  ).toHaveTextContent("0");
  expect(
    screen.getByLabelText("Product match score: 100 out of 100"),
  ).toHaveTextContent("100");
  expect(screen.getByLabelText("Match score unavailable")).toHaveTextContent(
    "—",
  );
});
