import { PartCard, type PartCardProps } from "./PartStage";
import { PART_TILE_GRID_CLASS } from "./PartTileContent";
import { supplierVersionLabel } from "~/lib/supplier-label";
import { buildSupplierChoices } from "~/lib/supplier-choices";
import { SupplierChoiceItems } from "~/components/suppliers/SupplierChoiceItems";
import type { SupplierVersion } from "~/lib/job-supplier-defaults";
import {
  SupplierLabelContext,
  useSupplierLabel,
} from "~/components/suppliers/SupplierLabel";
import { PackQuantityControls } from "../PackQuantityControls";
import { packContents } from "~/lib/pack-quantity";
import { purchaseLineTotal, purchaseQuantity } from "~/lib/purchase-quantity";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
import { useState, useEffect, useContext } from "react";
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
import type { PendingPart, PendingSupplierPartSnapshot } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { ViewToggle } from "~/components/ui/view-toggle";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";

const MATERIAL_LIST_TABLE_COLUMNS =
  "grid-cols-[3rem_9rem_minmax(16rem,1fr)_14rem_8rem_3rem]";

type SupplierPartOption = {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  packSize?: string | null;
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
  packSize?: string | null;
};

export interface ChosenPartsViewProps {
  onQuantityPickerPreviewChange?: PartCardProps["onQuantityPickerPreviewChange"];
  pendingParts: PendingPart[];
  supplierPartsData: Map<string, SupplierPartOption[]>;
  onUpdateQuantity: (partId: string, delta: number) => void;
  onSetQuantity: (partId: string, quantity: number) => void;
  onUpdateSupplier: (
    partId: string,
    supplierPartId: string,
    supplierPartSnapshot?: PendingSupplierPartSnapshot | null,
    version?: SupplierVersion | null,
  ) => void;
  onCacheSupplierPart: (
    partId: string,
    supplierPart: SupplierPartOption,
  ) => void;
  onSupplierPartResolutionStart: (
    partId: string,
    resolution: Promise<string>,
  ) => void;
  onRemovePendingPart: (partId: string) => void;
  allPartsHaveSuppliers: boolean;
  /** Tool requests go to the tool room: no supplier choice, no prices. */
  isToolRequest?: boolean;
}

