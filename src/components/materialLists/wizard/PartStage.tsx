import { JobPriceBadge } from "~/components/jobPricing/JobPriceBadge";
import { useQuickWheelOptions } from "./QuickWheel";
import { packContents, packsFromPieces, formatPackQuantity } from "~/lib/pack-quantity";
import { PackQuantityControls } from "../PackQuantityControls";
import {
  useState,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { AlertCircle, Minus, Plus } from "lucide-react";
import Image from "next/image";
import type { PendingPart } from "./types";
import { useClientPagination } from "~/components/ui/list-pagination";
import { ViewToggle } from "~/components/ui/view-toggle";
import { WizardOptionPagination } from "./WizardOptionGrid";

const PART_TILE_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(min(1.5in,100%),2in))] justify-center justify-items-center gap-3";

type PartStageActionMode = "select" | "edit";

interface PartCardProps {
  details?: ReactNode;
  part: {
    id: string;
    displayName: string;
    piecesPerPack?: number | null;
    bulkUnit?: string | null;
    individualUnit?: string | null;
    description: string | null;
    imageUrl: string | null;
    jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
    material: string | null;
    size: string | null;
  };
  isPending: boolean;
  pendingQuantity?: number;
  onPartSelect: (
    part: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      description: string | null;
      imageUrl: string | null;
      jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
      material: string | null;
      size: string | null;
    },
    supplierPartId?: string,
  ) => void;
  onPartQuantitySet?: (
    part: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      description: string | null;
      imageUrl: string | null;
      jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
      material: string | null;
      size: string | null;
    },
    quantity: number,
  ) => void;
  onQuantityPickerPreviewChange?: (
    preview: {
      partId: string;
      partName: string;
      mode?: "individual";
      pointerY?: number;
      inputType?: string;
      quantity: number;
    } | null,
  ) => void;
  onEditPart: (partId: string) => void;
  actionMode?: PartStageActionMode;
  actionLabel?: string;
  emptyMessage?: string;
}

