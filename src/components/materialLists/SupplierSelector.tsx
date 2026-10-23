"use client";
import {
  SupplierLabel,
  useSupplierLabel,
} from "~/components/suppliers/SupplierLabel";

import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
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
  currentVersion?: import("~/lib/job-supplier-defaults").SupplierVersion | null;
  itemId: string;
  partDefinitionId: string;
  currentSupplierPartId: string | null | undefined;
  currentSupplierId?: string | null;
  materialListId: string;
  suppliers?: ReplicacheSupplier[];
  compact?: boolean;
}

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
  const [cachedSupplierParts, setCachedSupplierParts] = useState<
    OfflineSupplierPartOption[]
  >([]);
  // A job's quoted price must never overwrite another job's cached price.
  const cacheKey = `${partDefinitionId}:${materialListId}`;

  useEffect(() => {
    setOptimisticSupplierPartId(currentSupplierPartId ?? null);
    setOptimisticSupplierId(currentSupplierId ?? null);
  }, [currentSupplierPartId, currentSupplierId]);

  const subscribedSuppliers = useReplicacheSuppliers({ enabled: !suppliers });
  const allSuppliers = suppliers ?? subscribedSuppliers;

  useEffect(() => {
    setCachedSupplierParts(
      sandbox ? [] : (getOfflineSupplierPartsByPart(cacheKey) ?? []),
    );
  }, [cacheKey, isDropdownOpen, sandbox]);

  const online = useOnlineStatus();
  const freshParts = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId, materialListId },
    { enabled: !sandbox && online && isDropdownOpen, staleTime: 0 },
  );
  useEffect(() => {
    if (freshParts.data && !sandbox) {
      setOfflineSupplierPartsByPart(cacheKey, freshParts.data);
      setCachedSupplierParts(freshParts.data);
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

  const supplierIdsWithParts = new Set(
    supplierParts.map((sp) => sp.supplierId),
  );
  const suppliersWithoutParts = allSuppliers.filter(
    (supplier) => !supplierIdsWithParts.has(supplier.id),
  );

  const handleSupplierPartSelect = (supplierPartId: string) => {
    const selectedSupplierPart =
      supplierPartId === "none"
        ? null
        : (supplierParts.find(
            (supplierPart) => supplierPart.id === supplierPartId,
          ) ?? null);
    const nextSupplierPartId =
      supplierPartId === "none" ? null : supplierPartId;

    setOptimisticSupplierPartId(nextSupplierPartId);
    setOptimisticSupplierId(selectedSupplierPart?.supplierId ?? null);
    setOptimisticDisplayLabel(
      selectedSupplierPart ? selectedSupplierPart.supplier.name : "No supplier",
    );
    setIsDropdownOpen(false);

    const unitCost = selectedSupplierPart?.lastKnownUnitCost
      ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
      : 0;

    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.updateItemSupplierPart({
        materialListId,
        itemId,
        supplierPartId: nextSupplierPartId,
        supplierId: selectedSupplierPart?.supplierId ?? null,
        supplierPartSnapshot: selectedSupplierPart,
        unitCost,
      }),
    );
  };

  const handleSupplierSelect = (supplierId: string) => {
    const selectedSupplier = allSuppliers?.find(
      (supplier) => supplier.id === supplierId,
    );
    if (!selectedSupplier) return;

    setOptimisticSupplierPartId(null);
    setOptimisticSupplierId(selectedSupplier.id);
    setOptimisticDisplayLabel(selectedSupplier.name);
    setIsDropdownOpen(false);

    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.updateItemSupplierPart({
        materialListId,
        itemId,
        supplierPartId: null,
        supplierId: selectedSupplier.id,
        unitCost: 0,
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
              {currentVersion && !optimisticDisplayLabel
                ? currentVersion.label
                : optimisticSupplierId
                  ? supplierLabel(
                      displayValue,
                      optimisticSupplierId,
                      partDefinitionId,
                      optimisticSupplierPartId,
                    )
                  : displayValue}
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
            {supplierParts.map((sp) => (
              <DropdownMenuItem
                key={sp.id}
                onClick={() => handleSupplierPartSelect(sp.id)}
                className="cursor-pointer justify-between gap-4 py-3"
              >
                <span className="min-w-0">
                  <SupplierLabel
                    name={sp.supplier.name}
                    supplierId={sp.supplierId}
                    partId={partDefinitionId}
                    listingId={sp.id}
                    bookName={sp.priceBookName}
                  />
                  {sp.isPreferred && " ⭐"}
                </span>
                <FinancialOnly>
                  <span className="shrink-0 tabular-nums">
                    {sp.lastKnownUnitCost !== null &&
                    Number.isFinite(Number(sp.lastKnownUnitCost))
                      ? Number(sp.lastKnownUnitCost).toLocaleString("en-CA", {
                          style: "currency",
                          currency: "CAD",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })
                      : "Not priced"}
                  </span>
                </FinancialOnly>
              </DropdownMenuItem>
            ))}
            {suppliersWithoutParts.map((supplier) => (
              <DropdownMenuItem
                key={supplier.id}
                onClick={() => handleSupplierSelect(supplier.id)}
                className="cursor-pointer justify-between gap-4 py-3"
              >
                <SupplierLabel
                  name={supplier.name}
                  supplierId={supplier.id}
                  partId={partDefinitionId}
                />
                <FinancialOnly>
                  <span className="text-muted-foreground shrink-0">
                    Not priced
                  </span>
                </FinancialOnly>
              </DropdownMenuItem>
            ))}
            {!supplierParts.length && !suppliersWithoutParts.length && (
              <div className="text-muted-foreground px-2 py-3 text-sm">
                No suppliers available
              </div>
            )}
            {freshParts.isError && (
              <div
                role="status"
                className="text-muted-foreground px-2 py-2 text-xs"
              >
                Could not refresh supplier prices.{" "}
                {cachedSupplierParts.length
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