function PartImage({ part }: { part: PendingPart["partDefinition"] }) {
  return (
    <div className="part-photo-frame bg-muted relative h-full w-full overflow-hidden rounded-md">
      {part.imageUrl ? (
        <Image
          src={part.imageUrl}
          alt={part.displayName}
          fill
          sizes="32px"
          className="part-photo object-cover"
        />
      ) : (
        <div className="text-muted-foreground/70 flex h-full items-center justify-center">
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

function ChosenQuantityControls({
  partId,
  quantity,
  orderMultiple,
  piecesPerPack,
  bulkUnit,
  individualUnit,
  onUpdateQuantity,
  onSetQuantity,
}: {
  partId: string;
  quantity: number;
  orderMultiple?: string | null;
  piecesPerPack?: number | null;
  bulkUnit?: string | null;
  individualUnit?: string | null;
  onUpdateQuantity: (partId: string, delta: number) => void;
  onSetQuantity: (partId: string, quantity: number) => void;
}) {
  if (packContents(piecesPerPack) > 1)
    return (
      <PackQuantityControls
        orderMultiple={orderMultiple}
        quantity={quantity}
        piecesPerPack={piecesPerPack!}
        bulkUnit={bulkUnit}
        individualUnit={individualUnit}
        onChange={(value) => onSetQuantity(partId, value)}
      />
    );
  return (
    <div
      data-tutorial="wizard-chosen-quantity"
      className="flex w-full min-w-0 items-center justify-center"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => onUpdateQuantity(partId, -1)}
        className="h-8 w-8 shrink-0 p-0"
        aria-label="Decrease quantity"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        min="0"
        value={quantity}
        onChange={(e) => onSetQuantity(partId, parseInt(e.target.value) || 0)}
        className="h-8 min-w-0 flex-1 [appearance:textfield] rounded-none border-x-0 text-center text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="Quantity"
      />
      {purchaseQuantity(quantity, orderMultiple) !== quantity && (
        <span className="text-muted-foreground px-1 text-xs tabular-nums">
          ({purchaseQuantity(quantity, orderMultiple)})
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onUpdateQuantity(partId, 1)}
        className="h-8 w-8 shrink-0 p-0"
        aria-label="Increase quantity"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ChosenPartsView({
  pendingParts,
  supplierPartsData,
  onUpdateQuantity,
  onSetQuantity,
  onQuantityPickerPreviewChange,
  onUpdateSupplier,
  onRemovePendingPart,
  allPartsHaveSuppliers,
  isToolRequest = false,
}: ChosenPartsViewProps) {
  const [supplierDialogPartId, setSupplierDialogPartId] = useState<
    string | null
  >(null);
  const [supplierCountBeforeDialog, setSupplierCountBeforeDialog] =
    useState<number>(0);
  const [chosenView, setChosenView] = useState<"grid" | "table">("grid");
  const [optimisticSupplierSelections, setOptimisticSupplierSelections] =
    useState<Record<string, OptimisticSupplierSelection>>({});

  const supplierLabel = useSupplierLabel();
  const { entries: jobEntries } = useContext(SupplierLabelContext);
  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const allSuppliers = useReplicacheSuppliers();

  useEffect(() => {
    setOptimisticSupplierSelections((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const pendingPart of pendingParts) {
        const optimisticSelection = next[pendingPart.partId];
        if (!pendingPart.supplierPartId || !optimisticSelection) {
          continue;
        }

        const matchedSupplier = (
          supplierPartsData.get(pendingPart.partId) ?? []
        ).find((sp) => sp.id === pendingPart.supplierPartId);

        if (
          matchedSupplier &&
          matchedSupplier.id === optimisticSelection.supplierPartId
        ) {
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

  const { data: dialogSupplierParts } =
    api.supplier.getSupplierPartsByPart.useQuery(
      { partDefinitionId: supplierDialogPartId || "" },
      { enabled: isOnline && !!supplierDialogPartId },
    );

  useEffect(() => {
    if (!supplierDialogPartId || !dialogSupplierParts) return;

    const currentCount = dialogSupplierParts.length;
    const pendingPart = pendingParts.find(
      (part) => part.partId === supplierDialogPartId,
    );

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
    const selectedSupplierPart =
      pendingPart.supplierPartSnapshot ??
      partsData.find((sp) => sp.id === pendingPart.supplierPartId);

    const optimisticSelection =
      optimisticSupplierSelections[pendingPart.partId];

    return {
      partsData,
      selectedSupplierPart,
      label:
        optimisticSelection?.label ??
        (pendingPart.supplierVersion ? supplierVersionLabel(pendingPart.supplierVersion) : null) ??
        (selectedSupplierPart
          ? supplierLabel(
              selectedSupplierPart.supplier.name,
              selectedSupplierPart.supplier.id,
              pendingPart.partId,
              selectedSupplierPart.id,
            )
          : undefined) ??
        "Select supplier",
      lastKnownUnitCost:
        optimisticSelection?.lastKnownUnitCost ??
        selectedSupplierPart?.lastKnownUnitCost ??
        null,
      hasSupplier: !!(optimisticSelection ?? pendingPart.supplierPartId),
    };
  };

  const renderSupplierPicker = (
    pendingPart: PendingPart,
    isMissingSupplier: boolean,
  ) => {
    const { partsData, label } = getSupplierSelection(pendingPart);
    const groups = buildSupplierChoices(
      pendingPart.partId,
      allSuppliers,
      partsData,
      jobEntries,
    );
    const hasAvailableSuppliers = groups.standard.length > 0;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={`h-auto min-h-8 w-full justify-between py-2 text-xs sm:text-sm ${
              isMissingSupplier ? "border-amber-300 text-amber-700" : ""
            }`}
            style={{ touchAction: "auto" }}
          >
            <span className="min-w-0 text-left whitespace-normal">{label}</span>
            <ChevronDownIcon className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="max-h-[min(24rem,60dvh)] w-[min(22rem,calc(100vw-2rem))] min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto p-2"
          align="start"
        >
          <SupplierChoiceItems
            groups={groups}
            onSelect={(choice) => {
              setOptimisticSupplierSelections((prev) => ({
                ...prev,
                [pendingPart.partId]: {
                  supplierPartId: choice.listing.id,
                  label: choice.label,
                  lastKnownUnitCost: choice.listing.lastKnownUnitCost,
                },
              }));
              onUpdateSupplier(
                pendingPart.partId,
                choice.listing.id,
                choice.listing,
                choice.version,
              );
            }}
          />
          {!hasAvailableSuppliers && !isOnline && allSuppliers.length === 0 && (
            <DropdownMenuItem disabled>
              No cached suppliers available
            </DropdownMenuItem>
          )}
          {!hasAvailableSuppliers &&
            isOnline &&
            (!allSuppliers || allSuppliers.length === 0) && (
              <DropdownMenuItem
                onClick={() => {
                  const currentPartsData =
                    supplierPartsData.get(pendingPart.partId) ?? [];
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
      className={variant === "card" ? "h-7 w-7 rounded-full border bg-background/90 p-0" : "h-8 w-8 p-0"}
      aria-label="Remove part"
      title="Remove part"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );

  return (
    <div id="chosen-parts-content" className="mx-auto w-full max-w-6xl space-y-3 sm:space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold sm:text-lg">
            Basket
          </h3>
          <ViewToggle
            view={chosenView}
            onViewChange={setChosenView}
            showOnMobile
          />
        </div>
        {!allPartsHaveSuppliers && !isToolRequest && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 sm:px-3 sm:text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span>
              {isOnline
                ? "Please select suppliers for all parts"
                : "Select a cached supplier for each part. If none are cached, reconnect once to refresh supplier options."}
            </span>
          </div>
        )}
      </div>

      {pendingParts.length === 0 && <p className="text-muted-foreground py-6 text-center">Your basket is empty.</p>}
      {chosenView === "grid" ? (
        <div className={PART_TILE_GRID_CLASS}>
          {pendingParts.map((pendingPart) => {
            const isToolLine = isToolRequest || pendingPart.isTool;
            const supplierSelection = getSupplierSelection(pendingPart);
            const unitCost = supplierSelection.lastKnownUnitCost
              ? parseFloat(supplierSelection.lastKnownUnitCost)
              : 0;
            const lineTotal = purchaseLineTotal(
              pendingPart.quantity,
              unitCost,
              supplierSelection.selectedSupplierPart?.packSize,
              pendingPart.partDefinition.piecesPerPack,
            );
            const isMissingSupplier =
              !isToolLine && !supplierSelection.hasSupplier;

            return (
              <PartCard
                key={pendingPart.partId}
                part={{ ...pendingPart.partDefinition, description: null }}
                isPending
                pendingQuantity={pendingPart.quantity}
                onPartSelect={() => onUpdateQuantity(pendingPart.partId, 1)}
                onPartQuantitySet={(_, quantity) => quantity <= 0
                  ? onRemovePendingPart(pendingPart.partId)
                  : onSetQuantity(pendingPart.partId, quantity)}
                onQuantityPickerPreviewChange={onQuantityPickerPreviewChange}
                onEditPart={() => undefined}
                photoAction={renderRemoveButton(pendingPart.partId, "card")}
                details={!isToolLine && <FinancialOnly><span className="text-muted-foreground text-xs">Total: ${lineTotal.toFixed(2)}</span></FinancialOnly>}
                footer={isToolLine ? <span className="text-muted-foreground text-sm">Tool room</span>
                  : renderSupplierPicker(pendingPart, isMissingSupplier)}
              />
            );
          })}
        </div>
      ) : (
        <div className="parts-sheet-scroll">
          <div className="parts-sheet min-w-[53rem]">
            <div
              className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} parts-sheet-header`}
            >
              <span className="text-center">Photo</span>
              <span className="text-center">Qty</span>
              <span>Part</span>
              <span>{isToolRequest ? "From" : "Supplier"}</span>
              <span className="text-right">{isToolRequest ? "" : "Total"}</span>
              <span aria-label="Actions" />
            </div>

            {pendingParts.map((pendingPart) => {
              const isToolLine = isToolRequest || pendingPart.isTool;
              const supplierSelection = getSupplierSelection(pendingPart);
              const unitCost = supplierSelection.lastKnownUnitCost
                ? parseFloat(supplierSelection.lastKnownUnitCost)
                : 0;
              const lineTotal = purchaseLineTotal(
                pendingPart.quantity,
                unitCost,
                supplierSelection.selectedSupplierPart?.packSize,
                pendingPart.partDefinition.piecesPerPack,
              );
              const isMissingSupplier =
                !isToolLine && !supplierSelection.hasSupplier;

              return (
                <div
                  key={pendingPart.partId}
                  className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} parts-sheet-row ${
                    isMissingSupplier ? "border-amber-300 bg-amber-50/50" : ""
                  }`}
                >
                  <div className="parts-sheet-photo">
                    <PartImage part={pendingPart.partDefinition} />
                  </div>

                  <div className="flex h-8 min-w-0 items-center justify-center self-center">
                    <ChosenQuantityControls
                      partId={pendingPart.partId}
                      quantity={pendingPart.quantity}
                      piecesPerPack={pendingPart.partDefinition.piecesPerPack}
                      bulkUnit={pendingPart.partDefinition.bulkUnit}
                      individualUnit={pendingPart.partDefinition.individualUnit}
                      orderMultiple={
                        isToolLine
                          ? null
                          : supplierSelection.selectedSupplierPart?.packSize
                      }
                      onUpdateQuantity={onUpdateQuantity}
                      onSetQuantity={onSetQuantity}
                    />
                  </div>

                  <div className="min-w-0 py-0.5">
                    <div className="line-clamp-2 text-sm leading-tight font-medium break-words whitespace-normal sm:text-base">
                      {pendingPart.partDefinition.displayName}
                    </div>
                  </div>

                  <div className="flex h-8 min-w-0 items-center self-center">
                    {isToolLine ? (
                      <span className="text-muted-foreground text-sm">
                        Tool room
                      </span>
                    ) : (
                      renderSupplierPicker(pendingPart, isMissingSupplier)
                    )}
                  </div>

                  <div className="text-foreground flex h-8 min-w-0 items-center justify-end self-center overflow-hidden text-sm font-semibold whitespace-nowrap">
                    {!isToolLine && (
                      <FinancialOnly>
                        <span className="shrink-0">
                          ${lineTotal.toFixed(2)}
                        </span>
                      </FinancialOnly>
                    )}
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
              <DialogTitle className="text-base sm:text-lg">
                Manage Suppliers
              </DialogTitle>
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
                      supplierInfo?.[supplierDialogPartId]?.preferredSupplier
                        ?.id || null
                    }
                    availableSuppliers={
                      supplierInfo?.[supplierDialogPartId]
                        ?.availableSuppliers ?? []
                    }
                  />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Select suppliers that provide this part and set a preferred
                  supplier.
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
