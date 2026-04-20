import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
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
import { Pencil, AlertCircle } from "lucide-react";
import Image from "next/image";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";
import { ViewToggle } from "~/components/ui/view-toggle";

const TILE_FALLBACK_IMAGE_URL = "/images/plumbing-part-placeholder-v2.jpg";

function usePartSupplierSelection(partId: string) {
  const [selectedSupplierPartId, setSelectedSupplierPartId] = useState<string | null>(null);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [previousSupplierCount, setPreviousSupplierCount] = useState<number>(0);

  const { data: supplierParts, isLoading: isLoadingSuppliers } =
    api.supplier.getSupplierPartsByPart.useQuery(
      { partDefinitionId: partId },
      { enabled: !!partId },
    );

  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: [partId] },
    { enabled: !!partId },
  );

  const utils = api.useUtils();

  useEffect(() => {
    if (supplierParts && supplierParts.length > 0) {
      const currentCount = supplierParts.length;
      const wasNewSupplierAdded =
        currentCount > previousSupplierCount && previousSupplierCount > 0;

      const preferred = supplierParts.find((sp) => sp.isPreferred);
      const supplierPartId = preferred?.id ?? supplierParts[0]?.id;

      if (
        !selectedSupplierPartId ||
        !supplierParts.find((sp) => sp.id === selectedSupplierPartId)
      ) {
        if (supplierPartId) {
          setSelectedSupplierPartId(supplierPartId);
          if (
            isSupplierDialogOpen &&
            (previousSupplierCount === 0 || wasNewSupplierAdded)
          ) {
            setIsSupplierDialogOpen(false);
          }
        }
      } else if (
        preferred &&
        preferred.id !== selectedSupplierPartId &&
        wasNewSupplierAdded
      ) {
        setSelectedSupplierPartId(preferred.id);
        if (isSupplierDialogOpen) {
          setIsSupplierDialogOpen(false);
        }
      }

      setPreviousSupplierCount(currentCount);
    } else {
      setPreviousSupplierCount(0);
    }
  }, [supplierParts, selectedSupplierPartId, isSupplierDialogOpen, previousSupplierCount]);

  return {
    selectedSupplierPartId,
    setSelectedSupplierPartId,
    isSupplierDialogOpen,
    setIsSupplierDialogOpen,
    supplierParts,
    isLoadingSuppliers,
    supplierInfo,
    utils,
  };
}

interface PartCardProps {
  part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  };
  isPending: boolean;
  pendingQuantity?: number;
  onPartSelect: (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
    },
    supplierPartId?: string,
  ) => void;
  onPartQuantitySet?: (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
    },
    quantity: number,
  ) => void;
  onQuantityPickerPreviewChange?: (
    preview:
      | {
          partId: string;
          partName: string;
          quantity: number;
        }
      | null,
  ) => void;
  onEditPart: (partId: string) => void;
}

