"use client";

import { Search } from "lucide-react";
import { Input } from "~/components/ui/input";
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
        <div
          className="relative shrink-0"
          style={{
            width: `${Math.max(14, (searchQuery || searchPlaceholder).length + 4)}ch`,
          }}
        >
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-full rounded-lg pl-9 text-xs sm:h-10 sm:text-sm"
          />
        </div>
      )}
    </div>
  );
}
