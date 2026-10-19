import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  assign: vi.fn(),
  create: vi.fn(),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("./SupplierPartsDialog", () => ({ SupplierPartsDialog: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      supplierPriceBooks: { invalidate: vi.fn() },
      jobPricing: { invalidate: vi.fn() },
      materialList: { previewOrders: { invalidate: vi.fn() } },
    }),
    supplierPriceBooks: {
      list: {
        useQuery: () => ({
          data: {
            books: [{ id: "alma", name: "Alma", count: 1 }],
            canManage: true,
          },
        }),
      },
      get: {
        useQuery: ({ bookId }: { bookId: string | null }) => ({
          data: {
            supplier: { name: "Next" },
            book: bookId ? { id: bookId, name: "Alma", revision: 2 } : null,
            canManage: true,
            canAssign: true,
            showPrices: true,
            jobs: [{ id: "job", name: "Alma job", bookId: "alma" }],
            rows: [
              {
                id: "included",
                name: "Wye",
                sku: "001",
                included: true,
                unitCost: "5",
                priceStatus: "estimated",
              },
              {
                id: "outside",
                name: "Elbow",
                sku: "002",
                included: !bookId,
                unitCost: bookId ? null : "8",
                priceStatus: "none",
              },
            ],
          },
        }),
      },
      create: { useMutation: () => ({ mutate: state.create }) },
      saveEntry: { useMutation: () => ({ mutate: state.save }) },
      assign: { useMutation: () => ({ mutate: state.assign }) },
    },
  },
}));
import { SupplierPriceBooksDialog } from "./SupplierPriceBooksDialog";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows standard and Alma under one supplier and hides excluded parts until requested", () => {
  render(<SupplierPriceBooksDialog supplierId="next" onClose={() => {}} />);
  expect(screen.getByText("Next - Standard · Price Books")).toBeInTheDocument();
  expect(screen.getByText("Elbow")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Alma (1)" }));
  expect(screen.queryByText("Elbow")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Show all parts"));
  expect(screen.getByText("Elbow")).toBeInTheDocument();
  expect(screen.getByText(/Not in this book/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Include" }));
  fireEvent.change(screen.getByLabelText("Book price"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(state.save).toHaveBeenCalledWith({
    bookId: "alma",
    revision: 2,
    supplierPartId: "outside",
    included: true,
    unitCost: 4,
    priceStatus: "estimated",
  });
});