function PartCard({ part, isPending, pendingQuantity = 0, onPartSelect, onPartQuantitySet, onQuantityPickerPreviewChange, onEditPart: _onEditPart }: PartCardProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartYRef = useRef<number | null>(null);
  const baseQuantityRef = useRef(1);
  const dragQuantityRef = useRef(Math.max(pendingQuantity, 1));
  const activePointerIdRef = useRef<number | null>(null);
  const pointerElementRef = useRef<HTMLDivElement | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const clampQuantity = (quantity: number) => Math.max(0, quantity);

  const clearPickerPreview = () => {
    onQuantityPickerPreviewChange?.(null);
  };

  const updateDragQuantity = (clientY: number) => {
    if (!longPressTriggeredRef.current || pointerStartYRef.current === null) return;

    const deltaY = pointerStartYRef.current - clientY;
    const steps = Math.round(deltaY / 28);
    const nextQuantity = clampQuantity(baseQuantityRef.current + steps);
    dragQuantityRef.current = nextQuantity;
    onQuantityPickerPreviewChange?.({
      partId: part.id,
      partName: part.displayName,
      quantity: nextQuantity,
    });
  };

  const teardownWindowListeners = () => {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerCancel);
  };

  const finishLongPressSelection = () => {
    onPartQuantitySet?.(part, dragQuantityRef.current);
    clearPickerPreview();
    longPressTriggeredRef.current = false;
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    pointerElementRef.current = null;
    teardownWindowListeners();
  };

  const cancelLongPressSelection = () => {
    clearPickerPreview();
    longPressTriggeredRef.current = false;
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    pointerElementRef.current = null;
    teardownWindowListeners();
  };

  function handleWindowPointerMove(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateDragQuantity(event.clientY);
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    clearLongPressTimer();

    if (longPressTriggeredRef.current) {
      finishLongPressSelection();
    }
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;
    clearLongPressTimer();
    cancelLongPressSelection();
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    longPressTriggeredRef.current = false;
    activePointerIdRef.current = event.pointerId;
    pointerElementRef.current = event.currentTarget;
    pointerStartYRef.current = event.clientY;
    baseQuantityRef.current = Math.max(pendingQuantity, 1);
    dragQuantityRef.current = Math.max(pendingQuantity, 1);
    event.currentTarget.setPointerCapture(event.pointerId);

    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;

      if (
        pointerElementRef.current &&
        activePointerIdRef.current !== null &&
        pointerElementRef.current.hasPointerCapture(activePointerIdRef.current)
      ) {
        pointerElementRef.current.releasePointerCapture(activePointerIdRef.current);
      }

      onQuantityPickerPreviewChange?.({
        partId: part.id,
        partName: part.displayName,
        quantity: baseQuantityRef.current,
      });
      window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
      window.addEventListener("pointerup", handleWindowPointerUp, { passive: false });
      window.addEventListener("pointercancel", handleWindowPointerCancel);
    }, 150);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!longPressTriggeredRef.current) return;
    event.preventDefault();
    updateDragQuantity(event.clientY);
  };

  const finishPointerInteraction = () => {
    clearLongPressTimer();

    if (longPressTriggeredRef.current) {
      finishLongPressSelection();
      return;
    }

    onPartSelect(part);
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    pointerElementRef.current = null;
  };

  const cancelPointerInteraction = () => {
    clearLongPressTimer();
    cancelLongPressSelection();
  };

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      teardownWindowListeners();
    };
  }, []);

  return (
    <Card
      className={`relative aspect-square gap-0 overflow-hidden rounded-2xl py-0 transition-all hover:shadow-md ${
        isPending ? "border-primary border-2 shadow-md" : ""
      } cursor-pointer`}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={cancelPointerInteraction}
      onPointerLeave={() => {
        if (longPressTriggeredRef.current) return;
        clearLongPressTimer();
      }}
    >
      <CardContent className="h-full p-0">
        <div className="flex h-full w-full flex-col p-3 sm:p-4">
          <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-gray-100">
            <Image
              src={part.imageUrl ?? TILE_FALLBACK_IMAGE_URL}
              alt={part.displayName}
              fill
              className="object-cover"
              draggable={false}
            />

            <div className="absolute top-2 right-2 flex justify-end">
              {pendingQuantity > 0 && (
                <div className="flex h-6 min-w-6 items-center justify-center rounded-full bg-black px-1.5 text-xs font-semibold text-white shadow-sm sm:h-7 sm:min-w-7 sm:text-sm">
                  {pendingQuantity}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-start justify-center text-center text-black">
            <h4 className="line-clamp-3 text-sm font-medium leading-snug sm:text-base">
              {part.displayName}
            </h4>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PartListRow({ part, isPending, onPartSelect, onEditPart }: PartCardProps) {
  const {
    selectedSupplierPartId,
    setSelectedSupplierPartId,
    isSupplierDialogOpen,
    setIsSupplierDialogOpen,
    supplierParts,
    isLoadingSuppliers,
    supplierInfo,
    utils,
  } = usePartSupplierSelection(part.id);

  const hasSupplier = !!selectedSupplierPartId;
  const hasAvailableSuppliers = (supplierParts?.length ?? 0) > 0;

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2 transition-all ${
        isPending ? "border-primary border-2 shadow-sm" : "hover:shadow-sm"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gray-100">
          {part.imageUrl ? (
            <Image src={part.imageUrl} alt={part.displayName} fill className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              <AlertCircle className="h-4 w-4" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-medium">{part.displayName}</h4>
            <div className="hidden flex-wrap gap-2 text-xs text-gray-500 sm:flex">
              {part.material && <span>{part.material}</span>}
              {part.size && <span>{part.size}</span>}
            </div>
          </div>
          {part.description && (
            <p className="truncate text-xs text-gray-600">{part.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isLoadingSuppliers ? (
            <div className="text-xs text-gray-500">Loading...</div>
          ) : hasAvailableSuppliers ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-8 max-w-32 justify-start px-2 text-xs">
                  <span className="truncate">
                    {supplierParts?.find((sp) => sp.id === selectedSupplierPartId)?.supplier.name ?? "Select supplier"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {supplierParts?.map((sp) => (
                  <DropdownMenuItem key={sp.id} onClick={() => setSelectedSupplierPartId(sp.id)}>
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
              onClick={() => setIsSupplierDialogOpen(true)}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
            >
              Add supplier
            </button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onEditPart(part.id)}
            title="Edit part"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => {
              if (hasSupplier && selectedSupplierPartId) {
                onPartSelect(part, selectedSupplierPartId);
              }
            }}
            disabled={!hasSupplier}
          >
            Add
          </Button>
        </div>
      </div>

      <Dialog
        open={isSupplierDialogOpen}
        onOpenChange={(open) => {
          setIsSupplierDialogOpen(open);
          if (!open) {
            void utils.supplier.getSupplierPartsByPart.invalidate({
              partDefinitionId: part.id,
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
              <div className="mt-1">
                <PartSuppliersDropdown
                  partDefinitionId={part.id}
                  currentPreferredSupplierId={
                    supplierInfo?.[part.id]?.preferredSupplier?.id || null
                  }
                  availableSuppliers={supplierInfo?.[part.id]?.availableSuppliers ?? []}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface PartStageProps {
  partsForSelection: Array<{
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  }>;
  pendingParts: PendingPart[];
  onPartSelect: (part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  }, supplierPartId?: string) => void;
  onPartQuantitySet: (part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  }, quantity: number) => void;
  onQuantityPickerPreviewChange: (
    preview:
      | {
          partId: string;
          partName: string;
          quantity: number;
        }
      | null,
  ) => void;
  onEditPart: (partId: string) => void;
  selectedMaterialId: string | null;
  selectedSize: { nominal: number; unit: string } | null;
  selectedPartTypeCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  onContinueToReview: () => void;
}

export function PartStage({
  partsForSelection,
  pendingParts,
  onPartSelect,
  onPartQuantitySet,
  onQuantityPickerPreviewChange,
  onEditPart,
  selectedMaterialId,
  selectedSize,
  selectedPartTypeCategory,
  onContinueToReview,
}: PartStageProps) {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const pagination = useClientPagination(partsForSelection);

  if (partsForSelection.length === 0) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base font-semibold sm:text-lg">No Parts Found</h3>
        <p className="text-xs text-gray-500 sm:text-sm">
          No parts found for the selected material, size, and category.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold sm:text-lg">Select Parts</h3>
        <ViewToggle view={viewMode} onViewChange={setViewMode} showOnMobile />
      </div>
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pagination.paginatedItems.map((part) => {
            const isPending = pendingParts.some((p) => p.partId === part.id);
            const pendingQuantity = pendingParts.find((p) => p.partId === part.id)?.quantity ?? 0;
            return (
              <PartCard
                key={part.id}
                part={part}
                isPending={isPending}
                pendingQuantity={pendingQuantity}
                onPartSelect={onPartSelect}
                onPartQuantitySet={onPartQuantitySet}
                onQuantityPickerPreviewChange={onQuantityPickerPreviewChange}
                onEditPart={onEditPart}
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {pagination.paginatedItems.map((part) => {
            const isPending = pendingParts.some((p) => p.partId === part.id);
            return (
              <PartListRow
                key={part.id}
                part={part}
                isPending={isPending}
                onPartSelect={onPartSelect}
                onEditPart={onEditPart}
              />
            );
          })}
        </div>
      )}
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="parts"
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
