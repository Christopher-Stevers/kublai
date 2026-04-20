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
  selectedPartTypeCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  onStageClick?: (
    stage: "catalog" | "material" | "size" | "partTypeCategory" | "part",
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
  selectedPartTypeCategory,
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
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <WizardProgressIndicator
        currentStage={currentStage}
        selectedCatalog={selectedCatalog}
        selectedMaterial={selectedMaterial}
        selectedSize={selectedSize}
        selectedPartTypeCategory={selectedPartTypeCategory}
        onStageClick={onStageClick}
      />
      {!hideSearch && onSearchChange && (
        <div className="relative shrink-0">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-[18ch] rounded-lg pl-9 text-sm sm:h-10 sm:w-[22ch]"
          />
        </div>
      )}
      {actionLabel && onActionClick && (
        <Button
          type="button"
          variant="outline"
          onClick={onActionClick}
          disabled={actionDisabled}
          className="h-9 shrink-0 rounded-lg px-3 py-2 text-sm sm:h-10"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
