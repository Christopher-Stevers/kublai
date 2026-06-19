"use client";

import { formatSize } from "~/lib/size-utils";

interface WizardProgressIndicatorProps {
  currentStage:
    | "catalog"
    | "material"
    | "size"
    | "category"
    | "part"
    | "review";
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
    <div className="grid w-full min-w-0 grid-cols-5 items-stretch gap-1 sm:flex sm:flex-wrap sm:gap-2">
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
            className="min-w-0 sm:min-w-[6.75rem] sm:flex-[1_1_6.75rem] lg:min-w-[7.25rem]"
          >
            <button
              onClick={() => {
                if (isClickable) {
                  onStageClick(stage.id);
                }
              }}
              disabled={!isClickable}
              className={`flex min-h-8 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] leading-tight font-medium transition-colors sm:min-h-9 sm:flex-row sm:gap-1.5 sm:px-2.5 sm:text-sm ${
                isCurrent
                  ? "bg-primary text-primary-foreground"
                  : isCompleted
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "bg-gray-100 text-gray-500"
              } ${isClickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] sm:h-5.5 sm:w-5.5 sm:text-sm ${
                  isCurrent
                    ? "bg-primary-foreground text-primary"
                    : isCompleted
                      ? "bg-primary text-primary-foreground"
                      : "bg-gray-300 text-gray-600"
                }`}
              >
                {isCompleted ? "✓" : stage.step}
              </div>
              <span className="[display:-webkit-box] min-w-0 overflow-hidden text-center break-words whitespace-normal [-webkit-box-orient:vertical] [-webkit-line-clamp:1] sm:flex-1 sm:[-webkit-line-clamp:2]">
                {getStageLabel(stage)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
