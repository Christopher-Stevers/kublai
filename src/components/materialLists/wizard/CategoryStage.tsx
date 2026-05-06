"use client";

import { useClientPagination } from "~/components/ui/list-pagination";
import {
  CustomOptionForm,
  PartCount,
  WizardAllOption,
  WizardOptionCard,
  WIZARD_OPTION_GRID_CLASS,
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
}

export function CategoryStage({
  categories,
  selectedCategory,
  allSelected = false,
  onCategorySelect,
  showCustomCategoryInput,
  customCategoryName,
  onCustomCategoryNameChange,
  onCustomCategorySubmit,
}: CategoryStageProps) {
  const pagination = useClientPagination(categories);

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Category</h3>
      <div className={WIZARD_OPTION_GRID_CLASS}>
        <WizardAllOption
          selected={allSelected}
          onSelect={() => onCategorySelect({ categoryId: null, name: "All Categories" })}
        />
        {pagination.paginatedItems.map((category) => (
          <WizardOptionCard
            key={category.categoryId}
            selected={selectedCategory?.categoryId === category.categoryId}
            onClick={() => onCategorySelect({ categoryId: category.categoryId, name: category.name })}
          >
            <p className="text-sm font-medium sm:text-base">{category.name}</p>
            <PartCount count={category.count} />
          </WizardOptionCard>
        ))}
      </div>
      {showCustomCategoryInput && (
        <CustomOptionForm
          value={customCategoryName}
          placeholder="Enter custom category name"
          buttonLabel="Add Category"
          onChange={onCustomCategoryNameChange}
          onSubmit={onCustomCategorySubmit}
        />
      )}
      <WizardOptionPagination pagination={pagination} itemLabel="categories" />
    </div>
  );
}
