"use client";

import { ChevronRight } from "lucide-react";
import { formatSize } from "~/lib/size-utils";

interface WizardProgressIndicatorProps {
  currentStage: "material" | "size" | "partTypeCategory" | "part" | "review";
  onStageClick?: (
    stage: "material" | "size" | "partTypeCategory" | "part",
  ) => void;
  selectedMaterial?: string | null;
  selectedSize?: { nominal: number; unit: string } | null;
  selectedPartTypeCategory?: string | null;
}

const stages = [
  { id: "material" as const, label: "Material", step: 1 },
  { id: "size" as const, label: "Size", step: 2 },
  { id: "partTypeCategory" as const, label: "Category", step: 3 },
  { id: "part" as const, label: "Part", step: 4 },
];

export function WizardProgressIndicator({
  currentStage,
  onStageClick,
  selectedMaterial,
  selectedSize,
  selectedPartTypeCategory,
}: WizardProgressIndicatorProps) {
  const getCurrentStep = () => {
    switch (currentStage) {
      case "material":
        return 1;
      case "size":
        return 2;
      case "partTypeCategory":
        return 3;
      case "part":
        return 4;
      case "review":
        return 4;
      default:
        return 1;
    }
  };

  const currentStep = getCurrentStep();

  // Get the display label for each stage based on selection
  const getStageLabel = (stage: (typeof stages)[number]) => {
    switch (stage.id) {
      case "material":
        return selectedMaterial ?? stage.label;
      case "size":
        return selectedSize
          ? formatSize(selectedSize.nominal, selectedSize.unit)
          : stage.label;
      case "partTypeCategory":
        return selectedPartTypeCategory ?? stage.label;
      case "part":
        return stage.label;
      default:
        return "";
    }
  };

  return (
    <div className="flex items-center gap-2 py-4">
      {stages.map((stage, index) => {
        const isCompleted = stage.step < currentStep;
        const isCurrent = stage.step === currentStep;
        const isClickable =
          onStageClick &&
          (isCompleted || isCurrent) &&
          currentStage !== "review";

        return (
          <div key={stage.id} className="flex items-center gap-2">
            <button
              onClick={() => {
                if (isClickable) {
                  onStageClick(stage.id);
                }
              }}
              disabled={!isClickable}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isCurrent
                  ? "bg-primary text-primary-foreground"
                  : isCompleted
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "bg-gray-100 text-gray-500"
              } ${isClickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  isCurrent
                    ? "bg-primary-foreground text-primary"
                    : isCompleted
                      ? "bg-primary text-primary-foreground"
                      : "bg-gray-300 text-gray-600"
                }`}
              >
                {isCompleted ? "✓" : stage.step}
              </div>
              <span>{getStageLabel(stage)}</span>
            </button>
            {index < stages.length - 1 && (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )}
          </div>
        );
      })}
    </div>
  );
}
