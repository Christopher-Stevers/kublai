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
      className={`grid grid-cols-1 items-center gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)_auto] ${className}`.trim()}
    >
      <div className="min-w-0">
        <WizardProgressIndicator
          currentStage={currentStage}
          selectedCatalog={selectedCatalog}
          selectedMaterial={selectedMaterial}
          selectedSize={selectedSize}
          selectedCategory={selectedCategory}
          onStageClick={onStageClick}
        />
      </div>
      {!hideSearch && onSearchChange ? (
        <div className="relative min-w-0">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg pl-9 text-sm"
          />
        </div>
      ) : (
        <div className="hidden lg:block" />
      )}
      {actionLabel && onActionClick ? (
        <Button
          type="button"
          variant="outline"
          onClick={onActionClick}
          disabled={actionDisabled}
          className="h-9 w-full rounded-lg px-3 text-sm lg:w-auto"
        >
          {actionLabel}
        </Button>
      ) : (
        <div className="hidden lg:block" />
      )}
    </div>
  );
}
