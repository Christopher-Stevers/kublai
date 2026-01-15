"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { ChevronDownIcon, StarIcon, CheckIcon } from "lucide-react";

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
            return {
              ...old,
              [partDefinitionId]: {
                ...current,
                preferredSupplier: supplier,
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

  const handleSelect = (supplierId: string) => {
    setPreferredSupplier.mutate({
      partDefinitionId,
      supplierId,
    });
  };

  if (availableSuppliers.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm">
        <p className="text-muted-foreground mb-2">
          No suppliers available. Add this part to a supplier first.
        </p>
        {onManageSuppliers && (
          <Button
            variant="outline"
            size="sm"
            onClick={onManageSuppliers}
            className="mt-2"
          >
            Manage Suppliers
          </Button>
        )}
      </div>
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


