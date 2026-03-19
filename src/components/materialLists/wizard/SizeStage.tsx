import { parseSizeInput, formatSize } from "~/lib/size-utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { LoopingScrollGrid } from "./LoopingScrollGrid";

export interface SizeStageProps {
  availableSizes?: Array<{ nominal: number; unit: string; count: number }>;
  selectedSize: { nominal: number; unit: string } | null;
  onSizeSelect: (size: { nominal: number; unit: string }) => void;
  showCustomSize: boolean;
  onShowCustomSize: (show: boolean) => void;
  customSizeInput: string;
  onCustomSizeInputChange: (input: string) => void;
  customSizeUnitId: string | null;
  onCustomSizeUnitIdChange: (unitId: string | null) => void;
  allUnits: Array<{ id: string; code: string }>;
  onCreateSize: {
    mutate: (variables: { nominal: number; unitId: string }) => void;
    isPending: boolean;
  };
}

export function SizeStage({
  availableSizes,
  selectedSize,
  onSizeSelect,
  showCustomSize,
  onShowCustomSize,
  customSizeInput,
  onCustomSizeInputChange,
  customSizeUnitId,
  onCustomSizeUnitIdChange,
  allUnits,
  onCreateSize,
}: SizeStageProps) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Size</h3>
      <LoopingScrollGrid
        items={[
          ...(availableSizes ?? []).map((s, i) => ({ type: "size" as const, key: `${s.nominal}_${i}`, ...s })),
          { type: "other" as const, key: "__other__", nominal: 0, unit: "", count: 0 },
        ]}
        getKey={(item) => item.key}
        renderItem={(item) =>
          item.type === "other" ? (
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${
                showCustomSize ? "border-primary border-2 shadow-md" : ""
              }`}
              onClick={() => onShowCustomSize(true)}
            >
              <CardContent className="p-3 text-center sm:p-4">
                <p className="text-sm font-medium sm:text-base">Other</p>
              </CardContent>
            </Card>
          ) : (
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedSize?.nominal === item.nominal && selectedSize?.unit === item.unit
                  ? "border-primary border-2 shadow-md"
                  : ""
              }`}
              onClick={() => onSizeSelect({ nominal: item.nominal, unit: item.unit })}
            >
              <CardContent className="p-3 text-center sm:p-4">
                <p className="text-sm font-medium sm:text-base">
                  {formatSize(item.nominal, item.unit)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {item.count} part{item.count !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>
          )
        }
      />
      {showCustomSize && (
        <div className="mt-3 space-y-2 sm:mt-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-700 sm:text-sm">
                Size (number required)
              </label>
              <Input
                type="text"
                placeholder="Enter size (e.g., 1 ½, 2.5)"
                value={customSizeInput}
                onChange={(e) => onCustomSizeInputChange(e.target.value)}
                className="mt-1 text-sm sm:text-base"
                autoFocus
                disabled={onCreateSize.isPending}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 sm:text-sm">Unit</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="mt-1 w-full justify-between text-xs sm:text-sm"
                    disabled={onCreateSize.isPending}
                  >
                    {customSizeUnitId
                      ? (allUnits.find((u) => u.id === customSizeUnitId)
                          ?.code ?? "Select unit")
                      : "Select unit"}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {allUnits.map((unit) => (
                    <DropdownMenuItem
                      key={unit.id}
                      onClick={() => onCustomSizeUnitIdChange(unit.id)}
                    >
                      {unit.code}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <Button
            onClick={() => {
              const parsed = parseSizeInput(customSizeInput);
              if (parsed !== null && customSizeUnitId) {
                onCreateSize.mutate({
                  nominal: parsed,
                  unitId: customSizeUnitId,
                });
              }
            }}
            disabled={
              !customSizeInput.trim() ||
              !customSizeUnitId ||
              onCreateSize.isPending ||
              parseSizeInput(customSizeInput) === null
            }
            className="w-full text-xs sm:text-sm"
          >
            {onCreateSize.isPending ? "Adding..." : "Add Size"}
          </Button>
        </div>
      )}
    </div>
  );
}
