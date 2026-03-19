import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { LoopingScrollGrid } from "./LoopingScrollGrid";

export interface PartTypeCategoryStageProps {
  partTypeCategories: Array<{ categoryId: string; name: string; count?: number }>;
  selectedPartTypeCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  onPartTypeCategorySelect: (category: {
    categoryId: string | null;
    name: string;
  }) => void;
  showCustomPartTypeInput: boolean;
  onShowCustomPartTypeInput: (show: boolean) => void;
  customPartTypeName: string;
  onCustomPartTypeNameChange: (name: string) => void;
  onCustomCategorySubmit: () => void;
}

export function PartTypeCategoryStage({
  partTypeCategories,
  selectedPartTypeCategory,
  onPartTypeCategorySelect,
  showCustomPartTypeInput,
  onShowCustomPartTypeInput,
  customPartTypeName,
  onCustomPartTypeNameChange,
  onCustomCategorySubmit,
}: PartTypeCategoryStageProps) {
	
  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Part Type Category</h3>
      <LoopingScrollGrid
        items={[
          ...partTypeCategories.map((c) => ({ type: "category" as const, ...c })),
          { type: "other" as const, categoryId: "__other__", name: "Other" },
        ]}
        getKey={(item) => item.categoryId}
        renderItem={(item) =>
          item.type === "other" ? (
            <Card
              className={`cursor-pointer border-dashed transition-all hover:shadow-md ${
                showCustomPartTypeInput ? "border-primary border-2" : ""
              }`}
              onClick={() => onShowCustomPartTypeInput(true)}
            >
              <CardContent className="p-3 text-center sm:p-4">
                <p className="text-sm font-medium sm:text-base">Other</p>
              </CardContent>
            </Card>
          ) : (
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedPartTypeCategory?.categoryId === item.categoryId
                  ? "border-primary border-2 shadow-md"
                  : ""
              }`}
              onClick={() => onPartTypeCategorySelect({ categoryId: item.categoryId, name: item.name })}
            >
              <CardContent className="p-3 text-center sm:p-4">
                <p className="text-sm font-medium sm:text-base">{item.name}</p>
                {item.count !== undefined && item.count > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {item.count} part{item.count !== 1 ? "s" : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        }
      />
      {showCustomPartTypeInput && (
        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
          <Input
            placeholder="Enter custom category name"
            value={customPartTypeName}
            onChange={(e) => onCustomPartTypeNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customPartTypeName.trim()) {
                onCustomCategorySubmit();
              }
            }}
            className="flex-1 text-sm sm:text-base"
            autoFocus
          />
          <Button
            onClick={onCustomCategorySubmit}
            disabled={!customPartTypeName.trim()}
            className="w-full text-xs sm:w-auto sm:text-sm"
          >
            Add Category
          </Button>
        </div>
      )}
    </div>
  );
}
