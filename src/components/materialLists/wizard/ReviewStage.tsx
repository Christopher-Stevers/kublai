import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
import { X, Plus, Minus, AlertCircle } from "lucide-react";
import Image from "next/image";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { ViewToggle } from "~/components/ui/view-toggle";

export interface ReviewStageProps {
  pendingParts: PendingPart[];
  supplierPartsData: Map<
    string,
    Array<{
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      isPreferred: boolean;
      supplier: {
        id: string;
        name: string;
      };
    }>
  >;
  onUpdateQuantity: (partId: string, delta: number) => void;
  onSetQuantity: (partId: string, quantity: number) => void;
  onUpdateSupplier: (partId: string, supplierPartId: string) => void;
  onRemovePendingPart: (partId: string) => void;
  allPartsHaveSuppliers: boolean;
}

export function ReviewStage({
  pendingParts,
  supplierPartsData,
  onUpdateQuantity,
  onSetQuantity,
  onUpdateSupplier,
  onRemovePendingPart,
  allPartsHaveSuppliers,
}: ReviewStageProps) {
  const [supplierDialogPartId, setSupplierDialogPartId] = useState<string | null>(null);
  const [supplierCountBeforeDialog, setSupplierCountBeforeDialog] = useState<number>(0);
  const [reviewView, setReviewView] = useState<"grid" | "table">("table");
  const [pendingSupplierLabels, setPendingSupplierLabels] = useState<Record<string, string>>({});

  const utils = api.useUtils();
  const { data: allSuppliers } = api.supplier.list.useQuery();

  const addSupplierPart = api.supplier.addSupplierPart.useMutation({
    onSuccess: (supplierPart) => {
      if (!supplierPart) return;
      const pendingPart = pendingParts.find(
        (part) => part.partId === supplierPart.partDefinitionId,
      );
      if (pendingPart) {
        onUpdateSupplier(pendingPart.partId, supplierPart.id);
      }
      void utils.supplier.getSupplierPartsByPart.invalidate({
        partDefinitionId: supplierPart.partDefinitionId,
      });
      void utils.catalogue.getPartsSupplierInfo.invalidate();
    },
  });

  useEffect(() => {
    setPendingSupplierLabels((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const pendingPart of pendingParts) {
        if (!pendingPart.supplierPartId || !next[pendingPart.partId]) {
          continue;
        }

        const matchedSupplier = (supplierPartsData.get(pendingPart.partId) ?? []).find(
          (sp) => sp.id === pendingPart.supplierPartId,
        );

        if (matchedSupplier) {
          delete next[pendingPart.partId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [pendingParts, supplierPartsData]);

  // Get supplier info for the part in the dialog
  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: supplierDialogPartId ? [supplierDialogPartId] : [] },
    { enabled: !!supplierDialogPartId },
  );

  // Get supplier parts for the part in the dialog to detect when new suppliers are added
  const { data: dialogSupplierParts } = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId: supplierDialogPartId || "" },
    { enabled: !!supplierDialogPartId },
  );

  // Watch for new suppliers being added in the dialog and auto-assign them
  useEffect(() => {
    if (!supplierDialogPartId || !dialogSupplierParts) return;

    const currentCount = dialogSupplierParts.length;
    const pendingPart = pendingParts.find(p => p.partId === supplierDialogPartId);
    
    // If a new supplier was added (count increased) and no supplier is currently selected
    if (currentCount > supplierCountBeforeDialog && pendingPart && !pendingPart.supplierPartId && dialogSupplierParts.length > 0) {
      // Auto-select the preferred supplier or the first one
      const preferred = dialogSupplierParts.find((sp) => sp.isPreferred);
      const supplierPartId = preferred?.id ?? dialogSupplierParts[0]?.id;
      if (supplierPartId) {
        onUpdateSupplier(pendingPart.partId, supplierPartId);
        // Close the dialog after auto-assigning
        setSupplierDialogPartId(null);
      }
    }
  }, [dialogSupplierParts, supplierDialogPartId, supplierCountBeforeDialog, pendingParts, onUpdateSupplier]);

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold sm:text-lg">Review Parts</h3>
          <ViewToggle view={reviewView} onViewChange={setReviewView} showOnMobile />
        </div>
        {!allPartsHaveSuppliers && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 sm:px-3 sm:text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span>Please select suppliers for all parts</span>
          </div>
        )}
      </div>
      <div className={reviewView === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-2"}>
        {pendingParts.map((pendingPart) => {
          const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
          const hasSupplier = !!pendingPart.supplierPartId;
          const hasAvailableSuppliers = partsData.length > 0;
          const isMissingSupplier = !hasSupplier;
          return (
            <div
              key={pendingPart.partId}
              className={reviewView === "grid"
                ? `flex flex-col gap-3 rounded-lg border p-3 ${isMissingSupplier ? "border-amber-300 bg-amber-50/50" : ""}`
                : `flex flex-wrap items-center gap-2 rounded-lg border p-2 sm:flex-nowrap sm:gap-3 ${isMissingSupplier ? "border-amber-300 bg-amber-50/50" : ""}`}
            >
              <div className={reviewView === "grid" ? "relative aspect-square w-full overflow-hidden rounded-md bg-gray-100" : "relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100"}>
                {pendingPart.partDefinition.imageUrl ? (
                  <Image
                    src={pendingPart.partDefinition.imageUrl}
                    alt={pendingPart.partDefinition.displayName}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium sm:text-base">
                  {pendingPart.partDefinition.displayName}
                </div>
              </div>
              <div className={reviewView === "grid" ? "flex items-center justify-center gap-1" : "flex shrink-0 items-center gap-1"}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onUpdateQuantity(pendingPart.partId, -1)}
                  className="h-8 w-8 p-0"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min="0"
                  value={pendingPart.quantity}
                  onChange={(e) =>
                    onSetQuantity(
                      pendingPart.partId,
                      parseInt(e.target.value) || 0,
                    )
                  }
                  className="h-8 w-16 [appearance:textfield] text-center text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onUpdateQuantity(pendingPart.partId, 1)}
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className={reviewView === "grid" ? "min-w-0" : "min-w-[11rem] shrink-0 sm:min-w-[13rem]"}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={addSupplierPart.isPending}
                      className={`h-8 w-full justify-start text-xs sm:text-sm ${
                        isMissingSupplier ? "border-amber-300 text-amber-700" : ""
                      }`}
                    >
                      <span className="truncate">
                        {partsData.find((sp) => sp.id === pendingPart.supplierPartId)?.supplier.name ?? pendingSupplierLabels[pendingPart.partId] ?? "Select supplier"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {partsData.map((sp) => (
                      <DropdownMenuItem
                        key={sp.id}
                        onClick={() => onUpdateSupplier(pendingPart.partId, sp.id)}
                      >
                        {sp.supplier.name}
                        {sp.supplierSku ? ` (${sp.supplierSku})` : ""}
                        {sp.isPreferred && " ⭐"}
                      </DropdownMenuItem>
                    ))}
                    {allSuppliers
                      ?.filter(
                        (supplier) => !partsData.some((sp) => sp.supplierId === supplier.id),
                      )
                      .map((supplier) => (
                        <DropdownMenuItem
                          key={supplier.id}
                          onClick={() => {
                            setPendingSupplierLabels((prev) => ({
                              ...prev,
                              [pendingPart.partId]: supplier.name,
                            }));
                            addSupplierPart.mutate({
                              supplierId: supplier.id,
                              partDefinitionId: pendingPart.partId,
                            });
                          }}
                        >
                          {supplier.name}
                        </DropdownMenuItem>
                      ))}
                    {!hasAvailableSuppliers && (!allSuppliers || allSuppliers.length === 0) && (
                      <DropdownMenuItem
                        onClick={() => {
                          const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
                          setSupplierCountBeforeDialog(partsData.length);
                          setSupplierDialogPartId(pendingPart.partId);
                        }}
                      >
                        Add supplier
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <button
                title="Remove part"
                onClick={() => onRemovePendingPart(pendingPart.partId)}
                className={reviewView === "grid" ? "self-end text-gray-400 hover:text-gray-600" : "shrink-0 text-gray-400 hover:text-gray-600"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      {/* Supplier Management Dialog */}
      {supplierDialogPartId && (
        <Dialog 
          open={!!supplierDialogPartId} 
          onOpenChange={(open) => {
            if (!open) {
              const partId = supplierDialogPartId;
              setSupplierDialogPartId(null);
              // Refetch supplier parts when dialog closes
              void utils.supplier.getSupplierPartsByPart.invalidate({
                partDefinitionId: partId,
              });
              void utils.catalogue.getPartsSupplierInfo.invalidate();
              // The useEffect will handle auto-assigning the supplier when data refreshes
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
                    partDefinitionId={supplierDialogPartId}
                    currentPreferredSupplierId={
                      supplierInfo?.[supplierDialogPartId]?.preferredSupplier?.id || null
                    }
                    availableSuppliers={
                      supplierInfo?.[supplierDialogPartId]?.availableSuppliers ?? []
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
      )}
    </div>
  );
}
