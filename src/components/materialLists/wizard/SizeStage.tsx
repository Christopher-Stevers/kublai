"use client";

import { useQuickWheelMenu, useQuickWheelOptions } from "./QuickWheel";
import { wizardSizeOptions } from "~/lib/wizard-size-options";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { formatSize, formatSizeDimensions } from "~/lib/size-utils";
import { Card, CardContent } from "~/components/ui/card";
import { useClientPagination } from "~/components/ui/list-pagination";
import {
  WIZARD_OPTION_GRID_CLASS,
  wizardOptionGridStyle,
  WIZARD_OPTION_ITEM_SIZE_CLASS,
  WIZARD_OPTION_LABEL_CLASS,
  WIZARD_OPTION_SELECTED_CLASS,
  WizardAllOption,
  WizardOptionPagination,
} from "./WizardOptionGrid";

type SizeSelection = { nominal: number; unit: string; sizeLabel?: string | null };
type AvailableSize = SizeSelection & {
  count: number;
  subSizes?: Array<{ label: string; count: number }>;
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
}: {
  size: AvailableSize;
  selectedSize: SizeSelection | null;
  onSizeSelect: (size: SizeSelection) => void;
}) {
  const openMenu = useQuickWheelMenu();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const subSizes = size.subSizes ?? [];
  const isSelected =
    selectedSize?.nominal === size.nominal &&
    selectedSize?.unit === size.unit &&
    (selectedSize?.sizeLabel ?? null) === (size.sizeLabel ?? null);
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const cancel = () => {
    clearTimer();
    start.current = null;
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    cancel();
    held.current = false;
    start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (subSizes.length <= 1) return;
    const pointer = event.nativeEvent;
    timer.current = setTimeout(() => {
      timer.current = null;
      held.current = openMenu(pointer, {
        title: "Sub-size",
        options: subSizes.map((subSize) => ({
          label: formatSizeDimensions(subSize.label, size.unit),
          select: () => onSizeSelect({
            nominal: size.nominal,
            unit: size.unit,
            sizeLabel: subSize.label,
          }),
        })),
      });
    }, 200);
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current?.id !== event.pointerId) return;
    cancel();
    if (!held.current)
      onSizeSelect({ nominal: size.nominal, unit: size.unit, sizeLabel: null });
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const origin = start.current;
      if (event.pointerId === origin?.id &&
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8)
        cancel();
    };
    // React handles a normal card tap before this bubbling release listener.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, []);

  return (
    <Card
      data-tutorial-choice={formatSize(size.nominal, size.unit)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSizeSelect({ nominal: size.nominal, unit: size.unit, sizeLabel: null });
        }
      }}
      className={`${WIZARD_OPTION_ITEM_SIZE_CLASS} min-w-0 cursor-pointer justify-center gap-0 overflow-hidden py-0 transition-all hover:shadow-md ${isSelected ? WIZARD_OPTION_SELECTED_CLASS : ""}`}
      style={{
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancel}
      onPointerLeave={clearTimer}
    >
      <CardContent className="flex h-full min-w-0 items-center justify-center p-3 text-center sm:p-4">
        <p className={WIZARD_OPTION_LABEL_CLASS}>{formatSizeDimensions(size.nominal, size.unit)}</p>
      </CardContent>
    </Card>
  );
}

export function SizeStage({
  availableSizes,
  selectedSize,
  allSelected = false,
  onSizeSelect: commitSize,
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
  useQuickWheelOptions("Select Size", [
    { label: "All", select: () => commitSize(null) },
    ...wizardSizeOptions(
      (availableSizes ?? []).flatMap<SizeSelection>((size) =>
        size.subSizes?.length
          ? size.subSizes.map((sub) => ({
              nominal: size.nominal,
              unit: size.unit,
              sizeLabel: sub.label,
            }))
          : [size],
      ),
    ).map((option) => ({
      label: option.label,
      select: () => commitSize(option.size),
    })),
  ]);
  // Regular cards retain their broad nominal-size filter and sub-size picker.
  const onSizeSelect = commitSize;
  void showCustomSize;
  void onShowCustomSize;
  void customSizeInput;
  void onCustomSizeInputChange;
  void customSizeUnitId;
  void onCustomSizeUnitIdChange;
  void allUnits;
  void onCreateSize;
  void isOnline;

  return (
    <div className="relative space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Size</h3>
      <div
        className={WIZARD_OPTION_GRID_CLASS}
        style={wizardOptionGridStyle(1 + pagination.paginatedItems.length)}
      >
        <WizardAllOption selected={allSelected} onSelect={() => onSizeSelect(null)} />
        {pagination.paginatedItems.map((size, index) => (
          <SizeCard
            key={`${size.nominal}_${size.unit}_${index}`}
            size={size}
            selectedSize={selectedSize}
            onSizeSelect={onSizeSelect}
          />
        ))}
      </div>
      <WizardOptionPagination pagination={pagination} itemLabel="sizes" />

    </div>
  );
}
