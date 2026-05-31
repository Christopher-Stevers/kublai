"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatSize } from "~/lib/size-utils";
import { Card, CardContent } from "~/components/ui/card";
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
  isOnline?: boolean;
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

    if (
      longPressTriggeredRef.current &&
      activePointerTypeRef.current === "touch"
    ) {
      return;
    }

    event.preventDefault();
    clearTimer();
    if (longPressTriggeredRef.current) finishSubSizeSelection();
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (activePointerIdRef.current !== event.pointerId) return;

    if (
      longPressTriggeredRef.current &&
      activePointerTypeRef.current === "touch"
    ) {
      return;
    }

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
      if (activePointerTypeRef.current === "touch") {
        return;
      }

      finishSubSizeSelection();
      return;
    }
    onSizeSelect({ nominal: size.nominal, unit: size.unit, sizeLabel: null });
    resetInteraction();
  };

  const handlePointerCancel = () => {
    clearTimer();

    if (
      longPressTriggeredRef.current &&
      activePointerTypeRef.current === "touch"
    ) {
      return;
    }

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
      className={`min-w-0 cursor-pointer overflow-hidden transition-all hover:shadow-md ${isSelected ? WIZARD_OPTION_SELECTED_CLASS : ""}`}
      style={{
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
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
      <CardContent className="min-w-0 p-3 text-center sm:p-4">
        <p className="truncate text-sm font-medium sm:text-base">{formatSize(size.nominal, size.unit)}</p>
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
  isOnline = true,
}: SizeStageProps) {
  const pagination = useClientPagination(availableSizes ?? []);
  const [subSizePreview, setSubSizePreview] = useState<SubSizePreview | null>(null);
  const subSizePreviewRef = useRef<SubSizePreview | null>(null);
  const pickerTouchYRef = useRef<number | null>(null);
  const pickerTouchAccumulatorRef = useRef(0);
  void showCustomSize;
  void onShowCustomSize;
  void customSizeInput;
  void onCustomSizeInputChange;
  void customSizeUnitId;
  void onCustomSizeUnitIdChange;
  void allUnits;
  void onCreateSize;
  void isOnline;

  useEffect(() => {
    subSizePreviewRef.current = subSizePreview;
  }, [subSizePreview]);

  useEffect(() => {
    if (!subSizePreview) {
      pickerTouchYRef.current = null;
      pickerTouchAccumulatorRef.current = 0;
      return;
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        return;
      }

      event.preventDefault();

      const touchY = event.touches[0]?.clientY;
      if (touchY === undefined) {
        return;
      }

      if (pickerTouchYRef.current === null) {
        pickerTouchYRef.current = touchY;
        return;
      }

      const deltaY = touchY - pickerTouchYRef.current;
      pickerTouchAccumulatorRef.current += deltaY;
      pickerTouchYRef.current = touchY;

      const stepSize = 34;
      const stepDelta = Math.trunc(pickerTouchAccumulatorRef.current / stepSize);
      if (stepDelta === 0) {
        return;
      }

      pickerTouchAccumulatorRef.current -= stepDelta * stepSize;

      setSubSizePreview((prev) => {
        if (!prev) {
          return prev;
        }

        const lastIndex = (prev.size.subSizes?.length ?? 1) - 1;
        return {
          ...prev,
          selectedIndex: Math.max(
            0,
            Math.min(lastIndex, prev.selectedIndex + stepDelta),
          ),
        };
      });
    };

    const handleTouchEnd = (event: TouchEvent) => {
      event.preventDefault();

      const preview = subSizePreviewRef.current;
      const selectedSubSize = preview?.size.subSizes?.[preview.selectedIndex];

      if (preview && selectedSubSize) {
        onSizeSelect({
          nominal: preview.size.nominal,
          unit: preview.size.unit,
          sizeLabel: selectedSubSize.label,
        });
      }

      pickerTouchYRef.current = null;
      pickerTouchAccumulatorRef.current = 0;
      setSubSizePreview(null);
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: false });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [onSizeSelect, subSizePreview]);

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
      <WizardOptionPagination pagination={pagination} itemLabel="sizes" />
      {subSizePreview && (
        <VerticalPickerOverlay
          title="Sub-size"
          subtitle={`${formatSize(subSizePreview.size.nominal, subSizePreview.size.unit)} fittings`}
          centerIndex={subSizePreview.selectedIndex}
          getItem={(index) => subSizePreview.size.subSizes?.[index] ?? null}
          getItemFontSize={(subSize, distance) => {
            const labelLength = subSize.label.length;

            if (labelLength >= 22) {
              return distance === 0 ? "1.35rem" : distance === 1 ? "0.85rem" : "0.65rem";
            }

            if (labelLength >= 16) {
              return distance === 0 ? "1.7rem" : distance === 1 ? "1rem" : "0.75rem";
            }

            return undefined;
          }}
          renderItem={(subSize) => subSize.label}
          activeFontSize="2.25rem"
          nearFontSize="1.25rem"
          farFontSize="0.85rem"
        />
      )}
    </div>
  );
}
