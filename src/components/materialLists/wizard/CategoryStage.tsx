"use client";

import { useQuickWheelOptions } from "./QuickWheel";
import { useClientPagination } from "~/components/ui/list-pagination";
import {
  WIZARD_OPTION_LABEL_CLASS,
  WizardAllOption,
  WizardOptionCard,
  WIZARD_OPTION_GRID_CLASS,
  wizardOptionGridStyle,
  WizardOptionPagination,
} from "./WizardOptionGrid";

export interface CategoryStageProps {
  categories: Array<{ categoryId: string; name: string; count?: number }>;
  selectedCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  allSelected?: boolean;
  onCategorySelect: (category: {
    categoryId: string | null;
    name: string;
  }) => void;
  showCustomCategoryInput: boolean;
  onShowCustomCategoryInput: (show: boolean) => void;
  customCategoryName: string;
  onCustomCategoryNameChange: (name: string) => void;
  onCustomCategorySubmit: () => void;
  isOnline?: boolean;
}

export function CategoryStage({
  categories,
  selectedCategory,
  allSelected = false,
  onCategorySelect,
  showCustomCategoryInput,
  onShowCustomCategoryInput,
  customCategoryName,
  onCustomCategoryNameChange,
  onCustomCategorySubmit,
  isOnline = true,
}: CategoryStageProps) {
  const pagination = useClientPagination(categories);
  const choose = useQuickWheelOptions("Select Category", [
    { label: "All", select: () => onCategorySelect({ categoryId: null, name: "All Categories" }) },
    ...categories.map(category => ({ label: category.name, select: () => onCategorySelect(category) })),
  ]);
  void showCustomCategoryInput;
  void onShowCustomCategoryInput;
  void customCategoryName;
  void onCustomCategoryNameChange;
  void onCustomCategorySubmit;
  void isOnline;

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Category</h3>
      <div
        className={WIZARD_OPTION_GRID_CLASS}
        style={wizardOptionGridStyle(1 + pagination.paginatedItems.length)}
      >
        <WizardAllOption
          selected={allSelected}
          onSelect={() => choose("All")}
        />
        {pagination.paginatedItems.map((category) => (
          <WizardOptionCard
            key={category.categoryId}
            tutorialChoice={category.name}
            selected={selectedCategory?.categoryId === category.categoryId}
            onClick={() => choose(category.name)}
          >
            <p className={WIZARD_OPTION_LABEL_CLASS}>{category.name}</p>
          </WizardOptionCard>
        ))}
      </div>
      <WizardOptionPagination pagination={pagination} itemLabel="categories" />
    </div>
  );
}
