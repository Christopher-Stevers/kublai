import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { LoopingScrollGrid } from "./LoopingScrollGrid";

export interface MaterialStageProps {
  materials: Array<{ id: string; name: string; count?: number }>;
  selectedMaterialId: string | null;
  onMaterialSelect: (materialId: string) => void;
  showCustomMaterialInput: boolean;
  onShowCustomMaterialInput: (show: boolean) => void;
  customMaterialName: string;
  onCustomMaterialNameChange: (name: string) => void;
  onCreateMaterial: {
    mutate: (variables: { name: string }) => void;
    isPending: boolean;
  };
}

export function MaterialStage({
  materials,
  selectedMaterialId,
  onMaterialSelect,
  showCustomMaterialInput,
  onShowCustomMaterialInput,
  customMaterialName,
  onCustomMaterialNameChange,
  onCreateMaterial,
}: MaterialStageProps) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Material</h3>
      <LoopingScrollGrid
        items={[
          ...materials.map((m) => ({ type: "material" as const, ...m })),
          { type: "other" as const, id: "__other__", name: "Other" },
        ]}
        getKey={(item) => item.id}
        renderItem={(item) =>
          item.type === "other" ? (
            <Card
              className={`cursor-pointer border-dashed transition-all hover:shadow-md ${
                showCustomMaterialInput ? "border-primary border-2" : ""
              }`}
              onClick={() => onShowCustomMaterialInput(true)}
            >
              <CardContent className="p-3 text-center sm:p-4">
                <p className="text-sm font-medium sm:text-base">Other</p>
              </CardContent>
            </Card>
          ) : (
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedMaterialId === item.id ? "border-primary border-2 shadow-md" : ""
              }`}
              onClick={() => onMaterialSelect(item.id)}
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
      {showCustomMaterialInput && (
        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
          <Input
            placeholder="Enter custom material name"
            value={customMaterialName}
            onChange={(e) => onCustomMaterialNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customMaterialName.trim()) {
                onCreateMaterial.mutate({
                  name: customMaterialName.trim(),
                });
              }
            }}
            className="flex-1 text-sm sm:text-base"
            autoFocus
            disabled={onCreateMaterial.isPending}
          />
          <Button
            onClick={() => {
              if (customMaterialName.trim()) {
                onCreateMaterial.mutate({
                  name: customMaterialName.trim(),
                });
              }
            }}
            disabled={!customMaterialName.trim() || onCreateMaterial.isPending}
            className="w-full text-xs sm:w-auto sm:text-sm"
          >
            {onCreateMaterial.isPending ? "Adding..." : "Add Material"}
          </Button>
        </div>
      )}
    </div>
  );
}
