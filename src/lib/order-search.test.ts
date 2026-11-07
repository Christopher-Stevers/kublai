import { expect, it } from "vitest";
import { scoreOrderSearch } from "./order-search";

it("compact summaries preserve full item/SKU/quantity search and ranking for cached orders", () => {
  const order = {
    orderNumber: "PO-12",
    job: { name: "Alma" },
    supplier: { name: "Next" },
    items: [
      {
        quantity: "20",
        description: '8" XFR fitting 45',
        supplierSku: "XFR-8-45",
      },
      {
        quantity: "3",
        description: "2 inch reducing coupling",
        supplierSku: null,
      },
    ],
  };
  const compact = {
    ...order,
    items: [],
    searchableItems: order.items
      .flatMap((i) => [i.quantity, i.description, i.supplierSku])
      .filter(Boolean)
      .join(" "),
  };
  for (const query of [
    "",
    "20",
    "xfr 8 45",
    "coupling reducing",
    "alm next",
    "PO 12",
    "missing",
    "fittings",
  ]) {
    expect(scoreOrderSearch(compact, query)).toBe(
      scoreOrderSearch(order, query),
    );
  }
});