function PartCard({
  part,
  isPending,
  pendingQuantity = 0,
  onPartSelect,
  onPartQuantitySet,
  onQuantityPickerPreviewChange,
  onEditPart,
  actionMode = "select",
  details,
}: PartCardProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartYRef = useRef<number | null>(null);
  const baseQuantityRef = useRef(1);
  const dragQuantityRef = useRef(Math.max(pendingQuantity, 1));
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTypeRef = useRef<string | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const individualModeRef = useRef(false);
  const switchLatchedRef = useRef(false);
  const latestYRef = useRef(0);
  const clearDwell = () => { if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; };
  const pointerElementRef = useRef<HTMLDivElement | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const clampQuantity = (quantity: number) => Math.max(packContents(part.piecesPerPack) > 1 ? -1 : 0, quantity);

  const clearPickerPreview = () => {
    onQuantityPickerPreviewChange?.(null);
  };

  const updateDragQuantity = (clientY: number) => {
    if (!longPressTriggeredRef.current || pointerStartYRef.current === null)
      return;

    if (activePointerTypeRef.current === "touch") return;
    latestYRef.current = clientY;
    const deltaY = clientY - pointerStartYRef.current;
    const steps = Math.round(deltaY / 18);
    const nextQuantity = clampQuantity(baseQuantityRef.current + steps);
    dragQuantityRef.current = nextQuantity;
    onQuantityPickerPreviewChange?.({
      partId: part.id,
      partName: part.displayName,
      quantity: nextQuantity,
      mode: individualModeRef.current ? "individual" : undefined,
    });
    if (nextQuantity === -1) {
      if (!dwellTimerRef.current && !switchLatchedRef.current) dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        switchLatchedRef.current = true;
        individualModeRef.current = !individualModeRef.current;
        pointerStartYRef.current = latestYRef.current;
        baseQuantityRef.current = -1;
        dragQuantityRef.current = -1;
        onQuantityPickerPreviewChange?.({partId:part.id, partName:part.displayName, quantity:-1, mode:individualModeRef.current ? "individual" : undefined});
      }, 1000);
    } else { clearDwell(); switchLatchedRef.current = false; }
  };

  const teardownWindowListeners = () => {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerCancel);
  };

  const finishLongPressSelection = () => {
    clearDwell();
    if (dragQuantityRef.current >= 0) onPartQuantitySet?.(part, individualModeRef.current ? packsFromPieces(dragQuantityRef.current, part.piecesPerPack) : dragQuantityRef.current);
    clearPickerPreview();
    longPressTriggeredRef.current = false;
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    activePointerTypeRef.current = null;
    pointerElementRef.current = null;
    teardownWindowListeners();
  };

  const cancelLongPressSelection = () => {
    clearDwell();
    clearPickerPreview();
    longPressTriggeredRef.current = false;
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    activePointerTypeRef.current = null;
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

    if (
      longPressTriggeredRef.current &&
      activePointerTypeRef.current === "touch"
    ) {
      return;
    }

    event.preventDefault();
    clearLongPressTimer();

    if (longPressTriggeredRef.current) {
      finishLongPressSelection();
    }
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;

    if (
      longPressTriggeredRef.current &&
      activePointerTypeRef.current === "touch"
    ) {
      return;
    }

    clearLongPressTimer();
    cancelLongPressSelection();
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    if (actionMode === "edit") {
      activePointerIdRef.current = event.pointerId;
      activePointerTypeRef.current = event.pointerType;
      pointerElementRef.current = event.currentTarget;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    clearDwell();
    individualModeRef.current = false;
    switchLatchedRef.current = false;
    longPressTriggeredRef.current = false;
    activePointerIdRef.current = event.pointerId;
    activePointerTypeRef.current = event.pointerType;
    pointerElementRef.current = event.currentTarget;
    pointerStartYRef.current = event.clientY;
    baseQuantityRef.current = pendingQuantity > 0 ? Math.ceil(pendingQuantity) : 1;
    dragQuantityRef.current = baseQuantityRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);

    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;

      if (
        pointerElementRef.current &&
        activePointerIdRef.current !== null &&
        pointerElementRef.current.hasPointerCapture(activePointerIdRef.current)
      ) {
        pointerElementRef.current.releasePointerCapture(
          activePointerIdRef.current,
        );
      }

      onQuantityPickerPreviewChange?.({
        partId: part.id,
        partName: part.displayName,
        quantity: baseQuantityRef.current,
        pointerY: pointerStartYRef.current ?? undefined,
        inputType: activePointerTypeRef.current ?? undefined,
      });
      window.addEventListener("pointermove", handleWindowPointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleWindowPointerUp, {
        passive: false,
      });
      window.addEventListener("pointercancel", handleWindowPointerCancel);
    }, 100);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!longPressTriggeredRef.current) return;
    event.preventDefault();
    updateDragQuantity(event.clientY);
  };

  const finishPointerInteraction = () => {
    clearLongPressTimer();

    if (actionMode === "edit") {
      onEditPart(part.id);
      pointerStartYRef.current = null;
      activePointerIdRef.current = null;
      activePointerTypeRef.current = null;
      pointerElementRef.current = null;
      return;
    }

    if (longPressTriggeredRef.current) {
      if (activePointerTypeRef.current === "touch") {
        return;
      }

      finishLongPressSelection();
      return;
    }

    onPartSelect(part);
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    activePointerTypeRef.current = null;
    pointerElementRef.current = null;
  };

  const cancelPointerInteraction = () => {
    clearLongPressTimer();

    if (
      longPressTriggeredRef.current &&
      activePointerTypeRef.current === "touch"
    ) {
      return;
    }

    cancelLongPressSelection();
  };

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      clearDwell();
      teardownWindowListeners();
    };
  }, []);

  return (
    <Card
      data-tutorial-choice={part.displayName}
      data-tutorial-part-selected={isPending || undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (actionMode === "edit") onEditPart(part.id);
          else onPartSelect(part);
        }
      }}
      className={`relative w-full max-w-[2in] gap-0 overflow-hidden rounded-2xl py-0 transition-all hover:shadow-md ${
        isPending ? "border-primary border-2 shadow-md" : ""
      } cursor-pointer`}
      style={{
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
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
      <CardContent className="p-0">
        <div className="flex w-full flex-col p-3">
          <div className="part-photo-frame relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-muted">
            {part.imageUrl ? (
              <Image
                src={part.imageUrl}
                alt={part.displayName}
                fill
                className="part-photo object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground/70">
                <AlertCircle className="h-8 w-8" />
              </div>
            )}

            <div className="absolute top-2 right-2 flex justify-end">
              {pendingQuantity > 0 && (
                <div className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground shadow-sm sm:h-7 sm:min-w-7 sm:text-sm">
                  {formatPackQuantity(pendingQuantity, part.piecesPerPack)}
                </div>
              )}
            </div>
            {(part.jobPriceStatus === "estimated" ||
              part.jobPriceStatus === "confirmed") && (
              <div className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] leading-tight font-semibold tracking-wide text-white shadow-sm backdrop-blur-sm">
                Quoted
              </div>
            )}
            {part.imageApprovalStatus === "suggested" && (
              <div className="absolute right-2 bottom-2 rounded bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white shadow">
                Needs approval
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-1 text-center text-foreground">
            <h4 className="line-clamp-4 text-sm leading-snug font-medium">
              {part.displayName}
            </h4>
            {details}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PartSheetHeader() {
  return <div className="parts-sheet-header grid grid-cols-[3rem_minmax(16rem,1fr)_10rem]"><span>Photo</span><span>Part description</span><span className="text-center">Quantity / action</span></div>;
}

function PartListRow({
  part,
  isPending,
  pendingQuantity = 0,
  onPartSelect,
  onPartQuantitySet,
  onEditPart,
  actionMode = "select",
  actionLabel,
  details,
}: PartCardProps) {
  const [quantityInput, setQuantityInput] = useState(() =>
    pendingQuantity > 0 ? String(pendingQuantity) : "",
  );

  useEffect(() => {
    setQuantityInput(pendingQuantity > 0 ? String(pendingQuantity) : "");
  }, [pendingQuantity]);

  return (
    <div
      data-tutorial-part-selected={isPending || undefined}
      className={`parts-picker-row ${
        isPending ? "ring-1 ring-inset ring-primary" : ""
      }`}
    >
      <div className="grid grid-cols-[3rem_minmax(16rem,1fr)_10rem] parts-sheet-cells">
        <div className="relative min-h-11 w-12 overflow-hidden">
          {part.imageUrl ? (
            <Image
              src={part.imageUrl}
              alt={part.displayName}
              fill
              sizes="32px"
              className="part-photo object-contain p-1"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground/70">
              <AlertCircle className="h-4 w-4" />
            </div>
          )}
          {part.imageApprovalStatus === "suggested" && (
            <div className="absolute inset-x-0 bottom-0 bg-amber-500 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
              Review
            </div>
          )}
        </div>

        <div className="min-w-0 content-center">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="text-sm leading-snug font-medium">
              {part.displayName}
            </h4>
          </div>
          <JobPriceBadge status={part.jobPriceStatus}/>
            {details}
        </div>

        <div className="flex items-center justify-center gap-1.5">
          {isPending && actionMode === "select" && packContents(part.piecesPerPack) > 1 ? (
            <PackQuantityControls quantity={pendingQuantity} piecesPerPack={part.piecesPerPack!} bulkUnit={part.bulkUnit} individualUnit={part.individualUnit} onChange={value => onPartQuantitySet?.(part, value)} />
          ) : isPending && actionMode === "select" ? (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPartQuantitySet?.(part, pendingQuantity - 1)}
                className="h-8 w-7 p-0 sm:w-8"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                min="0"
                value={quantityInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const nextValue = e.target.value;
                  setQuantityInput(nextValue);

                  if (nextValue === "") {
                    return;
                  }

                  onPartQuantitySet?.(part, parseInt(nextValue) || 0);
                }}
                onBlur={() => {
                  const parsedQuantity = parseInt(quantityInput);

                  if (
                    !quantityInput ||
                    Number.isNaN(parsedQuantity) ||
                    parsedQuantity <= 0
                  ) {
                    setQuantityInput("");
                    onPartQuantitySet?.(part, 0);
                    return;
                  }

                  setQuantityInput(String(parsedQuantity));
                  onPartQuantitySet?.(part, parsedQuantity);
                }}
                className="h-8 w-12 [appearance:textfield] px-1 text-center text-sm sm:w-14 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPartQuantitySet?.(part, pendingQuantity + 1)}
                className="h-8 w-7 p-0 sm:w-8"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              data-tutorial-choice={part.displayName}
              className="h-8 px-2.5 text-xs sm:px-3"
              onClick={() =>
                actionMode === "edit" ? onEditPart(part.id) : onPartSelect(part)
              }
            >
              {actionLabel ?? (actionMode === "edit" ? "Edit" : "Add")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface PartStageProps {
  onVisiblePartsChange?: (ids: string[]) => void;
  detailsByPartId?: Record<string, ReactNode>;
  partsForSelection: Array<{
    id: string;
    displayName: string;
    piecesPerPack?: number | null;
    bulkUnit?: string | null;
    individualUnit?: string | null;
    description: string | null;
    imageUrl: string | null;
    jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
    material: string | null;
    size: string | null;
  }>;
  pendingParts: PendingPart[];
  onPartSelect: (
    part: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      description: string | null;
      imageUrl: string | null;
      jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
      material: string | null;
      size: string | null;
    },
    supplierPartId?: string,
  ) => void;
  onPartQuantitySet?: (
    part: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      description: string | null;
      imageUrl: string | null;
      jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
      material: string | null;
      size: string | null;
    },
    quantity: number,
  ) => void;
  onQuantityPickerPreviewChange?: (
    preview: {
      partId: string;
      partName: string;
      mode?: "individual";
      pointerY?: number;
      inputType?: string;
      quantity: number;
    } | null,
  ) => void;
  onEditPart: (partId: string) => void;




  actionMode?: PartStageActionMode;
  title?: string;
  actionLabel?: string;
  emptyMessage?: string;
}

export function PartStage({
  partsForSelection,
  pendingParts,
  onPartSelect,
  onPartQuantitySet,
  onQuantityPickerPreviewChange,
  onEditPart,
  actionMode = "select",
  title = "Select Parts",
  actionLabel,
  emptyMessage,
  detailsByPartId,
  onVisiblePartsChange,
}: PartStageProps) {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const pagination = useClientPagination(partsForSelection);
  const visibleParts = pagination.paginatedItems;
  const visibleIds = JSON.stringify(visibleParts.map(part => part.id));
  useEffect(() => {
    onVisiblePartsChange?.(JSON.parse(visibleIds) as string[]);
  }, [visibleIds, onVisiblePartsChange]);
  useQuickWheelOptions(actionMode === "edit" ? "Edit Part" : "Add Part", partsForSelection.map(part => ({
    label: part.displayName,
    select: () => actionMode === "edit" ? onEditPart(part.id) : onPartSelect(part),
  })));

  const getPendingPartState = (partId: string) => {
    const pendingPart = pendingParts.find((part) => part.partId === partId);
    return {
      isPending: Boolean(pendingPart),
      pendingQuantity: pendingPart?.quantity ?? 0,
    };
  };

  if (partsForSelection.length === 0) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base font-semibold sm:text-lg">No Parts Found</h3>
        <p className="text-xs text-muted-foreground sm:text-sm">
          {emptyMessage ??
            "No parts found for the selected material, size, and category."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold sm:text-lg">{title}</h3>
        <ViewToggle
          view={viewMode}
          onViewChange={setViewMode}
          showOnMobile
        />
      </div>
      {viewMode === "grid" ? (
        <div className={PART_TILE_GRID_CLASS}>
          {visibleParts.map((part) => {
            const { isPending, pendingQuantity } = getPendingPartState(part.id);
            return (
              <PartCard
                key={part.id}
                part={part}
                details={detailsByPartId?.[part.id]}
                isPending={isPending}
                pendingQuantity={pendingQuantity}
                onPartSelect={onPartSelect}
                onPartQuantitySet={onPartQuantitySet}
                onQuantityPickerPreviewChange={onQuantityPickerPreviewChange}
                onEditPart={onEditPart}
                actionMode={actionMode}
                actionLabel={actionLabel}
              />
            );
          })}
        </div>
      ) : (
        <div className="parts-sheet-scroll"><div className="parts-sheet min-w-[29rem]">
          <PartSheetHeader />
          {visibleParts.map((part) => {
            const { isPending, pendingQuantity } = getPendingPartState(part.id);
            return (
              <PartListRow
                key={part.id}
                part={part}
                details={detailsByPartId?.[part.id]}
                isPending={isPending}
                pendingQuantity={pendingQuantity}
                onPartSelect={onPartSelect}
                onPartQuantitySet={onPartQuantitySet}
                onEditPart={onEditPart}
                actionMode={actionMode}
                actionLabel={actionLabel}
              />
            );
          })}
        </div></div>
      )}
      <WizardOptionPagination pagination={pagination} itemLabel="parts" />
    </div>
  );
}
