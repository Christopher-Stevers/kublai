import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import Image from "next/image";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";

interface PartCardProps {
  part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    partType: string | null;
  };
  isPending: boolean;
  pendingQuantity: number;
  onPartSelect: (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
      partType: string | null;
    },
    supplierPartId: string,
    quantity?: number,
  ) => void;
  onEditPart: (partId: string) => void;
}

function PartCard({ part, isPending, pendingQuantity, onPartSelect, onEditPart }: PartCardProps) {
  const [selectedSupplierPartId, setSelectedSupplierPartId] = useState<string | null>(null);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [previousSupplierCount, setPreviousSupplierCount] = useState<number>(0);

  // Drum roll state
  const [isQtyPickerOpen, setIsQtyPickerOpen] = useState(false);
  const [draftQty, setDraftQty] = useState(1);

  // Refs for pointer/gesture handling
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const dragStartY = useRef<number>(0);
  const dragStartQty = useRef<number>(1);
  const activePointerId = useRef<number | null>(null);
  const cardElemRef = useRef<HTMLDivElement | null>(null);
  const isPickerOpenRef = useRef(false);
  const draftQtyRef = useRef(1);
  const selectedSupplierPartIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => { draftQtyRef.current = draftQty; }, [draftQty]);
  useEffect(() => { selectedSupplierPartIdRef.current = selectedSupplierPartId; }, [selectedSupplierPartId]);

  const { data: supplierParts } = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId: part.id },
    { enabled: !!part.id },
  );

  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: [part.id] },
    { enabled: !!part.id },
  );

  const utils = api.useUtils();

  useEffect(() => {
    if (supplierParts && supplierParts.length > 0) {
      const currentCount = supplierParts.length;
      const wasNewSupplierAdded = currentCount > previousSupplierCount && previousSupplierCount > 0;
      const preferred = supplierParts.find((sp) => sp.isPreferred);
      const supplierPartId = preferred?.id ?? supplierParts[0]?.id;

      if (!selectedSupplierPartId || !supplierParts.find(sp => sp.id === selectedSupplierPartId)) {
        if (supplierPartId) {
          setSelectedSupplierPartId(supplierPartId);
          if (isSupplierDialogOpen && (previousSupplierCount === 0 || wasNewSupplierAdded)) {
            setIsSupplierDialogOpen(false);
          }
        }
      } else if (preferred && preferred.id !== selectedSupplierPartId && wasNewSupplierAdded) {
        setSelectedSupplierPartId(preferred.id);
        if (isSupplierDialogOpen) setIsSupplierDialogOpen(false);
      }

      setPreviousSupplierCount(currentCount);
    } else {
      setPreviousSupplierCount(0);
    }
  }, [supplierParts, selectedSupplierPartId, isSupplierDialogOpen, previousSupplierCount]);

  const hasSupplier = !!selectedSupplierPartId;

  // Confirm quantity from drum roll and fire onPartSelect
  const confirmQty = useCallback(() => {
    const qty = draftQtyRef.current;
    const supplierId = selectedSupplierPartIdRef.current;
    if (supplierId) {
      onPartSelect(part, supplierId, qty);
    }
    isPickerOpenRef.current = false;
    setIsQtyPickerOpen(false);
    if (cardElemRef.current) cardElemRef.current.style.touchAction = "";
    activePointerId.current = null;
  }, [onPartSelect, part]);

  const handlePressStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasSupplier) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cardElemRef.current = e.currentTarget;
    activePointerId.current = e.pointerId;
    didLongPress.current = false;

    const capturedY = e.clientY;
    const startQty = isPending ? pendingQuantity : 1;
    dragStartQty.current = startQty;
    draftQtyRef.current = startQty;
    setDraftQty(startQty);

    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      dragStartY.current = capturedY;
      if (cardElemRef.current) {
        cardElemRef.current.style.touchAction = "none";
      }
      isPickerOpenRef.current = true;
      setIsQtyPickerOpen(true);
    }, 500);
  }, [hasSupplier, isPending, pendingQuantity]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activePointerId.current) return;
    if (!isPickerOpenRef.current) return;

    const delta = e.clientY - dragStartY.current;
    const newQty = Math.max(1, Math.round(dragStartQty.current + delta / 20));
    draftQtyRef.current = newQty;
    setDraftQty(newQty);
  }, []);

  const handlePressEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (e.pointerId !== activePointerId.current) return;

    if (isPickerOpenRef.current) {
      confirmQty();
    }
    // tap handled by onClick
    if (cardElemRef.current) cardElemRef.current.style.touchAction = "";
    activePointerId.current = null;
  }, [confirmQty]);

  const handlePointerCancel = useCallback((_e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (isPickerOpenRef.current) {
      confirmQty();
    }
    if (cardElemRef.current) cardElemRef.current.style.touchAction = "";
    isPickerOpenRef.current = false;
    setIsQtyPickerOpen(false);
    activePointerId.current = null;
  }, [confirmQty]);

  const handleClick = useCallback(() => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (!hasSupplier || !selectedSupplierPartIdRef.current) return;
    onPartSelect(part, selectedSupplierPartIdRef.current);
  }, [hasSupplier, onPartSelect, part]);

  return (
    <>
      <Card
        className={`relative transition-all hover:shadow-md ${
          isPending ? "border-primary border-2" : ""
        } ${hasSupplier ? "cursor-pointer select-none" : "select-none"}`}
        style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
        onPointerDown={handlePressStart}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePressEnd}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <CardContent className="p-3">
          <div className="flex flex-col gap-2">
            <div
              className="relative aspect-square w-full overflow-hidden rounded-md bg-gray-100"
              style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
            >
              {part.imageUrl ? (
                <Image
                  src={part.imageUrl}
                  alt={part.displayName}
                  fill
                  className="object-cover pointer-events-none"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">
                  <svg className="h-6 w-6 sm:h-8 sm:w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
              )}
              {isPending && (
                <div className="absolute bottom-1 right-1 bg-primary text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {pendingQuantity}
                </div>
              )}
            </div>
            <p className="text-xs font-medium sm:text-sm text-center mt-1">{part.displayName}</p>
          </div>
        </CardContent>

        <Dialog
          open={isSupplierDialogOpen}
          onOpenChange={(open) => {
            setIsSupplierDialogOpen(open);
            if (!open) {
              void utils.supplier.getSupplierPartsByPart.invalidate({ partDefinitionId: part.id });
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
              <label className="text-xs font-medium sm:text-sm">Suppliers</label>
              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <PartSuppliersDropdown
                  partDefinitionId={part.id}
                  currentPreferredSupplierId={supplierInfo?.[part.id]?.preferredSupplier?.id ?? null}
                  availableSuppliers={supplierInfo?.[part.id]?.availableSuppliers ?? []}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Select suppliers that provide this part and set a preferred supplier.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </Card>

      {/* Drum roll overlay — purely visual, pointer events pass through to card */}
      {isQtyPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ touchAction: "none", pointerEvents: "none", background: "rgba(0,0,0,0.55)" }}
        >
          {/* Numbers column */}
          <div className="flex flex-col items-center" style={{ gap: 0 }}>
            {Array.from({ length: 21 }, (_, i) => {
              const offset = i - 10; // -10 at top, 0 in middle, +10 at bottom
              const num = draftQty + offset;
              const isCenter = offset === 0;
              const dist = Math.abs(offset);
              const opacity = isCenter ? 1 : Math.max(0.08, 1 - dist * 0.09);
              const scale = isCenter ? 1 : Math.max(0.55, 1 - dist * 0.04);
              const fontSize = isCenter ? 72 : Math.max(18, 44 - dist * 2);
              const fontWeight = isCenter ? 800 : dist <= 2 ? 600 : 400;
              const color = isCenter ? "#ffffff" : `rgba(255,255,255,${opacity})`;
              const lineHeight = isCenter ? "88px" : `${Math.max(22, 40 - dist)}px`;
              if (num < 1 && !isCenter) return null;
              return (
                <div
                  key={offset}
                  className="select-none text-center"
                  style={{
                    fontSize,
                    fontWeight,
                    color,
                    lineHeight,
                    transform: `scale(${scale})`,
                    transition: "all 0.05s",
                    minHeight: lineHeight,
                  }}
                >
                  {num >= 1 ? num : ""}
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-xs text-white/50 select-none">Drag up · Release to confirm</p>
        </div>
      )}
    </>
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
    partType: string | null;
  }>;
  pendingParts: PendingPart[];
  onPartSelect: (part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    partType: string | null;
  }, supplierPartId: string, quantity?: number) => void;
  onEditPart: (partId: string) => void;
  onOpenCustomPartDialog: (context?: {
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    partTypeId?: string | null;
    category?: {
      name?: string | null;
      categoryId?: string | null;
    };
  }) => void;
  selectedMaterialId: string | null;
  selectedSize: { nominal: number; unit: string } | null;
  selectedPartTypeCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  onBackToCategories: () => void;
  onContinueToReview: () => void;
}

export function PartStage({
  partsForSelection,
  pendingParts,
  onPartSelect,
  onEditPart,
  onOpenCustomPartDialog,
  selectedMaterialId,
  selectedSize,
  selectedPartTypeCategory,
  onBackToCategories,
  onContinueToReview,
}: PartStageProps) {
  if (partsForSelection.length === 0) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base font-semibold sm:text-lg">No Parts Found</h3>
        <p className="text-xs text-gray-500 sm:text-sm">
          No parts found for the selected material, size, and category.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            onOpenCustomPartDialog({
              materialId: selectedMaterialId,
              size: selectedSize,
              partTypeId: null,
              category: selectedPartTypeCategory
                ? { categoryId: selectedPartTypeCategory.categoryId, name: selectedPartTypeCategory.name }
                : undefined,
            })
          }
          className="w-full text-xs sm:w-auto sm:text-sm"
        >
          Create Custom Part
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold sm:text-lg">Select Parts</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        {partsForSelection.map((part) => {
          const pendingEntry = pendingParts.find((p) => p.partId === part.id);
          return (
            <PartCard
              key={part.id}
              part={part}
              isPending={!!pendingEntry}
              pendingQuantity={pendingEntry?.quantity ?? 1}
              onPartSelect={onPartSelect}
              onEditPart={onEditPart}
            />
          );
        })}
      </div>
    </div>
  );
}
