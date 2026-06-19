"use client";

import { Search } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { WizardProgressIndicator } from "~/components/materialLists/WizardProgressIndicator";
import type { WizardStage } from "~/components/materialLists/wizard/types";

interface WizardHeaderProps {
  currentStage: WizardStage;
  selectedCatalog?: string | null;
  selectedMaterial?: string | null;
  selectedSize?: { nominal: number; unit: string } | null;
  selectedCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  onStageClick?: (
    stage: "catalog" | "material" | "size" | "category" | "part",
  ) => void;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  hideSearch?: boolean;
  actionLabel?: string;
  onActionClick?: () => void;
  actionDisabled?: boolean;
  className?: string;
}

export function WizardHeader({
  currentStage,
  selectedCatalog,
  selectedMaterial,
  selectedSize,
  selectedCategory,
  onStageClick,
  searchQuery = "",
  onSearchChange,
  searchPlaceholder = "",
  hideSearch = false,
  actionLabel,
  onActionClick,
  actionDisabled = false,
  className = "",
}: WizardHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-1.5 sm:gap-2 xl:flex-row xl:items-start ${className}`.trim()}
    >
      <div className="w-full min-w-0 flex-1">
        <WizardProgressIndicator
          currentStage={currentStage}
          selectedCatalog={selectedCatalog}
          selectedMaterial={selectedMaterial}
          selectedSize={selectedSize}
          selectedCategory={selectedCategory}
          onStageClick={onStageClick}
        />
      </div>
      {((!hideSearch && onSearchChange) || (actionLabel && onActionClick)) && (
        <div className="flex w-full flex-wrap gap-1.5 sm:gap-2 xl:w-auto xl:max-w-[26rem] xl:min-w-[22rem] xl:justify-end">
          {!hideSearch && onSearchChange && (
            <div className="relative min-w-[min(100%,14rem)] flex-1 xl:min-w-0 xl:flex-[1_1_14rem]">
              <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-lg pl-8 text-sm sm:h-9"
              />
            </div>
          )}
          {actionLabel && onActionClick && (
            <Button
              type="button"
              variant="outline"
              onClick={onActionClick}
              disabled={actionDisabled}
              className="h-8 flex-1 rounded-lg px-3 text-sm sm:h-9 sm:flex-none"
            >
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
