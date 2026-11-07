import { afterEach, expect, it, vi } from "vitest";
import {
  act,
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
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
  expect(within(card as HTMLElement).queryByRole("spinbutton")).toBeNull();
  expect(
    within(card as HTMLElement).queryByRole("button", {
      name: "Increase quantity",
    }),
  ).toBeNull();
  expect(
    within(card as HTMLElement).getByRole("button", { name: "Next" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(card, { key: "Enter" });
  expect(p.onUpdateQuantity).toHaveBeenCalledWith("cap", 1);
  fireEvent.click(
    within(card as HTMLElement).getByRole("button", { name: "Remove part" }),
  );
  expect(p.onRemovePendingPart).toHaveBeenCalledWith("cap");
  fireEvent.click(screen.getByRole("button", { name: "Table view" }));
  expect(screen.getByText("Supplier")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), {
    target: { value: "5" },
  });
  expect(p.onSetQuantity).toHaveBeenCalledWith("cap", 5);
});
it("keeps tool requests free of supplier selectors and prices", () => {
  render(<ChosenPartsView {...props()} isToolRequest />);
  expect(screen.getByText("Tool room")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(screen.queryByText(/Total:/)).toBeNull();
});

it("uses the Select Part drumroll and excludes supplier and remove buttons from the gesture", () => {
  vi.useFakeTimers();
  class TestPointerEvent extends MouseEvent {
    pointerId = 1;
    pointerType = "mouse";
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  const p = props(),
    preview = vi.fn();
  render(<ChosenPartsView {...p} onQuantityPickerPreviewChange={preview} />);
  const card = screen
    .getByRole("heading", { name: "4-inch Fernco Cap" })
    .closest('[data-slot="card"]')!;
  Object.assign(card, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => false,
  });
  fireEvent.pointerDown(card, { clientY: 300, button: 0 });
  act(() => vi.advanceTimersByTime(200));
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ partId: "cap", quantity: 2 }),
  );
  fireEvent.pointerMove(window, { clientY: 354 });
  fireEvent.pointerUp(window);
  expect(p.onSetQuantity).toHaveBeenCalledWith("cap", 5);
  preview.mockClear();
  for (const name of ["Remove part", "Next"]) {
    const button = within(card as HTMLElement).getByRole("button", { name });
    fireEvent.pointerDown(button, { clientY: 300, button: 0 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(button);
  }
  expect(preview).not.toHaveBeenCalled();
  expect(p.onUpdateQuantity).not.toHaveBeenCalled();
});
