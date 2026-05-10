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
import {
  CheckIcon,
  StarIcon,
  PlusIcon,
  SearchIcon,
  ChevronDownIcon,
} from "lucide-react";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineSuppliers } from "~/hooks/use-offline-suppliers";
import {
  OFFLINE_SUPPLIERS_EVENT,
  addOfflinePartSupplier,
  getOfflinePartSuppliers,
  removeOfflinePartSupplier,
  setOfflinePartSuppliers,
  setOfflinePreferredSupplier,
  type OfflinePartSupplier,
} from "~/lib/offline-suppliers";

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
  const [localSupplierParts, setLocalSupplierParts] = useState<OfflinePartSupplier[]>([]);

  const isOnline = useOnlineStatus();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isOnline && isDropdownOpen,
  });
  const canDeleteCoreRecords = userData?.permissions.canDeleteCoreRecords ?? true;

  const { data: serverSupplierParts } = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId },
    { enabled: isOnline && isDropdownOpen && !!partDefinitionId },
  );
  const { data: serverSuppliers } = api.supplier.list.useQuery(undefined, {
    enabled: isOnline && isDropdownOpen,
  });
  const { data: offlineSuppliers } = useOfflineSuppliers(serverSuppliers);

  const addSupplierPart = api.supplier.addSupplierPart.useMutation();
  const removeSupplierPart = api.supplier.removeSupplierPart.useMutation();
  const setPreferredSupplier = api.supplier.setPreferredSupplier.useMutation();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const cached = getOfflinePartSuppliers(partDefinitionId);
    if (cached) setLocalSupplierParts(cached);
  }, [partDefinitionId]);

  useEffect(() => {
    if (!serverSupplierParts) return;
    const normalized = serverSupplierParts.map((part) => ({
      ...part,
      partDefinitionId,
    }));
    setOfflinePartSuppliers(partDefinitionId, normalized);
    setLocalSupplierParts(normalized);
  }, [partDefinitionId, serverSupplierParts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setLocalSupplierParts(getOfflinePartSuppliers(partDefinitionId) ?? []);
    window.addEventListener(OFFLINE_SUPPLIERS_EVENT, onChange);
    return () => window.removeEventListener(OFFLINE_SUPPLIERS_EVENT, onChange);
  }, [partDefinitionId]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setSearchQuery("");
      setDebouncedSearchQuery("");
    }
  }, [isDropdownOpen]);

  const allSuppliers = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; contactEmail?: string | null }>();
    for (const supplier of availableSuppliers) byId.set(supplier.id, supplier);
    for (const supplier of offlineSuppliers ?? []) byId.set(supplier.id, supplier);
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [availableSuppliers, offlineSuppliers]);

  const supplierIdsWithPart = new Set(localSupplierParts.map((sp) => sp.supplierId));
  const preferredSupplierId =
    localSupplierParts.find((sp) => sp.isPreferred)?.supplierId ?? currentPreferredSupplierId;

  const filteredSuppliers = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return allSuppliers;
    const query = debouncedSearchQuery.toLowerCase().trim();
    return allSuppliers.filter((supplier) => supplier.name.toLowerCase().includes(query));
  }, [allSuppliers, debouncedSearchQuery]);

  const refreshLocalSupplierParts = () => {
    setLocalSupplierParts(getOfflinePartSuppliers(partDefinitionId) ?? []);
  };

  const handleToggleSupplier = (supplierId: string) => {
    const hasPart = supplierIdsWithPart.has(supplierId);

    if (hasPart) {
      if (!canDeleteCoreRecords || localSupplierParts.length <= 1) return;
      const supplierPart = localSupplierParts.find((sp) => sp.supplierId === supplierId);
      if (!supplierPart) return;
      removeOfflinePartSupplier(partDefinitionId, supplierPart.id);
      refreshLocalSupplierParts();
      if (isOnline && !supplierPart.id.startsWith("offline-supplier-part:")) {
        removeSupplierPart.mutate({ id: supplierPart.id });
      }
      return;
    }

    const supplier = allSuppliers.find((item) => item.id === supplierId);
    if (!supplier) return;
    const shouldAutoPrefer = !preferredSupplierId || localSupplierParts.length === 0;
    addOfflinePartSupplier(partDefinitionId, supplier, { isPreferred: shouldAutoPrefer, supplierSku: "" });
    refreshLocalSupplierParts();
    if (isOnline && /^[0-9a-f-]{36}$/i.test(supplierId)) {
      addSupplierPart.mutate({
        supplierId,
        partDefinitionId,
        supplierSku: "",
        isPreferred: shouldAutoPrefer,
        currency: "CAD",
      });
    }
  };

  const handleTogglePreferred = (supplierId: string) => {
    if (preferredSupplierId === supplierId) return;
    setOfflinePreferredSupplier(partDefinitionId, supplierId);
    refreshLocalSupplierParts();
    if (isOnline && /^[0-9a-f-]{36}$/i.test(supplierId)) {
      setPreferredSupplier.mutate({ partDefinitionId, supplierId });
    }
  };

  const handleSupplierCreated = (newSupplierId: string) => {
    const supplier = allSuppliers.find((item) => item.id === newSupplierId) ?? {
      id: newSupplierId,
      name: "New Supplier",
    };
    const shouldAutoPrefer = !preferredSupplierId || localSupplierParts.length === 0;
    addOfflinePartSupplier(partDefinitionId, supplier, { isPreferred: shouldAutoPrefer, supplierSku: "" });
    refreshLocalSupplierParts();
    setIsSupplierDialogOpen(false);
  };

  const currentSupplier = allSuppliers.find((s) => s.id === preferredSupplierId);
  const displayValue = currentSupplier ? currentSupplier.name : "Select supplier";

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

            <div className="max-h-[300px] overflow-y-auto">
              {filteredSuppliers.length === 0 ? (
                <div className="space-y-2 px-2 py-2">
                  <div className="text-muted-foreground text-sm">
                    {debouncedSearchQuery.trim() ? "No suppliers found" : "No suppliers available"}
                  </div>
                  {!debouncedSearchQuery.trim() && (
                    <div className="text-muted-foreground text-xs">
                      Connect an existing supplier or create a new one below.
                    </div>
                  )}
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSupplier(supplier.id);
                          }}
                          disabled={hasPart && (!canDeleteCoreRecords || localSupplierParts.length <= 1)}
                          className={`flex h-4 w-4 items-center justify-center rounded border border-gray-300 transition-colors ${
                            hasPart && (!canDeleteCoreRecords || localSupplierParts.length <= 1)
                              ? "cursor-not-allowed opacity-50"
                              : "hover:border-gray-400"
                          }`}
                          aria-label={hasPart ? "Remove supplier" : "Add supplier"}
                        >
                          {hasPart && <CheckIcon className="h-3 w-3 text-gray-900" />}
                        </button>

                        <span className="flex-1 text-sm">{supplier.name}</span>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasPart) handleTogglePreferred(supplier.id);
                          }}
                          className={`flex h-4 w-4 items-center justify-center transition-colors ${
                            hasPart ? "cursor-pointer hover:opacity-70" : "cursor-not-allowed opacity-30"
                          }`}
                          disabled={!hasPart}
                          aria-label={isPreferred ? "Preferred supplier" : "Set as preferred"}
                        >
                          <StarIcon
                            className={`h-4 w-4 ${
                              isPreferred ? "fill-yellow-400 text-yellow-400" : "text-gray-400"
                            }`}
                          />
                        </button>
                      </div>
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>

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

      <SupplierFormDialog
        open={isSupplierDialogOpen}
        onOpenChange={setIsSupplierDialogOpen}
        onSupplierCreated={handleSupplierCreated}
      />
    </>
  );
}
