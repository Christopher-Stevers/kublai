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
import { Badge } from "~/components/ui/badge";
import { ChevronDownIcon, StarIcon, CheckIcon, AlertCircle } from "lucide-react";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";

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
  onManageSuppliers,
}: PreferredSupplierSelectorProps) {
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const utils = api.useUtils();
  const setPreferredSupplier = api.supplier.setPreferredSupplier.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.catalogue.getPartsSupplierInfo.cancel();

      // Snapshot previous value
      const previousSupplierInfo = utils.catalogue.getPartsSupplierInfo.getData({
        partIds: [partDefinitionId],
      });

      // Find supplier
      const supplier = availableSuppliers.find(
        (s) => s.id === variables.supplierId,
      );

      // Optimistically update supplier info
      if (supplier) {
        utils.catalogue.getPartsSupplierInfo.setData(
          { partIds: [partDefinitionId] },
          (old) => {
            const current = old?.[partDefinitionId] || {
              preferredSupplier: null,
              availableSuppliers: [],
            };
            // Find the full supplier object from availableSuppliers to match the expected type
            const fullSupplier = current.availableSuppliers.find(
              (s) => s.id === supplier.id,
            ) || supplier;
            return {
              ...old,
              [partDefinitionId]: {
                ...current,
                preferredSupplier: fullSupplier as typeof current.preferredSupplier,
              },
            };
          },
        );
      }

      return { previousSupplierInfo };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplierInfo !== undefined) {
        utils.catalogue.getPartsSupplierInfo.setData(
          { partIds: [partDefinitionId] },
          context.previousSupplierInfo,
        );
      }
    },
    onSettled: () => {
      void utils.supplier.getAllPartsWithPreferred.invalidate();
      void utils.catalogue.getPartsSupplierInfo.invalidate();
    },
  });

  const currentSupplier = availableSuppliers.find(
    (s) => s.id === currentPreferredSupplierId,
  );

  // Get supplier info for PartSuppliersDropdown
  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: [partDefinitionId] },
    { enabled: !!partDefinitionId },
  );

  const handleSelect = (supplierId: string) => {
    setPreferredSupplier.mutate({
      partDefinitionId,
      supplierId,
    });
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
        <Dialog 
          open={isSupplierDialogOpen} 
          onOpenChange={(open) => {
            setIsSupplierDialogOpen(open);
            if (!open) {
              void utils.catalogue.getPartsSupplierInfo.invalidate();
              void utils.supplier.getAllPartsWithPreferred.invalidate();
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">Manage Suppliers</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Connect existing suppliers or create a new one for this part.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2 sm:py-4">
              <div>
                <label className="text-xs font-medium sm:text-sm">
                  Suppliers
                </label>
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
              {currentPreferredSupplierId === supplier.id && (
                <StarIcon className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              )}
              {supplier.name}
            </span>
            {currentPreferredSupplierId === supplier.id && (
              <CheckIcon className="h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


