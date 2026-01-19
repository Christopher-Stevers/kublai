"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  MoreVerticalIcon,
  PlusIcon,
  TrashIcon,
  StarIcon,
  SearchIcon,
} from "lucide-react";

interface SupplierPartsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
}

export function SupplierPartsDialog({
  open,
  onOpenChange,
  supplierId,
}: SupplierPartsDialogProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPartId, setSelectedPartId] = useState<string>("");

  const { data: supplierData, isLoading } = api.supplier.getById.useQuery(
    { id: supplierId },
    { enabled: open && !!supplierId },
  );

  const { data: searchResults } = api.catalogue.searchParts.useQuery(
    { query: searchQuery },
    { enabled: isAddDialogOpen && searchQuery.length > 0 },
  );

  const utils = api.useUtils();
  const removeSupplierPart = api.supplier.removeSupplierPart.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.getById.cancel({ id: supplierId });

      // Snapshot previous value
      const previousSupplier = utils.supplier.getById.getData({ id: supplierId });

      // Optimistically remove supplier part
      utils.supplier.getById.setData({ id: supplierId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          supplierParts: old.supplierParts.filter(
            (sp) => sp.id !== variables.id,
          ),
        };
      });

      return { previousSupplier };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplier) {
        utils.supplier.getById.setData({ id: supplierId }, context.previousSupplier);
      }
    },
    onSettled: () => {
      void utils.supplier.getById.invalidate({ id: supplierId });
    },
  });

  const updateSupplierPart = api.supplier.updateSupplierPart.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.getById.cancel({ id: supplierId });

      // Snapshot previous value
      const previousSupplier = utils.supplier.getById.getData({ id: supplierId });

      // Optimistically update supplier part
      utils.supplier.getById.setData({ id: supplierId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          supplierParts: old.supplierParts.map((sp) =>
            sp.id === variables.id
              ? {
                  ...sp,
                  isPreferred:
                    variables.isPreferred !== undefined
                      ? variables.isPreferred
                      : sp.isPreferred,
                  supplierSku:
                    variables.supplierSku !== undefined
                      ? variables.supplierSku
                      : sp.supplierSku,
                  lastKnownUnitCost:
                    variables.lastKnownUnitCost !== undefined
                      ? variables.lastKnownUnitCost
                      : sp.lastKnownUnitCost,
                }
              : sp,
          ),
        };
      });

      return { previousSupplier };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplier) {
        utils.supplier.getById.setData({ id: supplierId }, context.previousSupplier);
      }
    },
    onSettled: () => {
      void utils.supplier.getById.invalidate({ id: supplierId });
    },
  });

  const addSupplierPart = api.supplier.addSupplierPart.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.getById.cancel({ id: supplierId });

      // Snapshot previous value
      const previousSupplier = utils.supplier.getById.getData({ id: supplierId });

      // Find part definition from search results
      const partDef = searchResults?.find((p) => p.id === variables.partDefinitionId);

      // Create temporary supplier part with all required fields
      const tempId = `temp-${Date.now()}`;
      const tempSupplierPart = {
        id: tempId,
        supplierId: variables.supplierId,
        partDefinitionId: variables.partDefinitionId,
        supplierSku: variables.supplierSku ?? null,
        supplierName: null,
        packSize: null,
        packUomId: null,
        lastKnownUnitCost: null,
        currency: "CAD",
        notes: null,
        isPreferred: false,
        createdAt: new Date(),
        partDefinition: partDef
          ? {
              id: partDef.id,
              displayName: partDef.displayName,
              description: partDef.description,
            }
          : null,
        packUom: null,
      };

      // Optimistically add supplier part
      utils.supplier.getById.setData({ id: supplierId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          supplierParts: [...old.supplierParts, tempSupplierPart],
        };
      });

      return { previousSupplier };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSupplier) {
        utils.supplier.getById.setData({ id: supplierId }, context.previousSupplier);
      }
    },
    onSettled: () => {
      void utils.supplier.getById.invalidate({ id: supplierId });
    },
    onSuccess: () => {
      setIsAddDialogOpen(false);
      setSearchQuery("");
      setSelectedPartId("");
    },
  });

  const handleAddPart = () => {
    if (!selectedPartId) return;

    addSupplierPart.mutate({
      supplierId,
      partDefinitionId: selectedPartId,
      supplierSku: "",
      currency: "CAD",
    });
  };

  const handleTogglePreferred = (
    supplierPartId: string,
    currentValue: boolean,
  ) => {
    updateSupplierPart.mutate({
      id: supplierPartId,
      isPreferred: !currentValue,
    });
  };

  const handleDelete = (id: string) => {
    if (
      confirm("Are you sure you want to remove this part from the supplier?")
    ) {
      removeSupplierPart.mutate({ id });
    }
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <p>Loading supplier parts...</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>
              Parts for {supplierData?.name || "Supplier"}
            </DialogTitle>
            <DialogDescription>
              Manage parts available from this supplier
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add Part
                </Button>
              </div>

              {!supplierData?.supplierParts ||
              supplierData.supplierParts.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-muted-foreground">
                    No parts added yet. Click "Add Part" to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {supplierData.supplierParts.map((sp) => (
                    <div
                      key={sp.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">
                            {sp.partDefinition?.displayName || "Unknown Part"}
                          </h4>
                          {sp.isPreferred && (
                            <Badge variant="default" className="gap-1">
                              <StarIcon className="h-3 w-3" />
                              Preferred
                            </Badge>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-1 space-y-1 text-sm">
                          {sp.supplierSku && <div>SKU: {sp.supplierSku}</div>}
                          {sp.supplierName && (
                            <div>Supplier Name: {sp.supplierName}</div>
                          )}
                          {sp.lastKnownUnitCost && (
                            <div>
                              Cost: {sp.currency} {sp.lastKnownUnitCost}
                            </div>
                          )}
                          {sp.packSize && sp.packUom && (
                            <div>
                              Pack: {sp.packSize} {sp.packUom.displayName}
                            </div>
                          )}
                          {sp.notes && <div>Notes: {sp.notes}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleTogglePreferred(sp.id, sp.isPreferred)
                          }
                        >
                          <StarIcon
                            className={`h-4 w-4 ${
                              sp.isPreferred ? "fill-yellow-400" : ""
                            }`}
                          />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDelete(sp.id)}
                            >
                              <TrashIcon className="mr-2 h-4 w-4" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Part Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Part to Supplier</DialogTitle>
            <DialogDescription>
              Search for a part to add to this supplier
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="search" className="text-sm font-medium">
                Search Parts
              </label>
              <div className="relative">
                <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  id="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name..."
                  className="pl-9"
                />
              </div>
            </div>

            {searchQuery && searchResults && (
              <div className="max-h-60 overflow-y-auto rounded-md border">
                {searchResults.length === 0 ? (
                  <div className="text-muted-foreground p-4 text-center text-sm">
                    No parts found
                  </div>
                ) : (
                  <div className="divide-y">
                    {searchResults.map((part) => (
                      <button
                        key={part.id}
                        type="button"
                        onClick={() => setSelectedPartId(part.id)}
                        className={`w-full p-3 text-left hover:bg-gray-50 ${
                          selectedPartId === part.id ? "bg-blue-50" : ""
                        }`}
                      >
                        <div className="font-medium">{part.displayName}</div>
                        {part.material && (
                          <div className="text-muted-foreground text-sm">
                            {part.material}
                          </div>
                        )}
                        {part.size && (
                          <div className="text-muted-foreground text-sm">
                            Size: {part.size}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedPartId && (
              <div className="rounded-md bg-blue-50 p-3 text-sm">
                Part selected:{" "}
                {searchResults?.find((p) => p.id === selectedPartId)
                  ?.displayName || "Unknown"}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                setSearchQuery("");
                setSelectedPartId("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddPart}
              disabled={!selectedPartId || addSupplierPart.isPending}
            >
              {addSupplierPart.isPending ? "Adding..." : "Add Part"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
