"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "~/trpc/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { CheckIcon, StarIcon, PlusIcon, SearchIcon, ChevronDownIcon } from "lucide-react";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";

interface PartSuppliersDropdownProps {
  partDefinitionId: string;
  currentPreferredSupplierId: string | null;
  availableSuppliers: Array<{
    id: string;
    name: string;
    contactEmail?: string | null;
  }>;
}

export function PartSuppliersDropdown({
  partDefinitionId,
  currentPreferredSupplierId,
  availableSuppliers,
}: PartSuppliersDropdownProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const utils = api.useUtils();

  // Get suppliers for this part
  const { data: supplierParts } = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId },
    { enabled: isDropdownOpen && !!partDefinitionId },
  );

  // Get all suppliers
  const { data: allSuppliers } = api.supplier.list.useQuery(undefined, {
    enabled: isDropdownOpen,
  });

  // Add supplier mutation
  const addSupplierPart = api.supplier.addSupplierPart.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.getSupplierPartsByPart.cancel({ partDefinitionId });
      await utils.catalogue.getPartsSupplierInfo.cancel();

      // Snapshot previous values
      const previousSupplierParts = utils.supplier.getSupplierPartsByPart.getData({
        partDefinitionId,
      });
      const previousSupplierInfo = utils.catalogue.getPartsSupplierInfo.getData({
        partIds: [partDefinitionId],
      });

      // Find supplier info
      const supplier = allSuppliers?.find((s) => s.id === variables.supplierId);

      // Create temporary supplier part
      const tempId = `temp-${Date.now()}`;
      const tempSupplierPart = {
        id: tempId,
        supplierId: variables.supplierId,
        partDefinitionId: variables.partDefinitionId,
        supplierSku: variables.supplierSku ?? null,
        lastKnownUnitCost: null,
        isPreferred: false,
        supplier: supplier
          ? {
              id: supplier.id,
              name: supplier.name,
            }
          : null,
      };

      // Optimistically add to supplier parts
      utils.supplier.getSupplierPartsByPart.setData(
        { partDefinitionId },
        (old) => {
          if (!old) return [tempSupplierPart];
          return [...old, tempSupplierPart];
        },
      );

      // Optimistically update supplier info
      utils.catalogue.getPartsSupplierInfo.setData(
        { partIds: [partDefinitionId] },
        (old) => {
          if (!old) {
            return {
              [partDefinitionId]: {
                preferredSupplier: null,
                availableSuppliers: supplier ? [supplier] : [],
              },
            };
          }
          const current = old[partDefinitionId] || {
            preferredSupplier: null,
            availableSuppliers: [],
          };
          return {
            ...old,
            [partDefinitionId]: {
              ...current,
              availableSuppliers: supplier
                ? [...current.availableSuppliers, supplier]
                : current.availableSuppliers,
            },
          };
        },
      );

      return { previousSupplierParts, previousSupplierInfo };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplierParts !== undefined) {
        utils.supplier.getSupplierPartsByPart.setData(
          { partDefinitionId },
          context.previousSupplierParts,
        );
      }
      if (context?.previousSupplierInfo !== undefined) {
        utils.catalogue.getPartsSupplierInfo.setData(
          { partIds: [partDefinitionId] },
          context.previousSupplierInfo,
        );
      }
    },
    onSettled: () => {
      void utils.supplier.getSupplierPartsByPart.invalidate({
        partDefinitionId,
      });
      void utils.catalogue.getPartsSupplierInfo.invalidate();
    },
  });

  // Remove supplier mutation
  const removeSupplierPart = api.supplier.removeSupplierPart.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.getSupplierPartsByPart.cancel({ partDefinitionId });
      await utils.catalogue.getPartsSupplierInfo.cancel();

      // Snapshot previous values
      const previousSupplierParts = utils.supplier.getSupplierPartsByPart.getData({
        partDefinitionId,
      });
      const previousSupplierInfo = utils.catalogue.getPartsSupplierInfo.getData({
        partIds: [partDefinitionId],
      });

      // Find supplier part to get supplier ID
      const supplierPart = supplierParts?.find((sp) => sp.id === variables.id);
      const supplierId = supplierPart?.supplierId;

      // Optimistically remove from supplier parts
      utils.supplier.getSupplierPartsByPart.setData(
        { partDefinitionId },
        (old) => {
          if (!old) return old;
          return old.filter((sp) => sp.id !== variables.id);
        },
      );

      // Optimistically update supplier info
      if (supplierId) {
        utils.catalogue.getPartsSupplierInfo.setData(
          { partIds: [partDefinitionId] },
          (old) => {
            if (!old) return old;
            const current = old[partDefinitionId];
            if (!current) return old;
            return {
              ...old,
              [partDefinitionId]: {
                ...current,
                availableSuppliers: current.availableSuppliers.filter(
                  (s) => s.id !== supplierId,
                ),
                preferredSupplier:
                  current.preferredSupplier?.id === supplierId
                    ? null
                    : current.preferredSupplier,
              },
            };
          },
        );
      }

      return { previousSupplierParts, previousSupplierInfo };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplierParts !== undefined) {
        utils.supplier.getSupplierPartsByPart.setData(
          { partDefinitionId },
          context.previousSupplierParts,
        );
      }
      if (context?.previousSupplierInfo !== undefined) {
        utils.catalogue.getPartsSupplierInfo.setData(
          { partIds: [partDefinitionId] },
          context.previousSupplierInfo,
        );
      }
    },
    onSettled: () => {
      void utils.supplier.getSupplierPartsByPart.invalidate({
        partDefinitionId,
      });
      void utils.catalogue.getPartsSupplierInfo.invalidate();
    },
  });

  // Set preferred supplier mutation
  const setPreferredSupplier = api.supplier.setPreferredSupplier.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.getSupplierPartsByPart.cancel({ partDefinitionId });
      await utils.catalogue.getPartsSupplierInfo.cancel();

      // Snapshot previous values
      const previousSupplierParts = utils.supplier.getSupplierPartsByPart.getData({
        partDefinitionId,
      });
      const previousSupplierInfo = utils.catalogue.getPartsSupplierInfo.getData({
        partIds: [partDefinitionId],
      });

      // Find supplier
      const supplier = allSuppliers?.find((s) => s.id === variables.supplierId);

      // Optimistically update supplier parts (set all to not preferred, then set selected)
      utils.supplier.getSupplierPartsByPart.setData(
        { partDefinitionId },
        (old) => {
          if (!old) return old;
          return old.map((sp) => ({
            ...sp,
            isPreferred: sp.supplierId === variables.supplierId,
          }));
        },
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

      return { previousSupplierParts, previousSupplierInfo };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplierParts !== undefined) {
        utils.supplier.getSupplierPartsByPart.setData(
          { partDefinitionId },
          context.previousSupplierParts,
        );
      }
      if (context?.previousSupplierInfo !== undefined) {
        utils.catalogue.getPartsSupplierInfo.setData(
          { partIds: [partDefinitionId] },
          context.previousSupplierInfo,
        );
      }
    },
    onSettled: () => {
      void utils.supplier.getSupplierPartsByPart.invalidate({
        partDefinitionId,
      });
      void utils.catalogue.getPartsSupplierInfo.invalidate();
    },
  });

  // Get supplier IDs that have this part
  const supplierIdsWithPart = new Set(
    supplierParts?.map((sp) => sp.supplierId) ?? [],
  );

  // Get preferred supplier ID
  const preferredSupplierId =
    supplierParts?.find((sp) => sp.isPreferred)?.supplierId ??
    currentPreferredSupplierId;

  // Filter suppliers based on search
  const filteredSuppliers = useMemo(() => {
    if (!allSuppliers) return [];
    if (!debouncedSearchQuery.trim()) return allSuppliers;

    const query = debouncedSearchQuery.toLowerCase().trim();
    return allSuppliers.filter((supplier) =>
      supplier.name.toLowerCase().includes(query),
    );
  }, [allSuppliers, debouncedSearchQuery]);

  const handleToggleSupplier = (supplierId: string) => {
    const hasPart = supplierIdsWithPart.has(supplierId);
    
    if (hasPart) {
      // Remove supplier
      const supplierPart = supplierParts?.find(
        (sp) => sp.supplierId === supplierId,
      );
      if (supplierPart) {
        removeSupplierPart.mutate({ id: supplierPart.id });
      }
    } else {
      // Add supplier (API will use default price)
      addSupplierPart.mutate({
        supplierId,
        partDefinitionId,
        supplierSku: "",
        currency: "CAD",
      });
    }
  };

  const handleTogglePreferred = (supplierId: string) => {
    // Only set as preferred if not already preferred
    // If already preferred, do nothing (or could cycle to next if multiple suppliers)
    if (preferredSupplierId !== supplierId) {
      setPreferredSupplier.mutate({
        partDefinitionId,
        supplierId,
      });
    }
  };

  const handleSupplierCreated = (newSupplierId: string) => {
    // Automatically add the new supplier to this part
    addSupplierPart.mutate({
      supplierId: newSupplierId,
      partDefinitionId,
      supplierSku: "",
      currency: "CAD",
    });
    setIsSupplierDialogOpen(false);
  };

  const currentSupplier = availableSuppliers.find(
    (s) => s.id === preferredSupplierId,
  );

  const displayValue = currentSupplier
    ? `${currentSupplier.name}`
    : "Select supplier";

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isDropdownOpen) {
      setSearchQuery("");
      setDebouncedSearchQuery("");
    }
  }, [isDropdownOpen]);

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            <span className="flex items-center gap-2">
              {preferredSupplierId && (
                <StarIcon className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              )}
              {displayValue}
            </span>
            <ChevronDownIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[var(--radix-dropdown-menu-trigger-width)]"
          align="start"
        >
          <div className="space-y-2 p-2">
            {/* Search Input */}
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search suppliers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>

            {/* Suppliers List */}
            <div className="max-h-[300px] overflow-y-auto">
              {filteredSuppliers.length === 0 ? (
                <div className="text-muted-foreground px-2 py-1.5 text-sm">
                  {debouncedSearchQuery.trim()
                    ? "No suppliers found"
                    : "No suppliers available"}
                </div>
              ) : (
                filteredSuppliers.map((supplier) => {
                  const hasPart = supplierIdsWithPart.has(supplier.id);
                  const isPreferred = preferredSupplierId === supplier.id;

                  return (
                    <DropdownMenuItem
                      key={supplier.id}
                      className="flex items-center justify-between p-2"
                      onSelect={(e) => e.preventDefault()}
                    >
                      <div className="flex flex-1 items-center gap-2">
                        {/* Checkbox */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSupplier(supplier.id);
                          }}
                          className="flex h-4 w-4 items-center justify-center rounded border border-gray-300 transition-colors hover:border-gray-400"
                          aria-label={
                            hasPart ? "Remove supplier" : "Add supplier"
                          }
                        >
                          {hasPart && (
                            <CheckIcon className="h-3 w-3 text-gray-900" />
                          )}
                        </button>

                        {/* Supplier Name */}
                        <span className="flex-1 text-sm">{supplier.name}</span>

                        {/* Star Icon */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasPart) {
                              handleTogglePreferred(supplier.id);
                            }
                          }}
                          className={`flex h-4 w-4 items-center justify-center transition-colors ${
                            hasPart
                              ? "cursor-pointer hover:opacity-70"
                              : "cursor-not-allowed opacity-30"
                          }`}
                          disabled={!hasPart}
                          aria-label={
                            isPreferred
                              ? "Unset as preferred"
                              : "Set as preferred"
                          }
                        >
                          <StarIcon
                            className={`h-4 w-4 ${
                              isPreferred
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-gray-400"
                            }`}
                          />
                        </button>
                      </div>
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>

            {/* Add New Supplier */}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setIsDropdownOpen(false);
                setIsSupplierDialogOpen(true);
              }}
              className="cursor-pointer font-medium"
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Add New Supplier...
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Supplier Form Dialog */}
      <SupplierFormDialog
        open={isSupplierDialogOpen}
        onOpenChange={setIsSupplierDialogOpen}
        onSupplierCreated={handleSupplierCreated}
      />
    </>
  );
}

