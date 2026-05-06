"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { parseSizeInput, formatSize } from "~/lib/size-utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useClientPagination } from "~/components/ui/list-pagination";
import {
  WIZARD_OPTION_GRID_CLASS,
  WIZARD_OPTION_SELECTED_CLASS,
  WizardAllOption,
  WizardOptionPagination,
} from "./WizardOptionGrid";
import { VerticalPickerOverlay } from "./VerticalPickerOverlay";

type SizeSelection = { nominal: number; unit: string; sizeLabel?: string | null };
type AvailableSize = SizeSelection & {
  count: number;
  subSizes?: Array<{ label: string; count: number }>;
};

type SubSizePreview = {
  size: AvailableSize;
  selectedIndex: number;
};

export interface SizeStageProps {
  availableSizes?: AvailableSize[];
  selectedSize: SizeSelection | null;
  allSelected?: boolean;
  onSizeSelect: (size: SizeSelection | null) => void;
  showCustomSize: boolean;
  onShowCustomSize: (show: boolean) => void;
  customSizeInput: string;
  onCustomSizeInputChange: (input: string) => void;
  customSizeUnitId: string | null;
  onCustomSizeUnitIdChange: (unitId: string | null) => void;
  allUnits: Array<{ id: string; code: string }>;
  onCreateSize: {
    mutate: (variables: { nominal: number; unitId: string }) => void;
    isPending: boolean;
  };
}

