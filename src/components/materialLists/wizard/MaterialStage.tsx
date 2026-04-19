"use client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";

export interface MaterialStageProps {
  materials: Array<{ id: string; name: string; count?: number }>;
  selectedMaterialId: string | null;
  allSelected?: boolean;
  onMaterialSelect: (materialId: string | null) => void;
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
  allSelected = false,
  onMaterialSelect,
  showCustomMaterialInput,
  onShowCustomMaterialInput,
  customMaterialName,
  onCustomMaterialNameChange,
  onCreateMaterial,
}: MaterialStageProps) {
  const pagination = useClientPagination(materials);

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Material</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${
            allSelected ? "border-primary border-2 shadow-md" : ""
          }`}
          onClick={() => onMaterialSelect(null)}
        >
          <CardContent className="p-3 text-center sm:p-4">
            <p className="text-sm font-medium sm:text-base">All</p>
          </CardContent>
        </Card>
        {pagination.paginatedItems.map((material) => (
          <Card
            key={material.id}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedMaterialId === material.id
                ? "border-primary border-2 shadow-md"
                : ""
            }`}
            onClick={() => onMaterialSelect(material.id)}
          >
            <CardContent className="p-3 text-center sm:p-4">
              <p className="text-sm font-medium sm:text-base">{material.name}</p>
              {material.count !== undefined && material.count > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  {material.count} part{material.count !== 1 ? "s" : ""}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
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
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="materials"
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
