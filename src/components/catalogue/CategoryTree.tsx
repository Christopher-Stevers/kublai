"use client";


interface CategoryTreeProps {
  categories: Array<{
    id: string;
    name: string;
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
  const renderCategory = (
    category: {
      id: string;
      name: string;
      partCount?: number;
    },
  ) => {
    const isSelected = selectedCategoryId === category.id;

    return (
      <div key={category.id}>
        <div
          className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-100 ${
            isSelected
              ? "bg-blue-50 font-medium text-blue-900"
              : "text-gray-700"
          }`}
        >
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


