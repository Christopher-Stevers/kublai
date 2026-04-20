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
import { Plus, Minus, AlertCircle, Trash2 } from "lucide-react";
import Image from "next/image";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { ViewToggle } from "~/components/ui/view-toggle";
import { Card, CardContent } from "~/components/ui/card";

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
  const [confirmingRemovePartId, setConfirmingRemovePartId] = useState<string | null>(null);

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

    setConfirmingRemovePartId((current) =>
      current && pendingParts.some((part) => part.partId === current) ? current : null,
    );
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
      <div className={reviewView === "grid" ? "space-y-2" : "space-y-2 overflow-x-auto"}>
        {pendingParts.map((pendingPart) => {
          const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
          const hasSupplier = !!pendingPart.supplierPartId;
          const hasAvailableSuppliers = partsData.length > 0;
          const isMissingSupplier = !hasSupplier;
          const selectedSupplierPart = partsData.find(
            (sp) => sp.id === pendingPart.supplierPartId,
          );
          const unitCost = selectedSupplierPart?.lastKnownUnitCost
            ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
            : 0;
          const lineTotal = pendingPart.quantity * unitCost;

          const supplierPicker = (
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
                    {selectedSupplierPart?.supplier.name ??
                      pendingSupplierLabels[pendingPart.partId] ??
                      "Select supplier"}
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
                      const currentPartsData = supplierPartsData.get(pendingPart.partId) ?? [];
                      setSupplierCountBeforeDialog(currentPartsData.length);
                      setSupplierDialogPartId(pendingPart.partId);
                    }}
                  >
                    Add supplier
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );

          if (reviewView === "grid") {
            return (
              <Card
                key={pendingPart.partId}
                className={isMissingSupplier ? "border-amber-300 bg-amber-50/50" : undefined}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                    <div className="flex items-start gap-3 sm:flex-1">
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-gray-100 sm:h-16 sm:w-16">
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
                              className="h-6 w-6 sm:h-8 sm:w-8"
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 sm:text-base">
                              {pendingPart.partDefinition.displayName}
                            </h3>
                            {pendingPart.partDefinition.material && (
                              <p className="mt-0.5 text-xs text-gray-600 sm:text-sm">
                                {pendingPart.partDefinition.material}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 sm:hidden">
                            <div className="text-right">
                              <p className="text-xs text-gray-600">Total</p>
                              <p className="text-base font-semibold">
                                ${lineTotal.toFixed(2)}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant={confirmingRemovePartId === pendingPart.partId ? "destructive" : "ghost"}
                              size="sm"
                              className="h-10 w-10 p-0"
                              onClick={() => {
                                if (confirmingRemovePartId === pendingPart.partId) {
                                  onRemovePendingPart(pendingPart.partId);
                                  setConfirmingRemovePartId(null);
                                  return;
                                }

                                setConfirmingRemovePartId(pendingPart.partId);
                              }}
                              title={confirmingRemovePartId === pendingPart.partId ? "Confirm remove" : "Remove part"}
                            >
                              {confirmingRemovePartId === pendingPart.partId ? "OK" : <Trash2 className="h-5 w-5" />}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-center gap-1 sm:justify-start">
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

                        <div className="mt-2">{supplierPicker}</div>
                      </div>
                    </div>

                    <div className="hidden flex-col items-end gap-2 sm:flex">
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Line Total</p>
                        <p className="text-lg font-semibold">${lineTotal.toFixed(2)}</p>
                      </div>
                      <Button
                        type="button"
                        variant={confirmingRemovePartId === pendingPart.partId ? "destructive" : "ghost"}
                        size="sm"
                        className="h-10 w-10 p-0"
                        onClick={() => {
                          if (confirmingRemovePartId === pendingPart.partId) {
                            onRemovePendingPart(pendingPart.partId);
                            setConfirmingRemovePartId(null);
                            return;
                          }

                          setConfirmingRemovePartId(pendingPart.partId);
                        }}
                        title={confirmingRemovePartId === pendingPart.partId ? "Confirm remove" : "Remove part"}
                      >
                        {confirmingRemovePartId === pendingPart.partId ? "OK" : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          }

          return (
            <div
              key={pendingPart.partId}
              className={`flex min-w-max flex-nowrap items-center gap-2 rounded-lg border p-2 sm:gap-3 ${isMissingSupplier ? "border-amber-300 bg-amber-50/50" : ""}`}
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
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
              <div className="min-w-max flex-1">
                <div className="whitespace-nowrap text-sm font-medium sm:text-base">
                  {pendingPart.partDefinition.displayName}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
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
              <div className="min-w-[11rem] shrink-0 sm:min-w-[13rem]">{supplierPicker}</div>
              <Button
                type="button"
                variant={confirmingRemovePartId === pendingPart.partId ? "destructive" : "outline"}
                size="sm"
                onClick={() => {
                  if (confirmingRemovePartId === pendingPart.partId) {
                    onRemovePendingPart(pendingPart.partId);
                    setConfirmingRemovePartId(null);
                    return;
                  }

                  setConfirmingRemovePartId(pendingPart.partId);
                }}
                className="shrink-0"
                title={confirmingRemovePartId === pendingPart.partId ? "Confirm remove" : "Remove part"}
              >
                {confirmingRemovePartId === pendingPart.partId ? "Confirm" : <Trash2 className="h-4 w-4" />}
              </Button>
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
