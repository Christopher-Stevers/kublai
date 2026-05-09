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
import { Search, ChevronDownIcon } from "lucide-react";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";
import {
  applyOfflineSupplierPartUpdate,
  enqueueOfflineMutation,
  setActiveItemSyncStatus,
} from "~/lib/offline-material-list-mutations";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineSuppliers } from "~/hooks/use-offline-suppliers";
import {
  getOfflineSupplierPartsByPart,
  setOfflineSupplierPartsByPart,
} from "~/lib/offline-supplier-parts";
import {
  makeOfflineSupplierPartId,
  parseOfflineSupplierPartId,
} from "~/lib/offline-suppliers";

interface SupplierSelectorProps {
  itemId: string;
  partDefinitionId: string;
  currentSupplierPartId: string | null | undefined;
  currentSupplierId?: string | null;
  materialListId: string;
  compact?: boolean;
}

export function SupplierSelector({
  itemId,
  partDefinitionId,
  currentSupplierPartId,
  currentSupplierId,
  materialListId,
  compact = false,
}: SupplierSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [pendingSupplierName, setPendingSupplierName] = useState("");
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
    Array<{
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      isPreferred: boolean;
      supplier: { id: string; name: string };
    }>
  >([]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setOptimisticSupplierPartId(currentSupplierPartId ?? null);
    setOptimisticSupplierId(currentSupplierId ?? null);
  }, [currentSupplierPartId, currentSupplierId]);

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const updateItem = api.materialList.updateMaterialListItem.useMutation({
    onMutate: () => {
      void setActiveItemSyncStatus(materialListId, itemId, "syncing");
    },
    onError: () => {
      void setActiveItemSyncStatus(materialListId, itemId, "pending");
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
    onSuccess: (updatedItem) => {
      if (updatedItem?.updatedAt) {
        utils.materialList.getMaterialList.setData(
          { materialListId },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      updatedAt: updatedItem.updatedAt,
                      syncVersion:
                        updatedItem.updatedAt instanceof Date
                          ? updatedItem.updatedAt.toISOString()
                          : String(updatedItem.updatedAt),
                    }
                  : item,
              ),
            };
          },
        );
      }
      void setActiveItemSyncStatus(materialListId, itemId, "synced");
      void utils.supplier.getSupplierPartsByPart.invalidate({
        partDefinitionId,
      });
    },
  });

  // Handle supplier creation - this will be called from SupplierFormDialog callback
  const handleSupplierCreated = async (supplierId: string) => {
    const supplierName = pendingSupplierName.trim();
    setOptimisticSupplierPartId(null);
    setOptimisticSupplierId(supplierId);
    setOptimisticDisplayLabel(supplierName || "Supplier");
    setIsSupplierDialogOpen(false);
    setPendingSupplierName("");
    setSearchQuery("");

    void setActiveItemSyncStatus(materialListId, itemId, "pending");
    updateItem.mutate({
      itemId,
      supplierPartId: null,
      supplierId,
    });
  };

  // Get all suppliers for the organization
  const { data: serverSuppliers } = api.supplier.list.useQuery(undefined, {
    enabled: isOnline,
  });
  const { data: allSuppliers } = useOfflineSuppliers(serverSuppliers);

  // Get supplier parts for this part definition
  const { data: serverSupplierParts } =
    api.supplier.getSupplierPartsByPart.useQuery(
      { partDefinitionId },
      { enabled: isOnline && !!partDefinitionId },
    );

  useEffect(() => {
    setCachedSupplierParts(
      getOfflineSupplierPartsByPart(partDefinitionId) ?? [],
    );
  }, [partDefinitionId, isOnline]);

  useEffect(() => {
    if (!isOnline || !serverSupplierParts) return;
    setOfflineSupplierPartsByPart(partDefinitionId, serverSupplierParts);
    setCachedSupplierParts(serverSupplierParts);
  }, [isOnline, partDefinitionId, serverSupplierParts]);

  const supplierParts = isOnline
    ? (serverSupplierParts ?? cachedSupplierParts)
    : cachedSupplierParts;

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
      ? `${currentSupplierPart.supplier.name}${
          currentSupplierPart.supplierSku
            ? ` (${currentSupplierPart.supplierSku})`
            : ""
        }`
      : (currentSupplier?.name ?? "No supplier"));

  const updateCachedSupplierPart = (
    selectedSupplierPart: NonNullable<typeof supplierParts>[number] | null,
  ) => {
    const unitCost = selectedSupplierPart?.lastKnownUnitCost
      ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
      : 0;

    utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
      if (!old) return old;

      const updatedItems = old.items.map((item) => {
        if (item.id !== itemId) return item;

        const quantity = item.quantity
          ? parseFloat(item.quantity.toString())
          : 0;
        const extendedPrice = quantity * unitCost;

        return {
          ...item,
          supplierPart: selectedSupplierPart
            ? {
                id: selectedSupplierPart.id,
                supplierId: selectedSupplierPart.supplierId,
                supplierSku: selectedSupplierPart.supplierSku,
                lastKnownUnitCost: selectedSupplierPart.lastKnownUnitCost,
                supplier: selectedSupplierPart.supplier,
              }
            : null,
          unitCost: unitCost.toString(),
          extendedPrice: extendedPrice.toString(),
        };
      });

      const materialTotal = updatedItems.reduce((sum, item) => {
        const price = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + price;
      }, 0);

      return {
        ...old,
        items: updatedItems,
        materialTotal,
      };
    });
  };

  // Filter suppliers based on search query
  const filteredSuppliers = useMemo(() => {
    if (!allSuppliers) return [];
    if (!debouncedSearchQuery.trim()) return allSuppliers;

    const query = debouncedSearchQuery.toLowerCase().trim();
    return allSuppliers.filter((supplier) =>
      supplier.name.toLowerCase().includes(query),
    );
  }, [allSuppliers, debouncedSearchQuery]);

  // Get supplier IDs that already have supplier parts for this part
  const supplierIdsWithParts = new Set(
    supplierParts?.map((sp) => sp.supplierId) ?? [],
  );

  // Filter out suppliers that already have supplier parts
  const suppliersWithoutParts = filteredSuppliers.filter(
    (supplier) => !supplierIdsWithParts.has(supplier.id),
  );

  // Check if search query matches any existing supplier
  const hasMatchingSupplier = filteredSuppliers.length > 0;
  const showCreateOption =
    debouncedSearchQuery.trim().length > 0 &&
    !hasMatchingSupplier &&
    !supplierParts?.some(
      (sp) =>
        sp.supplier.name.toLowerCase() === debouncedSearchQuery.toLowerCase(),
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
      selectedSupplierPart
        ? `${selectedSupplierPart.supplier.name}${
            selectedSupplierPart.supplierSku
              ? ` (${selectedSupplierPart.supplierSku})`
              : ""
          }`
        : "No supplier",
    );
    updateCachedSupplierPart(selectedSupplierPart);
    setIsDropdownOpen(false);
    setSearchQuery("");

    if (typeof window !== "undefined" && !window.navigator.onLine) {
      const unitCost = selectedSupplierPart?.lastKnownUnitCost
        ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
        : 0;

      void applyOfflineSupplierPartUpdate(materialListId, itemId, {
        supplierPartId: nextSupplierPartId,
        supplierId: selectedSupplierPart?.supplierId ?? null,
        unitCost,
        supplierPartSnapshot: selectedSupplierPart
          ? {
              id: selectedSupplierPart.id,
              supplierId: selectedSupplierPart.supplierId,
              supplierSku: selectedSupplierPart.supplierSku,
              lastKnownUnitCost: selectedSupplierPart.lastKnownUnitCost,
              supplier: selectedSupplierPart.supplier,
            }
          : null,
      });
      void enqueueOfflineMutation({
        type: "updateItemSupplierPart",
        materialListId,
        itemId,
        supplierPartId: nextSupplierPartId,
        supplierId: selectedSupplierPart?.supplierId ??
          (nextSupplierPartId
            ? parseOfflineSupplierPartId(nextSupplierPartId)?.supplierId
            : undefined),
        partDefinitionId,
        unitCost,
        supplierPartSnapshot: selectedSupplierPart
          ? {
              id: selectedSupplierPart.id,
              supplierId: selectedSupplierPart.supplierId,
              supplierSku: selectedSupplierPart.supplierSku,
              lastKnownUnitCost: selectedSupplierPart.lastKnownUnitCost,
              supplier: selectedSupplierPart.supplier,
            }
          : null,
        queuedAt: new Date().toISOString(),
      });
      void utils.materialList.getMaterialList.invalidate({ materialListId });
      return;
    }

    void setActiveItemSyncStatus(materialListId, itemId, "pending");
    updateItem.mutate({
      itemId,
      supplierPartId: nextSupplierPartId,
      supplierId: selectedSupplierPart?.supplierId ?? null,
    });
  };

  const handleSupplierSelect = (supplierId: string) => {
    const selectedSupplier = allSuppliers?.find(
      (supplier) => supplier.id === supplierId,
    );
    if (!selectedSupplier) return;

    setOptimisticSupplierPartId(null);
    setOptimisticSupplierId(selectedSupplier.id);
    setOptimisticDisplayLabel(selectedSupplier.name);
    updateCachedSupplierPart(null);
    setIsDropdownOpen(false);
    setSearchQuery("");

    if (typeof window !== "undefined" && !window.navigator.onLine) {
      void applyOfflineSupplierPartUpdate(materialListId, itemId, {
        supplierPartId: null,
        supplierId: selectedSupplier.id,
        unitCost: 0,
        supplierPartSnapshot: null,
      });
      void enqueueOfflineMutation({
        type: "updateItemSupplierPart",
        materialListId,
        itemId,
        supplierPartId: null,
        supplierId: selectedSupplier.id,
        partDefinitionId,
        unitCost: 0,
        supplierPartSnapshot: null,
        queuedAt: new Date().toISOString(),
      });
      void utils.materialList.getMaterialList.invalidate({ materialListId });
      return;
    }

    void setActiveItemSyncStatus(materialListId, itemId, "pending");
    updateItem.mutate({
      itemId,
      supplierPartId: null,
      supplierId: selectedSupplier.id,
    });
  };

  const handleCreateSupplier = () => {
    setPendingSupplierName(debouncedSearchQuery.trim());
    setIsDropdownOpen(false);
    setIsSupplierDialogOpen(true);
  };

  return (
    <div className="w-full">
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={`${compact ? "h-8 text-xs" : "h-10 sm:h-11"} w-full justify-between`}
            style={compact ? { touchAction: "auto" } : undefined}
          >
            <span className="truncate">{displayValue}</span>
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
          <div className="space-y-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search suppliers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {/* Suppliers with part-specific information */}
              {supplierParts && supplierParts.length > 0 && (
                <>
                  <div className="text-muted-foreground px-2 py-1 text-xs font-medium">
                    Suppliers with part info
                  </div>
                  {supplierParts
                    .filter((sp) => {
                      if (!debouncedSearchQuery.trim()) return true;
                      const query = debouncedSearchQuery.toLowerCase();
                      return (
                        sp.supplier.name.toLowerCase().includes(query) ||
                        sp.supplierSku?.toLowerCase().includes(query)
                      );
                    })
                    .map((sp) => (
                      <DropdownMenuItem
                        key={sp.id}
                        onClick={() => handleSupplierPartSelect(sp.id)}
                        className="cursor-pointer"
                      >
                        {sp.supplier.name}
                        {sp.supplierSku ? ` (${sp.supplierSku})` : ""}
                        {sp.isPreferred && " ⭐"}
                      </DropdownMenuItem>
                    ))}
                </>
              )}

              {/* Suppliers without part-specific information */}
              {suppliersWithoutParts.length > 0 && (
                <>
                  {supplierParts && supplierParts.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  <div className="text-muted-foreground px-2 py-1 text-xs font-medium">
                    Other suppliers
                  </div>
                  {suppliersWithoutParts.map((supplier) => (
                    <DropdownMenuItem
                      key={supplier.id}
                      onClick={() => handleSupplierSelect(supplier.id)}
                      className="cursor-pointer"
                    >
                      {supplier.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {/* No results message */}
              {debouncedSearchQuery.trim() &&
                supplierParts?.filter((sp) => {
                  const query = debouncedSearchQuery.toLowerCase();
                  return (
                    sp.supplier.name.toLowerCase().includes(query) ||
                    sp.supplierSku?.toLowerCase().includes(query)
                  );
                }).length === 0 &&
                suppliersWithoutParts.length === 0 &&
                !showCreateOption && (
                  <div className="text-muted-foreground px-2 py-1.5 text-sm">
                    No suppliers found
                  </div>
                )}

              {/* Initial state message */}
              {!debouncedSearchQuery.trim() &&
                (!supplierParts || supplierParts.length === 0) &&
                (!allSuppliers || allSuppliers.length === 0) && (
                  <div className="text-muted-foreground px-2 py-1.5 text-sm">
                    Start typing to search or create...
                  </div>
                )}
            </div>

            {/* Create new supplier option */}
            {showCreateOption && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleCreateSupplier}
                  className="cursor-pointer font-medium"
                >
                  + Create new supplier: {debouncedSearchQuery.trim()}
                </DropdownMenuItem>
              </>
            )}

            {/* Always show create option if no suppliers exist */}
            {(!allSuppliers || allSuppliers.length === 0) &&
              !debouncedSearchQuery.trim() && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setPendingSupplierName("");
                      setIsDropdownOpen(false);
                      setIsSupplierDialogOpen(true);
                    }}
                    className="cursor-pointer font-medium"
                  >
                    + Create new supplier...
                  </DropdownMenuItem>
                </>
              )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <SupplierFormDialog
        open={isSupplierDialogOpen}
        onOpenChange={(open) => {
          setIsSupplierDialogOpen(open);
          if (!open) {
            setPendingSupplierName("");
          }
        }}
        initialName={pendingSupplierName}
        onSupplierCreated={handleSupplierCreated}
      />
    </div>
  );
}
