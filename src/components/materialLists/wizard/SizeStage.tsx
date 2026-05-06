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
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";

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
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "border-primary border-2 shadow-md" : ""}`}
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${
            allSelected ? "border-primary border-2 shadow-md" : ""
          }`}
          onClick={() => onSizeSelect(null)}
        >
          <CardContent className="p-3 text-center sm:p-4">
            <p className="text-sm font-medium sm:text-base">All</p>
          </CardContent>
        </Card>
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
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="sizes"
        onPageChange={pagination.setPage}
      />
      {subSizePreview && (
        <div
          className="fixed inset-0 z-[90] flex touch-none select-none bg-black/20 backdrop-blur-[1px]"
          style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
        >
          <div className="flex h-full w-full p-2 sm:p-3">
            <div
              className="flex h-full w-full flex-col rounded-[2rem] bg-white/18 px-4 py-5 text-slate-950 shadow-2xl ring-1 ring-white/20 backdrop-blur-md sm:px-8 sm:py-8"
              style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
            >
              <div className="mb-6 text-center sm:mb-8">
                <div className="text-base font-medium uppercase tracking-[0.22em] text-slate-900/80 sm:text-lg">
                  Sub-size
                </div>
                <div
                  className="mt-2 text-base font-semibold text-slate-950 sm:text-xl"
                  style={{
                    WebkitTextStroke: "0.35px rgba(255,255,255,0.7)",
                    textShadow:
                      "0 0 2px rgba(255,255,255,0.9), 0 0 8px rgba(15,23,42,0.78), 0 0 18px rgba(0,0,0,0.58)",
                  }}
                >
                  {formatSize(subSizePreview.size.nominal, subSizePreview.size.unit)} fittings
                </div>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                <div className="absolute inset-x-0 top-1/2 h-24 -translate-y-1/2 rounded-3xl border border-white/35 bg-white/20 shadow-inner sm:h-28" />
                <div className="absolute inset-x-0 flex flex-col items-center transition-transform duration-75 ease-out">
                  {Array.from({ length: 13 }, (_, index) => {
                    const rawIndex = subSizePreview.selectedIndex - 6 + index;
                    const subSize = subSizePreview.size.subSizes?.[rawIndex] ?? null;
                    const distance = Math.abs(rawIndex - subSizePreview.selectedIndex);
                    const opacity = subSize === null ? 0 : Math.max(0.3, 1 - distance * 0.14);
                    const scale = Math.max(0.72, 1 - distance * 0.08);
                    const isActive = distance === 0;
                    return (
                      <div
                        key={`${subSizePreview.selectedIndex}-${rawIndex}-${subSize?.label ?? "blank"}`}
                        className="flex h-13 max-w-full select-none items-center justify-center px-3 text-center font-black leading-none tracking-tight sm:h-16"
                        style={{
                          opacity,
                          color: isActive ? "#020617" : "#0f172a",
                          transform: `scale(${scale})`,
                          fontSize: distance === 0 ? "3.7rem" : distance === 1 ? "2.35rem" : "1.35rem",
                          WebkitTextStroke: isActive
                            ? "1.35px rgba(255,255,255,0.92)"
                            : "0.75px rgba(255,255,255,0.62)",
                          textShadow: isActive
                            ? "0 0 2px rgba(255,255,255,1), 0 0 6px rgba(255,255,255,0.85), 0 0 12px rgba(0,0,0,0.95), 0 0 26px rgba(0,0,0,0.9), 0 0 42px rgba(0,0,0,0.78)"
                            : "0 0 2px rgba(255,255,255,0.85), 0 0 10px rgba(0,0,0,0.72), 0 0 22px rgba(0,0,0,0.58)",
                        }}
                      >
                        {subSize?.label ?? ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
