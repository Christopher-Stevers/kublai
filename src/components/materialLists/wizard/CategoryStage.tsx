"use client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";

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
  onShowCustomCategoryInput,
  customCategoryName,
  onCustomCategoryNameChange,
  onCustomCategorySubmit,
}: CategoryStageProps) {
  const pagination = useClientPagination(categories);

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Category</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${
            allSelected
              ? "border-primary border-2 shadow-md"
              : ""
          }`}
          onClick={() =>
            onCategorySelect({
              categoryId: null,
              name: "All Categories",
            })
          }
        >
          <CardContent className="p-3 text-center sm:p-4">
            <p className="text-sm font-medium sm:text-base">All</p>
          </CardContent>
        </Card>
        {pagination.paginatedItems.map((category) => {
          return (
            <Card
              key={category.categoryId}
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedCategory?.categoryId === category.categoryId
                  ? "border-primary border-2 shadow-md"
                  : ""
              }`}
              onClick={() =>
                onCategorySelect({
                  categoryId: category.categoryId,
                  name: category.name,
                })
              }
            >
              <CardContent className="p-3 text-center sm:p-4">
                <p className="text-sm font-medium sm:text-base">{category.name}</p>
                {category.count !== undefined && category.count > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {category.count} part{category.count !== 1 ? "s" : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {showCustomCategoryInput && (
        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
          <Input
            placeholder="Enter custom category name"
            value={customCategoryName}
            onChange={(e) => onCustomCategoryNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customCategoryName.trim()) {
                onCustomCategorySubmit();
              }
            }}
            className="flex-1 text-sm sm:text-base"
            autoFocus
          />
          <Button
            onClick={onCustomCategorySubmit}
            disabled={!customCategoryName.trim()}
            className="w-full text-xs sm:w-auto sm:text-sm"
          >
            Add Category
          </Button>
        </div>
      )}
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="categories"
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
