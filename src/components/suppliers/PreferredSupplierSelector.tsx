"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon, StarIcon, CheckIcon, AlertCircle } from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import {
  getOfflinePartSuppliers,
  setOfflinePartSuppliers,
  setOfflinePreferredSupplier,
} from "~/lib/offline-suppliers";

interface PreferredSupplierSelectorProps {
  partDefinitionId: string;
  currentPreferredSupplierId: string | null;
  availableSuppliers: Array<{
    id: string;
    name: string;
    contactEmail?: string | null;
  }>;
  onManageSuppliers?: () => void;
}

export function PreferredSupplierSelector({
  partDefinitionId,
  currentPreferredSupplierId,
  availableSuppliers,
}: PreferredSupplierSelectorProps) {
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const setPreferredSupplier = api.supplier.setPreferredSupplier.useMutation();

  const localSupplierParts = getOfflinePartSuppliers(partDefinitionId) ?? [];
  const effectivePreferredSupplierId =
    localSupplierParts.find((part) => part.isPreferred)?.supplierId ?? currentPreferredSupplierId;

  const currentSupplier = availableSuppliers.find(
    (s) => s.id === effectivePreferredSupplierId,
  );

  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: [partDefinitionId] },
    { enabled: isOnline && !!partDefinitionId },
  );

  const handleSelect = (supplierId: string) => {
    const cached = getOfflinePartSuppliers(partDefinitionId);
    if (cached) {
      setOfflinePreferredSupplier(partDefinitionId, supplierId);
    } else {
      setOfflinePartSuppliers(
        partDefinitionId,
        availableSuppliers.map((supplier) => ({
          id: `offline-supplier-part:${partDefinitionId}:${supplier.id}`,
          supplierId: supplier.id,
          partDefinitionId,
          supplierSku: null,
          lastKnownUnitCost: null,
          isPreferred: supplier.id === supplierId,
          supplier: { id: supplier.id, name: supplier.name },
        })),
      );
    }

    if (isOnline) {
      setPreferredSupplier.mutate({ partDefinitionId, supplierId });
    }
  };

  if (availableSuppliers.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setIsSupplierDialogOpen(true)}
          className="w-full rounded-md border border-amber-300 bg-amber-50 p-4 text-center text-sm transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center justify-center gap-2 text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>No suppliers available. Click to add suppliers.</span>
          </div>
        </button>
        <Dialog open={isSupplierDialogOpen} onOpenChange={setIsSupplierDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">Manage Suppliers</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Connect existing suppliers or create a new one for this part.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2 sm:py-4">
              <label className="text-xs font-medium sm:text-sm">Suppliers</label>
              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <PartSuppliersDropdown
                  partDefinitionId={partDefinitionId}
                  currentPreferredSupplierId={
                    supplierInfo?.[partDefinitionId]?.preferredSupplier?.id || null
                  }
                  availableSuppliers={
                    supplierInfo?.[partDefinitionId]?.availableSuppliers ?? []
                  }
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Select suppliers that provide this part and set a preferred supplier.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="flex items-center gap-2">
            {currentSupplier ? (
              <>
                <StarIcon className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                {currentSupplier.name}
              </>
            ) : (
              "Select preferred supplier"
            )}
          </span>
          <ChevronDownIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {availableSuppliers.map((supplier) => (
          <DropdownMenuItem
            key={supplier.id}
            onClick={() => handleSelect(supplier.id)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              {effectivePreferredSupplierId === supplier.id && (
                <StarIcon className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              )}
              {supplier.name}
            </span>
            {effectivePreferredSupplierId === supplier.id && (
              <CheckIcon className="h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
