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
import {
  AlertCircle,
  ChevronDownIcon,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { ViewToggle } from "~/components/ui/view-toggle";
import { Card, CardContent } from "~/components/ui/card";
import { useOnlineStatus } from "~/hooks/use-online-status";

const MATERIAL_LIST_TABLE_COLUMNS =
  "grid-cols-[2rem_8rem_24rem_12rem_8.5rem_2.25rem] sm:grid-cols-[2rem_8.5rem_30rem_14rem_9rem_2.25rem]";

type SupplierPartOption = {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  isPreferred: boolean;
  supplier: {
    id: string;
    name: string;
  };
};

type OptimisticSupplierSelection = {
  supplierPartId: string;
  label: string;
  lastKnownUnitCost: string | null;
};

export interface ReviewStageProps {
  pendingParts: PendingPart[];
  supplierPartsData: Map<string, SupplierPartOption[]>;
  onUpdateQuantity: (partId: string, delta: number) => void;
  onSetQuantity: (partId: string, quantity: number) => void;
  onUpdateSupplier: (partId: string, supplierPartId: string) => void;
  onSupplierPartResolutionStart: (
    partId: string,
    resolution: Promise<string>,
  ) => void;
  onRemovePendingPart: (partId: string) => void;
  allPartsHaveSuppliers: boolean;
}

function PartImage({ part }: { part: PendingPart["partDefinition"] }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-md bg-gray-100">
      {part.imageUrl ? (
        <Image
          src={part.imageUrl}
          alt={part.displayName}
          fill
          className="object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-400">
          <svg
            className="h-4 w-4 sm:h-8 sm:w-8"
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
  );
}

function ReviewQuantityControls({
  partId,
  quantity,
  onUpdateQuantity,
  onSetQuantity,
}: {
  partId: string;
  quantity: number;
  onUpdateQuantity: (partId: string, delta: number) => void;
  onSetQuantity: (partId: string, quantity: number) => void;
}) {
  return (
    <div className="flex items-center justify-center">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onUpdateQuantity(partId, -1)}
        className="h-8 w-8 p-0"
        aria-label="Decrease quantity"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        min="0"
        value={quantity}
        onChange={(e) => onSetQuantity(partId, parseInt(e.target.value) || 0)}
        className="h-8 w-16 rounded-none border-x-0 [appearance:textfield] text-center text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="Quantity"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => onUpdateQuantity(partId, 1)}
        className="h-8 w-8 p-0"
        aria-label="Increase quantity"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ReviewStage({
  pendingParts,
  supplierPartsData,
  onUpdateQuantity,
  onSetQuantity,
  onUpdateSupplier,
  onSupplierPartResolutionStart,
  onRemovePendingPart,
  allPartsHaveSuppliers,
}: ReviewStageProps) {
  const [supplierDialogPartId, setSupplierDialogPartId] = useState<string | null>(null);
  const [supplierCountBeforeDialog, setSupplierCountBeforeDialog] = useState<number>(0);
  const [reviewView, setReviewView] = useState<"grid" | "table">("table");
  const [optimisticSupplierSelections, setOptimisticSupplierSelections] = useState<
    Record<string, OptimisticSupplierSelection>
  >({});

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: allSuppliers } = api.supplier.list.useQuery(undefined, {
    enabled: isOnline,
  });

  const addSupplierPart = api.supplier.addSupplierPart.useMutation({
    onSuccess: (supplierPart) => {
      if (!supplierPart) return;
      const pendingPart = pendingParts.find(
        (part) => part.partId === supplierPart.partDefinitionId,
      );
      if (pendingPart) {
        const supplier = allSuppliers?.find(
          (candidate) => candidate.id === supplierPart.supplierId,
        );

        if (supplier) {
          setOptimisticSupplierSelections((prev) => ({
            ...prev,
            [pendingPart.partId]: {
              supplierPartId: supplierPart.id,
              label: `${supplier.name}${supplierPart.supplierSku ? ` (${supplierPart.supplierSku})` : ""}`,
              lastKnownUnitCost: supplierPart.lastKnownUnitCost,
            },
          }));
        }

        onUpdateSupplier(pendingPart.partId, supplierPart.id);
      }
      void utils.supplier.getSupplierPartsByPart.invalidate({
        partDefinitionId: supplierPart.partDefinitionId,
      });
      void utils.catalogue.getPartsSupplierInfo.invalidate();
    },
  });

  useEffect(() => {
    setOptimisticSupplierSelections((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const pendingPart of pendingParts) {
        const optimisticSelection = next[pendingPart.partId];
        if (!pendingPart.supplierPartId || !optimisticSelection) {
          continue;
        }

        const matchedSupplier = (supplierPartsData.get(pendingPart.partId) ?? []).find(
          (sp) => sp.id === pendingPart.supplierPartId,
        );

        if (matchedSupplier && matchedSupplier.id === optimisticSelection.supplierPartId) {
          delete next[pendingPart.partId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [pendingParts, supplierPartsData]);

  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: supplierDialogPartId ? [supplierDialogPartId] : [] },
    { enabled: isOnline && !!supplierDialogPartId },
  );

  const { data: dialogSupplierParts } = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId: supplierDialogPartId || "" },
    { enabled: isOnline && !!supplierDialogPartId },
  );

  useEffect(() => {
    if (!supplierDialogPartId || !dialogSupplierParts) return;

    const currentCount = dialogSupplierParts.length;
    const pendingPart = pendingParts.find((part) => part.partId === supplierDialogPartId);

    if (
      currentCount > supplierCountBeforeDialog &&
      pendingPart &&
      !pendingPart.supplierPartId &&
      dialogSupplierParts.length > 0
    ) {
      const preferred = dialogSupplierParts.find((sp) => sp.isPreferred);
      const supplierPartId = preferred?.id ?? dialogSupplierParts[0]?.id;
      if (supplierPartId) {
        onUpdateSupplier(pendingPart.partId, supplierPartId);
        setSupplierDialogPartId(null);
      }
    }
  }, [
    dialogSupplierParts,
    supplierDialogPartId,
    supplierCountBeforeDialog,
    pendingParts,
    onUpdateSupplier,
  ]);

  const getSupplierSelection = (pendingPart: PendingPart) => {
    const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
    const selectedSupplierPart = partsData.find(
      (sp) => sp.id === pendingPart.supplierPartId,
    );

    const optimisticSelection = optimisticSupplierSelections[pendingPart.partId];

    return {
      partsData,
      selectedSupplierPart,
      label:
        optimisticSelection?.label ??
        selectedSupplierPart?.supplier.name ??
        "Select supplier",
      lastKnownUnitCost:
        optimisticSelection?.lastKnownUnitCost ??
        selectedSupplierPart?.lastKnownUnitCost ??
        null,
      hasSupplier: !!(optimisticSelection ?? pendingPart.supplierPartId),
    };
  };

  const renderSupplierPicker = (pendingPart: PendingPart, isMissingSupplier: boolean) => {
    const { partsData, label } = getSupplierSelection(pendingPart);
    const hasAvailableSuppliers = partsData.length > 0;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={`h-8 w-full justify-between text-xs sm:text-sm ${
              isMissingSupplier ? "border-amber-300 text-amber-700" : ""
            }`}
            style={{ touchAction: "auto" }}
          >
            <span className="truncate">
              {label}
            </span>
            <ChevronDownIcon className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-(--radix-dropdown-menu-trigger-width) p-2"
          align="start"
        >
          {partsData.map((sp) => (
            <DropdownMenuItem
              key={sp.id}
              onClick={() => {
                setOptimisticSupplierSelections((prev) => ({
                  ...prev,
                  [pendingPart.partId]: {
                    supplierPartId: sp.id,
                    label: `${sp.supplier.name}${sp.supplierSku ? ` (${sp.supplierSku})` : ""}`,
                    lastKnownUnitCost: sp.lastKnownUnitCost,
                  },
                }));
                onUpdateSupplier(pendingPart.partId, sp.id);
              }}
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
                  setOptimisticSupplierSelections((prev) => ({
                    ...prev,
                    [pendingPart.partId]: {
                      supplierPartId: pendingPart.supplierPartId ?? "pending",
                      label: supplier.name,
                      lastKnownUnitCost: null,
                    },
                  }));
                  const resolution = addSupplierPart
                    .mutateAsync({
                      supplierId: supplier.id,
                      partDefinitionId: pendingPart.partId,
                    })
                    .then((supplierPart) => {
                      if (!supplierPart) {
                        throw new Error("Supplier part creation did not return a supplier part");
                      }
                      return supplierPart.id;
                    });

                  onSupplierPartResolutionStart(pendingPart.partId, resolution);
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
  };

  const renderRemoveButton = (partId: string, variant: "table" | "card") => (
    <Button
      type="button"
      variant={variant === "card" ? "ghost" : "outline"}
      size="sm"
      onClick={() => onRemovePendingPart(partId)}
      className={variant === "card" ? "h-10 w-10 p-0" : "h-8 w-8 p-0"}
      aria-label="Remove part"
      title="Remove part"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 sm:space-y-4">
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

      {reviewView === "grid" ? (
        <div className="space-y-2">
          {pendingParts.map((pendingPart) => {
            const supplierSelection = getSupplierSelection(pendingPart);
            const unitCost = supplierSelection.lastKnownUnitCost
              ? parseFloat(supplierSelection.lastKnownUnitCost)
              : 0;
            const lineTotal = pendingPart.quantity * unitCost;
            const isMissingSupplier = !supplierSelection.hasSupplier;

            return (
              <Card
                key={pendingPart.partId}
                className={isMissingSupplier ? "border-amber-300 bg-amber-50/50" : undefined}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_2.5rem] gap-1.5 sm:grid-cols-[4rem_minmax(0,1fr)_9.5rem_13rem_2.75rem] sm:items-center sm:gap-4">
                    <div className="col-span-3 min-w-0 sm:contents">
                      <div className="flex min-w-0 items-start gap-3 sm:contents">
                        <div className="h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                          <PartImage part={pendingPart.partDefinition} />
                        </div>

                        <div className="min-w-0 flex-1 sm:block">
                          <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 sm:truncate sm:text-base">
                            {pendingPart.partDefinition.displayName}
                          </h3>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                            <span>
                              Total:{" "}
                              <span className="font-semibold text-gray-900">
                                ${lineTotal.toFixed(2)}
                              </span>
                            </span>
                          </div>
                          {pendingPart.partDefinition.material && (
                            <p className="mt-0.5 hidden truncate text-xs text-gray-500 sm:block">
                              {pendingPart.partDefinition.material}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex h-10 min-w-0 items-center justify-center sm:h-11">
                      <ReviewQuantityControls
                        partId={pendingPart.partId}
                        quantity={pendingPart.quantity}
                        onUpdateQuantity={onUpdateQuantity}
                        onSetQuantity={onSetQuantity}
                      />
                    </div>

                    <div className="flex h-10 min-w-0 items-center sm:h-11">
                      {renderSupplierPicker(pendingPart, isMissingSupplier)}
                    </div>

                    <div className="flex h-10 items-center justify-center sm:h-11">
                      {renderRemoveButton(pendingPart.partId, "card")}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="w-max space-y-2">
            <div
              className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} items-center gap-2 px-2 text-xs font-medium uppercase tracking-wide text-gray-500 sm:gap-3`}
            >
              <span aria-hidden="true" />
              <span className="text-center">Qty</span>
              <span>Part</span>
              <span>Supplier</span>
              <span className="text-right">Total</span>
              <span aria-label="Actions" />
            </div>

            {pendingParts.map((pendingPart) => {
              const supplierSelection = getSupplierSelection(pendingPart);
              const unitCost = supplierSelection.lastKnownUnitCost
                ? parseFloat(supplierSelection.lastKnownUnitCost)
                : 0;
              const lineTotal = pendingPart.quantity * unitCost;
              const isMissingSupplier = !supplierSelection.hasSupplier;

              return (
                <div
                  key={pendingPart.partId}
                  className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} items-center gap-2 rounded-lg border p-1.5 sm:gap-3 ${
                    isMissingSupplier ? "border-amber-300 bg-amber-50/50" : ""
                  }`}
                >
                  <div className="h-8 w-8">
                    <PartImage part={pendingPart.partDefinition} />
                  </div>

                  <div className="flex h-8 min-w-0 items-center justify-center self-center">
                    <ReviewQuantityControls
                      partId={pendingPart.partId}
                      quantity={pendingPart.quantity}
                      onUpdateQuantity={onUpdateQuantity}
                      onSetQuantity={onSetQuantity}
                    />
                  </div>

                  <div className="min-w-0 py-0.5">
                    <div className="line-clamp-2 whitespace-normal break-words text-sm font-medium leading-tight sm:text-base">
                      {pendingPart.partDefinition.displayName}
                    </div>
                  </div>

                  <div className="flex h-8 min-w-0 items-center self-center">
                    {renderSupplierPicker(pendingPart, isMissingSupplier)}
                  </div>

                  <div className="flex h-8 min-w-0 items-center justify-end self-center overflow-hidden whitespace-nowrap text-sm font-semibold text-gray-900">
                    <span className="shrink-0">${lineTotal.toFixed(2)}</span>
                  </div>

                  <div className="flex h-8 items-center justify-center self-center">
                    {renderRemoveButton(pendingPart.partId, "table")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {supplierDialogPartId && (
        <Dialog
          open={!!supplierDialogPartId}
          onOpenChange={(open) => {
            if (!open) {
              const partId = supplierDialogPartId;
              setSupplierDialogPartId(null);
              void utils.supplier.getSupplierPartsByPart.invalidate({
                partDefinitionId: partId,
              });
              void utils.catalogue.getPartsSupplierInfo.invalidate();
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
                <label className="text-xs font-medium sm:text-sm">Suppliers</label>
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
