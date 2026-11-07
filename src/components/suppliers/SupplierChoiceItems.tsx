import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
import type { SupplierChoice } from "~/lib/supplier-choices";

export function SupplierChoiceItems({
  groups,
  onSelect,
  showPrices = false,
}: {
  groups: { standard: SupplierChoice[]; jobSpecific: SupplierChoice[] };
  onSelect: (choice: SupplierChoice) => void;
  showPrices?: boolean;
}) {
  const options = (choices: SupplierChoice[]) =>
    choices.map((choice) => (
      <DropdownMenuItem
        key={choice.key}
        onSelect={() => onSelect(choice)}
        className="cursor-pointer justify-between gap-4 py-3"
      >
        <span className="min-w-0 whitespace-normal">{choice.label}</span>
        {showPrices && (
          <FinancialOnly>
            <span className="shrink-0 tabular-nums">
              {choice.listing.lastKnownUnitCost !== null &&
              Number.isFinite(Number(choice.listing.lastKnownUnitCost))
                ? Number(choice.listing.lastKnownUnitCost).toLocaleString(
                    "en-CA",
                    {
                      style: "currency",
                      currency: "CAD",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    },
                  )
                : "Not priced"}
            </span>
          </FinancialOnly>
        )}
      </DropdownMenuItem>
    ));
  return (
    <>
      <DropdownMenuGroup aria-label="Suppliers">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Suppliers
        </DropdownMenuLabel>
        {options(groups.standard)}
        {!groups.standard.length && (
          <DropdownMenuItem disabled>No suppliers available</DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {!!groups.jobSpecific.length && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label="Job Specific">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Job Specific
            </DropdownMenuLabel>
            {options(groups.jobSpecific)}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}
