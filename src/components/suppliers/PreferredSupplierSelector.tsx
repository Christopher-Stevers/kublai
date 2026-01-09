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
}

export function PreferredSupplierSelector({
  partDefinitionId,
  currentPreferredSupplierId,
  availableSuppliers,
}: PreferredSupplierSelectorProps) {
  const utils = api.useUtils();
  const setPreferredSupplier = api.supplier.setPreferredSupplier.useMutation({
    onSuccess: () => {
      void utils.supplier.getAllPartsWithPreferred.invalidate();
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
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        No suppliers available. Add this part to a supplier first.
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

