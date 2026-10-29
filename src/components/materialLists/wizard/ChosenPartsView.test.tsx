import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ChosenPartsView, type ChosenPartsViewProps } from "./ChosenPartsView";
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    catalogue: { getPartsSupplierInfo: { useQuery: () => ({}) } },
    supplier: { getSupplierPartsByPart: { useQuery: () => ({}) } },
  },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-replicache-suppliers", () => ({
  useReplicacheSuppliers: () => [{ id: "next", name: "Next" }],
}));
vi.mock("~/components/catalogue/PartSuppliersDropdown", () => ({
  PartSuppliersDropdown: () => null,
}));
afterEach(cleanup);
const props = (): ChosenPartsViewProps => ({
  pendingParts: [
    {
      partId: "cap",
      quantity: 2,
      supplierPartId: "listing",
      partDefinition: {
        id: "cap",
        displayName: "4-inch Fernco Cap",
        imageUrl: null,
        material: null,
        size: null,
        jobPriceStatus: "confirmed",
      },
    },
  ],
  supplierPartsData: new Map([
    [
      "cap",
      [
        {
          id: "listing",
          supplierId: "next",
          supplierSku: null,
          lastKnownUnitCost: "10",
          isPreferred: true,
          supplier: { id: "next", name: "Next" },
        },
      ],
    ],
  ]),
  onUpdateQuantity: vi.fn(),
  onSetQuantity: vi.fn(),
  onUpdateSupplier: vi.fn(),
  onRemovePendingPart: vi.fn(),
  onCacheSupplierPart: vi.fn(),
  onSupplierPartResolutionStart: vi.fn(),
  allPartsHaveSuppliers: true,
});
it("uses the shared photo tile by default with supplier below quantity and working actions", () => {
  const p = props();
  render(<ChosenPartsView {...p} />);
  const card = screen
    .getByRole("heading", { name: "4-inch Fernco Cap" })
    .closest('[data-slot="card"]')!;
  expect(card.querySelector(".aspect-square")).not.toBeNull();
  expect(within(card as HTMLElement).getByText("Quoted")).toBeInTheDocument();
  const quantity = within(card as HTMLElement).getByRole("spinbutton", {
    name: "Quantity",
  });
  const supplier = within(card as HTMLElement).getByRole("button", {
    name: "Next",
  });
  expect(
    quantity.compareDocumentPosition(supplier) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(
    within(card as HTMLElement).getByRole("button", {
      name: "Increase quantity",
    }),
  );
  expect(p.onUpdateQuantity).toHaveBeenCalledWith("cap", 1);
  fireEvent.change(quantity, { target: { value: "5" } });
  expect(p.onSetQuantity).toHaveBeenCalledWith("cap", 5);
  fireEvent.click(
    within(card as HTMLElement).getByRole("button", { name: "Remove part" }),
  );
  expect(p.onRemovePendingPart).toHaveBeenCalledWith("cap");
  fireEvent.click(screen.getByRole("button", { name: "Table view" }));
  expect(screen.getByText("Supplier")).toBeInTheDocument();
});
it("keeps tool requests free of supplier selectors and prices", () => {
  render(<ChosenPartsView {...props()} isToolRequest />);
  expect(screen.getByText("Tool room")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(screen.queryByText(/Total:/)).toBeNull();
});
