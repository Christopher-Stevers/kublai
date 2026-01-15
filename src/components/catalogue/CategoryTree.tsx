"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface CategoryTreeProps {
  categories: Array<{
    id: string;
    name: string;
    children: Array<unknown>;
    partCount?: number;
  }>;
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
}

export function CategoryTree({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: CategoryTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpanded(newExpanded);
  };

  const renderCategory = (
    category: {
      id: string;
      name: string;
      children: Array<unknown>;
      partCount?: number;
    },
    level = 0,
  ) => {
    const hasChildren = category.children.length > 0;
    const isExpanded = expanded.has(category.id);
    const isSelected = selectedCategoryId === category.id;

    return (
      <div key={category.id}>
        <div
          className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-100 ${
            isSelected
              ? "bg-blue-50 font-medium text-blue-900"
              : "text-gray-700"
          }`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(category.id);
              }}
              className="flex h-4 w-4 items-center justify-center"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}
          <button
            onClick={() => onSelectCategory(category.id)}
            className="flex flex-1 items-center justify-between text-left"
          >
            <span>{category.name}</span>
            {category.partCount !== undefined && category.partCount > 0 && (
              <span className="text-xs text-gray-500">
                {category.partCount}
              </span>
            )}
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {category.children.map((child) =>
              renderCategory(child as typeof category, level + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b p-4">
        <h2 className="font-semibold text-gray-900">Categories</h2>
      </div>
      <div className="py-2">
        <button
          onClick={() => onSelectCategory(null)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 ${
            selectedCategoryId === null
              ? "bg-blue-50 font-medium text-blue-900"
              : "text-gray-700"
          }`}
        >
          All Parts
        </button>
        {categories.map((category) => renderCategory(category))}
      </div>
    </div>
  );
}


