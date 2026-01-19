import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { X, Plus, Minus, AlertCircle } from "lucide-react";
import Image from "next/image";
import { formatSizeAsFraction } from "~/lib/size-utils";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";

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

  const utils = api.useUtils();

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold sm:text-lg">Review Parts</h3>
        {!allPartsHaveSuppliers && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 sm:px-3 sm:text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span>Please select suppliers for all parts</span>
          </div>
        )}
      </div>
      <div className="space-y-3 sm:space-y-4">
        {pendingParts.map((pendingPart) => {
          const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
          const hasSupplier = !!pendingPart.supplierPartId;
          const hasAvailableSuppliers = partsData.length > 0;
          const isMissingSupplier = !hasSupplier;
          return (
            <div
              key={pendingPart.partId}
              className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:gap-4 sm:p-4 ${
                isMissingSupplier ? "border-amber-300 bg-amber-50/50" : ""
              }`}
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gray-100 sm:h-16 sm:w-16">
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
                      className="h-4 w-4 sm:h-6 sm:w-6"
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
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium sm:text-base">
                      {pendingPart.partDefinition.displayName}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {pendingPart.partDefinition.material && (
                        <Badge variant="outline" className="text-xs">
                          {pendingPart.partDefinition.material}
                        </Badge>
                      )}
                      {pendingPart.partDefinition.size && (
                        <Badge variant="outline" className="text-xs">
                          {formatSizeAsFraction(pendingPart.partDefinition.size)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <button
                    title="Remove part"
                    onClick={() => onRemovePendingPart(pendingPart.partId)}
                    className="shrink-0 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 sm:text-sm">Quantity:</label>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateQuantity(pendingPart.partId, -1)}
                        className="h-7 w-7 p-0 sm:h-8 sm:w-8"
                      >
                        <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={pendingPart.quantity}
                        onChange={(e) =>
                          onSetQuantity(
                            pendingPart.partId,
                            parseInt(e.target.value) || 1,
                          )
                        }
                        className="h-7 w-14 [appearance:textfield] text-center text-xs sm:h-8 sm:w-16 sm:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateQuantity(pendingPart.partId, 1)}
                        className="h-7 w-7 p-0 sm:h-8 sm:w-8"
                      >
                        <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="text-xs text-gray-600 sm:text-sm">
                      Supplier:{" "}
                      {isMissingSupplier && (
                        <span className="text-amber-600">*Required</span>
                      )}
                    </label>
                    {hasAvailableSuppliers ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className={`mt-1 h-7 w-full justify-start text-xs sm:h-8 ${
                              isMissingSupplier
                                ? "border-amber-300 text-amber-700"
                                : ""
                            }`}
                          >
                            <span className="truncate">
                              {partsData.find(
                                (sp) => sp.id === pendingPart.supplierPartId,
                              )?.supplier.name ?? "Select supplier"}
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {partsData.map((sp) => (
                            <DropdownMenuItem
                              key={sp.id}
                              onClick={() =>
                                onUpdateSupplier(pendingPart.partId, sp.id)
                              }
                            >
                              {sp.supplier.name}
                              {sp.supplierSku ? ` (${sp.supplierSku})` : ""}
                              {sp.isPreferred && " ⭐"}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          // Store the current supplier count before opening dialog
                          const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
                          setSupplierCountBeforeDialog(partsData.length);
                          setSupplierDialogPartId(pendingPart.partId);
                        }}
                        className="mt-1 w-full cursor-pointer rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100 sm:px-3 sm:py-2"
                      >
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                          <span className="flex-1">
                            No suppliers available. Click to add suppliers.
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
