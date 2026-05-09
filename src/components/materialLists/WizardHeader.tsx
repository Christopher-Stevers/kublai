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
      className={`flex flex-wrap items-center gap-1.5 sm:gap-2 ${className}`.trim()}
    >
      <div className="min-w-0 flex-[999_1_20rem]">
        <WizardProgressIndicator
          currentStage={currentStage}
          selectedCatalog={selectedCatalog}
          selectedMaterial={selectedMaterial}
          selectedSize={selectedSize}
          selectedCategory={selectedCategory}
          onStageClick={onStageClick}
        />
      </div>
      {!hideSearch && onSearchChange && (
        <div className="relative min-w-[13rem] flex-[1_1_13rem]">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg pl-8 text-sm"
          />
        </div>
      )}
      {actionLabel && onActionClick && (
        <Button
          type="button"
          variant="outline"
          onClick={onActionClick}
          disabled={actionDisabled}
          className="h-9 min-w-max flex-[1_1_8rem] rounded-lg px-3 text-sm"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
