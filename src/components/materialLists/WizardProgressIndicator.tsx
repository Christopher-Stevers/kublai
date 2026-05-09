"use client";

import { formatSize } from "~/lib/size-utils";

interface WizardProgressIndicatorProps {
  currentStage: "catalog" | "material" | "size" | "category" | "part" | "review";
  onStageClick?: (
    stage: "catalog" | "material" | "size" | "category" | "part",
  ) => void;
  selectedCatalog?: string | null;
  selectedMaterial?: string | null;
  selectedSize?: { nominal: number; unit: string } | null;
  selectedCategory: {
    categoryId: string | null;
    name: string;
  } | null;
}

const stages = [
  { id: "catalog" as const, label: "Catalog", step: 1 },
  { id: "material" as const, label: "Material", step: 2 },
  { id: "size" as const, label: "Size", step: 3 },
  { id: "category" as const, label: "Category", step: 4 },
  { id: "part" as const, label: "Part", step: 5 },
];

export function WizardProgressIndicator({
  currentStage,
  onStageClick,
  selectedCatalog,
  selectedMaterial,
  selectedSize,
  selectedCategory,
}: WizardProgressIndicatorProps) {
  const getCurrentStep = () => {
    switch (currentStage) {
      case "catalog":
        return 1;
      case "material":
        return 2;
      case "size":
        return 3;
      case "category":
        return 4;
      case "part":
        return 5;
      case "review":
        return 5;
      default:
        return 1;
    }
  };

  const currentStep = getCurrentStep();

  // Get the display label for each stage based on selection
  const getStageLabel = (stage: (typeof stages)[number]) => {
    switch (stage.id) {
      case "catalog":
        return selectedCatalog ?? stage.label;
      case "material":
        return selectedMaterial ?? stage.label;
      case "size":
        return selectedSize
          ? selectedSize.unit === "All Sizes"
            ? "All Sizes"
            : formatSize(selectedSize.nominal, selectedSize.unit)
          : stage.label;
      case "category":
        return selectedCategory?.name ?? stage.label;
      case "part":
        return stage.label;
      default:
        return "";
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1 sm:gap-1.5">
        {stages.map((stage) => {
          const isCompleted = stage.step < currentStep;
          const isCurrent = stage.step === currentStep;
          const isClickable =
            onStageClick &&
            (isCompleted || isCurrent) &&
            currentStage !== "review";

          return (
            <div
              key={stage.id}
              className="flex min-w-max flex-[1_1_auto] items-center gap-1 sm:gap-1.5"
            >
              <button
                onClick={() => {
                  if (isClickable) {
                    onStageClick(stage.id);
                  }
                }}
                disabled={!isClickable}
                className={`flex h-9 w-full min-w-max items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-medium transition-colors sm:gap-1.5 sm:px-2.5 sm:text-sm ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "bg-gray-100 text-gray-500"
                } ${isClickable ? "cursor-pointer" : "cursor-default"}`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs sm:h-5.5 sm:w-5.5 sm:text-sm ${
                    isCurrent
                      ? "bg-primary-foreground text-primary"
                      : isCompleted
                        ? "bg-primary text-primary-foreground"
                        : "bg-gray-300 text-gray-600"
                  }`}
                >
                  {isCompleted ? "✓" : stage.step}
                </div>
                <span className="max-w-[6.5rem] truncate whitespace-nowrap sm:max-w-[8.5rem] md:max-w-none">
                  {getStageLabel(stage)}
                </span>
              </button>
            </div>
          );
        })}
    </div>
  );
}
