import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SupplierLabel, SupplierLabelContext } from "./SupplierLabel";
afterEach(cleanup);
it("updates part labels when the supplier preference changes while snapshots stay fixed", () => {
  const entries = [
    {
      supplierId: "next",
      supplierPartId: "listing",
      partDefinitionId: "wye",
      priceBookName: "Alma",
      preferJobPricing: true,
    },
  ];
  const view = (rows: typeof entries) => (
    <SupplierLabelContext.Provider value={{ entries: rows }}>
      <div>
        <SupplierLabel name="Next" supplierId="next" partId="wye" />
      </div>
      <div>
        <SupplierLabel name="Next" supplierId="next" partId="other" />
      </div>
      <div>
        <SupplierLabel name="Next" bookName="Original book" />
      </div>
    </SupplierLabelContext.Provider>
  );
  const result = render(view(entries));
  expect(screen.getByText("Next - Alma")).toBeInTheDocument();
  expect(screen.getByText("Next - Standard")).toBeInTheDocument();
  result.rerender(view([{ ...entries[0]!, preferJobPricing: false }]));
  expect(screen.getAllByText("Next - Standard")).toHaveLength(2);
  expect(screen.getByText("Next - Original book")).toBeInTheDocument();
});
