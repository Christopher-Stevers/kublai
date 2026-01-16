"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Label } from "~/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";

interface CreateCustomPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPartCreated: (part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    partType: string | null;
  }) => void;
  initialContext?: {
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    partTypeId?: string | null;
    categoryName?: string | null;
  };
}

export function CreateCustomPartDialog({
  open,
  onOpenChange,
  onPartCreated,
  initialContext,
}: CreateCustomPartDialogProps) {
  const utils = api.useUtils();
  console.log(initialContext, "my current context");

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [sizeUnitId, setSizeUnitId] = useState<string | null>(null);

  // Supplier section
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSku, setSupplierSku] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [lastKnownUnitCost, setLastKnownUnitCost] = useState("");
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);

  // Fetch data
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();
  const { data: suppliers } = api.supplier.list.useQuery();

  // Find size unit ID from initial context
  useEffect(() => {
    if (initialContext?.size?.unit && allUnits) {
      const unit = allUnits.find((u) => u.code === initialContext.size?.unit);
      if (unit) {
        setSizeUnitId(unit.id);
      }
    }
  }, [initialContext?.size?.unit, allUnits]);

  // Flatten category tree for dropdown
  const flattenCategories = (
    tree: Array<{ id: string; name: string; children: Array<unknown> }>,
    level = 0,
  ): Array<{ id: string; name: string; level: number }> => {
    const result: Array<{ id: string; name: string; level: number }> = [];
    for (const cat of tree) {
      result.push({ id: cat.id, name: cat.name, level });
      if (cat.children.length > 0) {
        result.push(
          ...flattenCategories(cat.children as typeof tree, level + 1),
        );
      }
    }
    return result;
  };

  const createPart = api.catalogue.createPart.useMutation({
    onSuccess: (newPart) => {
      // Format part for pending list
      const formattedPart = {
        id: newPart.id,
        displayName: newPart.displayName,
        imageUrl: newPart.imageUrl,
        material: newPart.material,
        size: newPart.sizeUnit
          ? `${newPart.sizeNominal ?? ""} ${newPart.sizeUnit.code}`.trim()
          : null,
        partType: newPart.partType,
      };

      onPartCreated(formattedPart);
      onOpenChange(false);

      // Reset form
      setDisplayName("");
      setSupplierId(null);
      setSupplierSku("");
      setSupplierName("");
      setLastKnownUnitCost("");

      // Invalidate queries
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getCategoryTree.invalidate();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim()) {
      return;
    }

    createPart.mutate({
      displayName: displayName.trim(),
      imageUrl: undefined,
      categoryName: initialContext?.categoryName ?? undefined,
      partTypeId: initialContext?.partTypeId ?? undefined,
      materialId: initialContext?.materialId ?? undefined,
      sizeNominal: initialContext?.size?.nominal ?? undefined,
      sizeUnitId: initialContext?.size ? sizeUnitId : undefined,
      supplierId: supplierId ? supplierId : undefined,
      supplierSku: supplierSku.trim() ? supplierSku.trim() : undefined,
      supplierName: supplierName.trim() ? supplierName.trim() : undefined,
      lastKnownUnitCost: lastKnownUnitCost.trim()
        ? lastKnownUnitCost.trim()
        : undefined,
      currency: "CAD",
    });
  };

  const handleSupplierCreated = (newSupplierId: string) => {
    setSupplierId(newSupplierId);
    setIsSupplierDialogOpen(false);
  };

  const isLoading = createPart.isPending;
  console.log("My initinal context", initialContext);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Custom Part</DialogTitle>
            <DialogDescription>
              Add a new part definition to your organization's catalogue{" "}
              {JSON.stringify(initialContext)}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="displayName">
                  Display Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., Custom Fitting"
                  required
                  disabled={isLoading}
                  className="mt-1"
                />
              </div>

              {/* Supplier Section */}

              <div>
                <Label htmlFor="supplier">Supplier</Label>
                <div className="mt-1 flex gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="flex-1 justify-between"
                        disabled={isLoading}
                      >
                        {supplierId
                          ? (suppliers?.find((s) => s.id === supplierId)
                              ?.name ?? "Select supplier")
                          : "Select supplier"}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {suppliers?.map((supplier) => (
                        <DropdownMenuItem
                          key={supplier.id}
                          onClick={() => setSupplierId(supplier.id)}
                        >
                          {supplier.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSupplierDialogOpen(true)}
                    disabled={isLoading}
                  >
                    New
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="lastKnownUnitCost">Unit Cost</Label>
                <Input
                  id="lastKnownUnitCost"
                  type="number"
                  step="0.01"
                  value={lastKnownUnitCost}
                  onChange={(e) => setLastKnownUnitCost(e.target.value)}
                  placeholder="0.00"
                  disabled={isLoading}
                  className="mt-1"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !displayName.trim()}>
                {isLoading ? "Creating..." : "Create Part"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SupplierFormDialog
        open={isSupplierDialogOpen}
        onOpenChange={setIsSupplierDialogOpen}
        onSupplierCreated={handleSupplierCreated}
      />
    </>
  );
}
