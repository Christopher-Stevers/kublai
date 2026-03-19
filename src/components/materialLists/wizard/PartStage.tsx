import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
  const [isQtyPickerOpen, setIsQtyPickerOpen] = useState(false);
  const [draftQty, setDraftQty] = useState(1);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const draftQtyRef = useRef(1);
  const selectedSupplierPartIdRef = useRef<string | null>(null);
  const isPendingRef = useRef(isPending);
  const pendingQuantityRef = useRef(pendingQuantity);
  const hasSupplierRef = useRef(false);
  const onPartSelectRef = useRef(onPartSelect);
  const partRef = useRef(part);

  useEffect(() => { draftQtyRef.current = draftQty; }, [draftQty]);
  useEffect(() => { selectedSupplierPartIdRef.current = selectedSupplierPartId; hasSupplierRef.current = !!selectedSupplierPartId; }, [selectedSupplierPartId]);
  useEffect(() => { isPendingRef.current = isPending; }, [isPending]);
  useEffect(() => { pendingQuantityRef.current = pendingQuantity; }, [pendingQuantity]);
  useEffect(() => { onPartSelectRef.current = onPartSelect; }, [onPartSelect]);
  useEffect(() => { partRef.current = part; }, [part]);

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

  // ─── Touch handling ────────────────────────────────────────────────────────
  // Strategy:
  //  1. Non-passive touchstart on card → always call preventDefault so the
  //     browser NEVER gets to decide "this is a scroll".
  //  2. When long-press fires, open the drum-roll overlay (portal to body).
  //  3. touchmove/touchend listeners move to DOCUMENT so the finger can drift
  //     anywhere and we still track it.
  //  4. A non-passive document touchmove listener prevents any scroll while
  //     the drum roll is open.

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let isLongPress = false;
    let didScroll = false;
    let activeTouchId = -1;
    let startY = 0;
    let startQty = 1;

    // ── document-level handlers (attached only while long-press is active) ──
    const onDocMove = (e: TouchEvent) => {
      e.preventDefault(); // block any scroll while drum roll is open

      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i]!.identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;

      const delta = touch.clientY - startY;
      const newQty = Math.max(1, Math.round(startQty + delta / 20));
      draftQtyRef.current = newQty;
      setDraftQty(newQty);
    };

    const onDocEnd = (e: TouchEvent) => {
      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i]!.identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;
      detachDocListeners();

      const supplierId = selectedSupplierPartIdRef.current;
      if (supplierId) {
        onPartSelectRef.current(partRef.current, supplierId, draftQtyRef.current);
      }
      setIsQtyPickerOpen(false);
      isLongPress = false;
    };

    const onDocCancel = () => {
      detachDocListeners();
      setIsQtyPickerOpen(false);
      isLongPress = false;
    };

    const attachDocListeners = () => {
      document.addEventListener("touchmove", onDocMove, { passive: false });
      document.addEventListener("touchend", onDocEnd, { passive: true });
      document.addEventListener("touchcancel", onDocCancel, { passive: true });
    };

    const detachDocListeners = () => {
      document.removeEventListener("touchmove", onDocMove);
      document.removeEventListener("touchend", onDocEnd);
      document.removeEventListener("touchcancel", onDocCancel);
    };

    // ── card-level handlers ──────────────────────────────────────────────────
    const onTouchStart = (e: TouchEvent) => {
      if (!hasSupplierRef.current) return;
      // Do NOT preventDefault here — we want normal scrolling to work.
      // If the user holds for 500ms without moving, the browser won't have
      // committed to a scroll, and we lock it out then via doc listeners.

      const touch = e.changedTouches[0];
      if (!touch) return;
      activeTouchId = touch.identifier;
      startY = touch.clientY;
      isLongPress = false;
      didScroll = false;

      const qty = isPendingRef.current ? pendingQuantityRef.current : 1;
      startQty = qty;
      draftQtyRef.current = qty;
      setDraftQty(qty);

      timer = setTimeout(() => {
        isLongPress = true;
        setIsQtyPickerOpen(true);
        // Hand off move/end tracking to document so finger can drift anywhere.
        // Non-passive touchmove will call preventDefault to block any scroll.
        attachDocListeners();
      }, 300);
    };

    const onTouchMove = (e: TouchEvent) => {
      // Only runs before long-press fires (after that, doc listeners take over)
      if (isLongPress) return;

      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i]!.identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;

      const dy = Math.abs(touch.clientY - startY);
      if (dy > 8) {
        didScroll = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Only runs for a TAP (long-press hands off to doc listeners before this)
      if (isLongPress) return;
      if (timer) { clearTimeout(timer); timer = null; }

      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i]!.identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;

      const supplierId = selectedSupplierPartIdRef.current;
      if (supplierId && !didScroll) onPartSelectRef.current(partRef.current, supplierId);
    };

    const onTouchCancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (isLongPress) {
        detachDocListeners();
        setIsQtyPickerOpen(false);
        isLongPress = false;
      }
    };

    card.addEventListener("touchstart", onTouchStart, { passive: false });
    card.addEventListener("touchmove", onTouchMove, { passive: true });
    card.addEventListener("touchend", onTouchEnd, { passive: true });
    card.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      card.removeEventListener("touchstart", onTouchStart);
      card.removeEventListener("touchmove", onTouchMove);
      card.removeEventListener("touchend", onTouchEnd);
      card.removeEventListener("touchcancel", onTouchCancel);
      detachDocListeners();
      if (timer) clearTimeout(timer);
    };
  }, [part.id]); // only re-run if the card itself is replaced
  // ──────────────────────────────────────────────────────────────────────────

  const hasSupplier = !!selectedSupplierPartId;

  return (
    <>
      <Card
        ref={cardRef}
        className={`relative transition-all hover:shadow-md ${isPending ? "border-primary border-2" : ""} ${hasSupplier ? "cursor-pointer select-none" : "select-none"}`}
        style={{
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          // Leave touchAction default so normal scrolling works.
          // Scroll is only blocked after the 500ms long-press fires.
        }}
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

      {/* Drum roll — rendered as a portal directly on document.body so it
          escapes Radix's stacking context and any dialog z-index rules.
          It is purely visual; all touch tracking happens on the card element
          and the document-level listeners above. */}
      {isQtyPickerOpen && typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99999,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.55)",
              touchAction: "none",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {Array.from({ length: 21 }, (_, i) => {
                const offset = i - 10;
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
                    style={{
                      fontSize,
                      fontWeight,
                      color,
                      lineHeight,
                      transform: `scale(${scale})`,
                      transition: "all 0.05s",
                      minHeight: lineHeight,
                      textAlign: "center",
                      userSelect: "none",
                    }}
                  >
                    {num >= 1 ? num : ""}
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: 24, fontSize: 12, color: "rgba(255,255,255,0.4)", userSelect: "none" }}>
              Drag down · Release to confirm
            </p>
          </div>,
          document.body,
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
    category?: { name?: string | null; categoryId?: string | null };
  }) => void;
  selectedMaterialId: string | null;
  selectedSize: { nominal: number; unit: string } | null;
  selectedPartTypeCategory: { categoryId: string | null; name: string } | null;
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
      <h3 className="text-base font-semibold sm:text-lg">Select Parts</h3>
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
