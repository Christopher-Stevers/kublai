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
    <div className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center ${className}`.trim()}>
      <WizardProgressIndicator
        currentStage={currentStage}
        selectedCatalog={selectedCatalog}
        selectedMaterial={selectedMaterial}
        selectedSize={selectedSize}
        selectedPartTypeCategory={selectedPartTypeCategory}
        onStageClick={onStageClick}
      />
      {(!hideSearch && onSearchChange) || (actionLabel && onActionClick) ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          {!hideSearch && onSearchChange && (
            <div className="relative w-full sm:w-auto sm:shrink-0">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-lg pl-9 text-sm sm:h-10 sm:min-w-[18ch] sm:w-[min(26ch,calc(100vw-16rem))] sm:text-sm"
              />
            </div>
          )}
          {actionLabel && onActionClick && (
            <Button
              type="button"
              variant="outline"
              onClick={onActionClick}
              disabled={actionDisabled}
              className="h-9 w-full shrink-0 rounded-lg px-3 py-2 text-sm sm:h-10 sm:w-auto"
            >
              {actionLabel}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
