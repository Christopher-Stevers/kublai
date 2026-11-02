"use client";
import type { SupplierVersion } from "~/lib/job-supplier-defaults";
import { supplierVersionLabel } from "~/lib/supplier-label";
import {
  buildSupplierChoices,
  type SupplierChoice,
} from "~/lib/supplier-choices";
import { SupplierChoiceItems } from "~/components/suppliers/SupplierChoiceItems";
import {
  SupplierLabelContext,
  useSupplierLabel,
} from "~/components/suppliers/SupplierLabel";

import { useState, useEffect, useContext, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  getOfflineSupplierPartsByPart,
  setOfflineSupplierPartsByPart,
  type OfflineSupplierPartOption,
} from "~/lib/offline-supplier-parts";

interface SupplierSelectorProps {
  currentVersion?: SupplierVersion | null;
  itemId: string;
  partDefinitionId: string;
  currentSupplierPartId: string | null | undefined;
  currentSupplierId?: string | null;
  materialListId: string;
  suppliers?: ReplicacheSupplier[];
  compact?: boolean;
}

const NO_SUPPLIER_PARTS: OfflineSupplierPartOption[] = [];
const NO_CHOICES: ReturnType<typeof buildSupplierChoices> = {
  standard: [],
  jobSpecific: [],
};

export function SupplierSelector({
  currentVersion,
  itemId,
  partDefinitionId,
  currentSupplierPartId,
  currentSupplierId,
  materialListId,
  suppliers,
  compact = false,
}: SupplierSelectorProps) {
  const supplierLabel = useSupplierLabel();
  const { entries } = useContext(SupplierLabelContext);
  const sandbox = useTutorialSandbox();
  const {
    getReplicache: getMaterialListReplicache,
    mutateAndSync: mutateMaterialListAndSync,
  } = useWorkspaceMutations();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [optimisticSupplierPartId, setOptimisticSupplierPartId] = useState(
    currentSupplierPartId ?? null,
  );
  const [optimisticSupplierId, setOptimisticSupplierId] = useState(
    currentSupplierId ?? null,
  );
  const [optimisticDisplayLabel, setOptimisticDisplayLabel] = useState<
    string | null
  >(null);
  // The choices are only worked out once the menu has been opened.
  const [hasOpened, setHasOpened] = useState(false);
  if (isDropdownOpen && !hasOpened) setHasOpened(true);
  // A job's quoted price must never overwrite another job's cached price.
  const cacheKey = `${partDefinitionId}:${materialListId}:standard`;

  // A saved choice replaces whatever was picked optimistically.
  const savedChoice = JSON.stringify([currentSupplierPartId ?? null, currentSupplierId ?? null, currentVersion?.bookId ?? null, currentVersion?.label ?? null]);
  const [shownChoice, setShownChoice] = useState(savedChoice);
  if (savedChoice !== shownChoice) {
    setShownChoice(savedChoice);
    setOptimisticSupplierPartId(currentSupplierPartId ?? null);
    setOptimisticSupplierId(currentSupplierId ?? null);
    setOptimisticDisplayLabel(null);
  }

  const subscribedSuppliers = useReplicacheSuppliers({ enabled: !suppliers });
  const allSuppliers = suppliers ?? subscribedSuppliers;

  // Saved prices are read again each time the menu opens or closes.
  const cachedSupplierParts = useMemo(
    () =>
      sandbox
        ? NO_SUPPLIER_PARTS
        : (getOfflineSupplierPartsByPart(cacheKey) ?? NO_SUPPLIER_PARTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isDropdownOpen re-reads the saved prices.
    [cacheKey, isDropdownOpen, sandbox],
  );

  const online = useOnlineStatus();
  const freshParts = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId, materialListId, pricingMode: "standard" },
    { enabled: !sandbox && online && isDropdownOpen, staleTime: 0 },
  );
  useEffect(() => {
    if (freshParts.data && !sandbox) {
      setOfflineSupplierPartsByPart(cacheKey, freshParts.data);
    }
  }, [freshParts.data, cacheKey, sandbox]);
  const supplierParts = freshParts.data ?? cachedSupplierParts;

  // Find current supplier part
  const currentSupplierPart = supplierParts?.find(
    (sp) => sp.id === optimisticSupplierPartId,
  );
  const currentSupplier = allSuppliers?.find(
    (supplier) => supplier.id === optimisticSupplierId,
  );

  const displayValue =
    optimisticDisplayLabel ??
    (currentSupplierPart
      ? currentSupplierPart.supplier.name
      : (currentSupplier?.name ?? "No supplier"));

  const groups = useMemo(
    () =>
      hasOpened
        ? buildSupplierChoices(
            partDefinitionId,
            allSuppliers,
            supplierParts,
            entries,
          )
        : NO_CHOICES,
    [hasOpened, partDefinitionId, allSuppliers, supplierParts, entries],
  );
  const handleSelect = (choice: SupplierChoice) => {
    setOptimisticSupplierPartId(choice.listing.id);
    setOptimisticSupplierId(choice.listing.supplierId);
    setOptimisticDisplayLabel(choice.label);
    setIsDropdownOpen(false);
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.updateItemSupplierPart({
        materialListId,
        itemId,
        supplierPartId: choice.listing.id,
        supplierId: choice.listing.supplierId,
        supplierPartSnapshot: choice.listing,
        supplierVersionSnapshot: choice.version,
        unitCost: Number(choice.listing.lastKnownUnitCost ?? 0),
      }),
    );
  };

  return (
    <div className="w-full">
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={`${compact ? "min-h-8 text-xs" : "min-h-10 sm:min-h-11"} h-auto w-full justify-between py-2`}
            style={compact ? { touchAction: "auto" } : undefined}
          >
            <span className="min-w-0 text-left whitespace-normal">
              {optimisticDisplayLabel ??
                (currentVersion
                  ? supplierVersionLabel(currentVersion)
                  : optimisticSupplierId
                    ? supplierLabel(
                        displayValue,
                        optimisticSupplierId,
                        partDefinitionId,
                        optimisticSupplierPartId,
                      )
                    : displayValue)}
            </span>
            <ChevronDownIcon className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="p-2"
          style={{
            width:
              "min(max(calc(var(--radix-dropdown-menu-trigger-width) * 2), 18rem), calc(100vw - 2rem))",
          }}
          align="start"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="max-h-[min(320px,60vh)] overflow-y-auto">
            <SupplierChoiceItems
              groups={groups}
              onSelect={handleSelect}
              showPrices
            />
            {freshParts.isError && (
              <div
                role="status"
                className="text-muted-foreground px-2 py-2 text-xs"
              >
                Could not refresh supplier prices.{" "}
                {supplierParts.length
                  ? "Showing saved prices."
                  : "Try again when connected."}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