function SizeCard({
  size,
  selectedSize,
  onSizeSelect,
  onPreviewChange,
}: {
  size: AvailableSize;
  selectedSize: SizeSelection | null;
  onSizeSelect: (size: SizeSelection) => void;
  onPreviewChange: (preview: SubSizePreview | null) => void;
}) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartYRef = useRef<number | null>(null);
  const selectedIndexRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTypeRef = useRef<string | null>(null);
  const pointerElementRef = useRef<HTMLDivElement | null>(null);
  const subSizes = size.subSizes ?? [];
  const canPickSubSize = subSizes.length > 1;
  const isSelected =
    selectedSize?.nominal === size.nominal &&
    selectedSize?.unit === size.unit &&
    (selectedSize?.sizeLabel ?? null) === (size.sizeLabel ?? null);

  const clearTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const teardownWindowListeners = () => {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerCancel);
  };

  const updateSelectedIndex = (clientY: number) => {
    if (!longPressTriggeredRef.current || pointerStartYRef.current === null || subSizes.length === 0) return;
    const deltaY = clientY - pointerStartYRef.current;
    const lastIndex = subSizes.length - 1;
    const nextIndex = Math.max(0, Math.min(lastIndex, Math.round(deltaY / 34)));

    if (selectedIndexRef.current === nextIndex) return;
    selectedIndexRef.current = nextIndex;
    onPreviewChange({ size, selectedIndex: nextIndex });
  };

  const resetInteraction = () => {
    longPressTriggeredRef.current = false;
    pointerStartYRef.current = null;
    activePointerIdRef.current = null;
    activePointerTypeRef.current = null;
    pointerElementRef.current = null;
    teardownWindowListeners();
  };

  const finishSubSizeSelection = () => {
    const selectedSubSize = subSizes[selectedIndexRef.current];
    if (selectedSubSize) {
      onSizeSelect({ nominal: size.nominal, unit: size.unit, sizeLabel: selectedSubSize.label });
    }
    onPreviewChange(null);
    resetInteraction();
  };

  const cancelSubSizeSelection = () => {
    onPreviewChange(null);
    resetInteraction();
  };

  function handleWindowPointerMove(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateSelectedIndex(event.clientY);
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    clearTimer();
    if (longPressTriggeredRef.current) finishSubSizeSelection();
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;
    clearTimer();
    cancelSubSizeSelection();
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    longPressTriggeredRef.current = false;
    activePointerIdRef.current = event.pointerId;
    activePointerTypeRef.current = event.pointerType;
    pointerElementRef.current = event.currentTarget;
    pointerStartYRef.current = event.clientY;
    selectedIndexRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (!canPickSubSize) return;

    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (
        pointerElementRef.current &&
        activePointerIdRef.current !== null &&
        pointerElementRef.current.hasPointerCapture(activePointerIdRef.current)
      ) {
        pointerElementRef.current.releasePointerCapture(activePointerIdRef.current);
      }
      onPreviewChange({ size, selectedIndex: 0 });
      window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
      window.addEventListener("pointerup", handleWindowPointerUp, { passive: false });
      window.addEventListener("pointercancel", handleWindowPointerCancel);
    }, 100);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!longPressTriggeredRef.current) return;
    event.preventDefault();
    updateSelectedIndex(event.clientY);
  };

  const handlePointerUp = () => {
    clearTimer();
    if (longPressTriggeredRef.current) {
      finishSubSizeSelection();
      return;
    }
    onSizeSelect({ nominal: size.nominal, unit: size.unit, sizeLabel: null });
    resetInteraction();
  };

  const handlePointerCancel = () => {
    clearTimer();
    cancelSubSizeSelection();
  };

  useEffect(() => {
    return () => {
      clearTimer();
      teardownWindowListeners();
    };
  }, []);

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? WIZARD_OPTION_SELECTED_CLASS : ""}`}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={() => {
        if (longPressTriggeredRef.current) return;
        clearTimer();
      }}
    >
      <CardContent className="p-3 text-center sm:p-4">
        <p className="text-sm font-medium sm:text-base">{formatSize(size.nominal, size.unit)}</p>
        <p className="mt-1 text-xs text-gray-500">
          {size.count} part{size.count !== 1 ? "s" : ""}
        </p>
        {canPickSubSize && (
          <p className="mt-1 text-[11px] text-gray-400">Long-press for sub-sizes</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SizeStage({
  availableSizes,
  selectedSize,
  allSelected = false,
  onSizeSelect,
  showCustomSize,
  onShowCustomSize,
  customSizeInput,
  onCustomSizeInputChange,
  customSizeUnitId,
  onCustomSizeUnitIdChange,
  allUnits,
  onCreateSize,
}: SizeStageProps) {
  const pagination = useClientPagination(availableSizes ?? []);
  const [subSizePreview, setSubSizePreview] = useState<SubSizePreview | null>(null);

  return (
    <div className={`relative space-y-3 sm:space-y-4 ${subSizePreview ? "touch-none" : ""}`}>
      <h3 className="text-base font-semibold sm:text-lg">Select Size</h3>
      <div className={WIZARD_OPTION_GRID_CLASS}>
        <WizardAllOption selected={allSelected} onSelect={() => onSizeSelect(null)} />
        {pagination.paginatedItems.map((size, index) => (
          <SizeCard
            key={`${size.nominal}_${size.unit}_${index}`}
            size={size}
            selectedSize={selectedSize}
            onSizeSelect={onSizeSelect}
            onPreviewChange={setSubSizePreview}
          />
        ))}
      </div>
      {showCustomSize && (
        <div className="mt-3 space-y-2 sm:mt-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-700 sm:text-sm">
                Size (number required)
              </label>
              <Input
                type="text"
                placeholder="Enter size (e.g., 1 ½, 2.5)"
                value={customSizeInput}
                onChange={(e) => onCustomSizeInputChange(e.target.value)}
                className="mt-1 text-sm sm:text-base"
                autoFocus
                disabled={onCreateSize.isPending}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 sm:text-sm">Unit</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="mt-1 w-full justify-between text-xs sm:text-sm"
                    disabled={onCreateSize.isPending}
                  >
                    {customSizeUnitId
                      ? (allUnits.find((u) => u.id === customSizeUnitId)
                          ?.code ?? "Select unit")
                      : "Select unit"}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {allUnits.map((unit) => (
                    <DropdownMenuItem
                      key={unit.id}
                      onClick={() => onCustomSizeUnitIdChange(unit.id)}
                    >
                      {unit.code}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <Button
            onClick={() => {
              const parsed = parseSizeInput(customSizeInput);
              if (parsed !== null && customSizeUnitId) {
                onCreateSize.mutate({
                  nominal: parsed,
                  unitId: customSizeUnitId,
                });
              }
            }}
            disabled={
              !customSizeInput.trim() ||
              !customSizeUnitId ||
              onCreateSize.isPending ||
              parseSizeInput(customSizeInput) === null
            }
            className="w-full text-xs sm:text-sm"
          >
            {onCreateSize.isPending ? "Adding..." : "Add Size"}
          </Button>
        </div>
      )}
      <WizardOptionPagination pagination={pagination} itemLabel="sizes" />
      {subSizePreview && (
        <VerticalPickerOverlay
          title="Sub-size"
          subtitle={`${formatSize(subSizePreview.size.nominal, subSizePreview.size.unit)} fittings`}
          centerIndex={subSizePreview.selectedIndex}
          getItem={(index) => subSizePreview.size.subSizes?.[index] ?? null}
          renderItem={(subSize) => subSize.label}
          activeFontSize="3.7rem"
          nearFontSize="2.35rem"
          farFontSize="1.35rem"
        />
      )}
    </div>
  );
}
