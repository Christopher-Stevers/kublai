import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { buildSupplierChoices } from "~/lib/supplier-choices";
import { SupplierChoiceItems } from "./SupplierChoiceItems";
const suppliers = [
  { id: "next", name: "Next" },
  { id: "fastening", name: "Fastening House" },
  { id: "room", name: "Tool Room", kind: "tool_room" },
];
const groups = buildSupplierChoices(
  "part",
  suppliers,
  [],
  [
    {
      supplierId: "next",
      supplierPartId: "listing",
      partDefinitionId: "part",
      priceBookName: "Alma",
      supplierPriceBookId: "book",
      unitCost: "6",
    },
  ],
);
afterEach(cleanup);
it("groups suppliers above job-specific choices and selects the explicit price source", () => {
  const onSelect = vi.fn();
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Select supplier</DropdownMenuTrigger>
      <DropdownMenuContent>
        <SupplierChoiceItems groups={groups} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  expect(
    within(screen.getByRole("group", { name: "Suppliers" }))
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Fastening House", "Next"]);
  const job = screen.getByRole("group", { name: "Job Specific" });
  fireEvent.click(within(job).getByRole("menuitem", { name: "Next - Alma" }));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({
      version: { supplierId: "next", bookId: "book", label: "Next - Alma" },
    }),
  );
  expect(screen.queryByText("Tool Room")).toBeNull();
});
it("omits the job-specific section when there are no applicable prices", () => {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Select supplier</DropdownMenuTrigger>
      <DropdownMenuContent>
        <SupplierChoiceItems
          groups={{ ...groups, jobSpecific: [] }}
          onSelect={vi.fn()}
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  expect(screen.queryByRole("group", { name: "Job Specific" })).toBeNull();
});
