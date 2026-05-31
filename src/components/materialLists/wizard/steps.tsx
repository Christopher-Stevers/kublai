"use client";

import { formatSize, formatSizeAsFraction } from "~/lib/size-utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Plus, X, Minus, ChevronDown } from "lucide-react";
import Image from "next/image";

// Material Step
interface MaterialStepProps {
  materials?: string[];
  selectedMaterial: string | null;
  onMaterialSelect: (material: string) => void;
  showCustomMaterialInput: boolean;
  onShowCustomMaterialInput: (show: boolean) => void;
  customMaterialName: string;
  onCustomMaterialNameChange: (name: string) => void;
  onCreateMaterial: (name: string) => void;
  isCreatingMaterial: boolean;
}

export function MaterialStep({
  materials,
  selectedMaterial,
  onMaterialSelect,
  showCustomMaterialInput,
  onShowCustomMaterialInput,
  customMaterialName,
  onCustomMaterialNameChange,
  onCreateMaterial,
  isCreatingMaterial,
}: MaterialStepProps) {
  void showCustomMaterialInput;
  void onShowCustomMaterialInput;
  void customMaterialName;
  void onCustomMaterialNameChange;
  void onCreateMaterial;
  void isCreatingMaterial;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Select Material</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {materials?.map((material) => (
          <Card
            key={material}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedMaterial === material
                ? "border-primary border-2 shadow-md"
                : ""
            }`}
            onClick={() => onMaterialSelect(material)}
          >
            <CardContent className="p-4 text-center">
              <p className="font-medium">{material}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Size Step
interface SizeStepProps {
  availableSizes: Array<{ nominal: number; unit: string; count: number }>;
  selectedSize: { nominal: number; unit: string } | null;
  onSizeSelect: (size: { nominal: number; unit: string }) => void;
  showCustomSize: boolean;
  onShowCustomSize: (show: boolean) => void;
  customSizeInput: string;
  onCustomSizeInputChange: (input: string) => void;
  customSizeUnitId: string | null;
  onCustomSizeUnitIdChange: (unitId: string | null) => void;
  allUnits?: Array<{ id: string; code: string }>;
  onCreateSize: (nominal: number, unitId: string) => void;
  isCreatingSize: boolean;
}

export function SizeStep({
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
  isCreatingSize,
}: SizeStepProps) {
  void showCustomSize;
  void onShowCustomSize;
  void customSizeInput;
  void onCustomSizeInputChange;
  void customSizeUnitId;
  void onCustomSizeUnitIdChange;
  void allUnits;
  void onCreateSize;
  void isCreatingSize;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Select Size</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {availableSizes.map((size, index) => (
          <Card
            key={`${size.nominal}_${index}`}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedSize?.nominal === size.nominal &&
              selectedSize?.unit === size.unit
                ? "border-primary border-2 shadow-md"
                : ""
            }`}
            onClick={() => onSizeSelect(size)}
          >
            <CardContent className="p-4 text-center">
              <p className="font-medium">
                {formatSize(size.nominal, size.unit)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {size.count} part{size.count !== 1 ? "s" : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Part Type Category Step
interface CategoryStepProps {
  categories?: string[];
  categoryCounts: Map<string, number>;
  selectedCategory: string | null;
  onCategorySelect: (category: string) => void;
  showCustomCategoryInput: boolean;
  onShowCustomCategoryInput: (show: boolean) => void;
  customCategoryName: string;
  onCustomCategoryNameChange: (name: string) => void;
  onCustomCategorySubmit: () => void;
}

export function CategoryStep({
  categories,
  categoryCounts,
  selectedCategory,
  onCategorySelect,
  showCustomCategoryInput,
  onShowCustomCategoryInput,
  customCategoryName,
  onCustomCategoryNameChange,
  onCustomCategorySubmit,
}: CategoryStepProps) {
  void showCustomCategoryInput;
  void onShowCustomCategoryInput;
  void customCategoryName;
  void onCustomCategoryNameChange;
  void onCustomCategorySubmit;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Select Part Category</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {categories?.map((category) => {
          const count = categoryCounts?.get(category) ?? 0;
          return (
            <Card
              key={category}
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedCategory === category
                  ? "border-primary border-2 shadow-md"
                  : ""
              }`}
              onClick={() => onCategorySelect(category)}
            >
              <CardContent className="p-4 text-center">
                <p className="font-medium">{category}</p>
                {count > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {count} part{count !== 1 ? "s" : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Part Step
interface Part {
  id: string;
  displayName: string;
  imageUrl: string | null;
  material: string | null;
  size: string | null;
}

interface PartStepProps {
  partsForSelection?: Part[];
  pendingParts: Array<{ partId: string }>;
  selectedMaterial: string | null;
  selectedSize: { nominal: number; unit: string } | null;
  onPartSelect: (part: Part) => void;
  onAddOneOffPart: () => void;
  onCreateCustomPart: () => void;
  onBackToCategories: () => void;
  onContinueToReview: () => void;
}

export function PartStep({
  partsForSelection,
  pendingParts,
  onPartSelect,
  onCreateCustomPart,
  onBackToCategories,
  onContinueToReview,
}: PartStepProps) {
  if (!partsForSelection || partsForSelection.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">No Parts Found</h3>
        <p className="text-sm text-gray-500">
          No parts found for the selected material, size, and category.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCreateCustomPart}>
            Create Custom Part
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Select Parts</h3>
        <Button variant="outline" size="sm" onClick={onContinueToReview}>
          Review ({pendingParts.length})
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {partsForSelection.map((part) => {
          const isPending = pendingParts.some((p) => p.partId === part.id);
          return (
            <Card
              key={part.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isPending ? "border-primary border-2" : ""
              }`}
              onClick={() => onPartSelect(part)}
            >
              <CardContent className="p-4">
                <div className="flex flex-col gap-2">
                  <div className="relative h-32 w-full overflow-hidden rounded-md bg-gray-100">
                    {part.imageUrl ? (
                      <Image
                        src={part.imageUrl}
                        alt={part.displayName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-gray-400">
                        <svg
                          className="h-8 w-8"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium">{part.displayName}</h4>
                  </div>
                  {isPending && <Badge className="w-fit">Added</Badge>}
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Card
          className="cursor-pointer border-dashed transition-all hover:shadow-md"
          onClick={onCreateCustomPart}
        >
          <CardContent className="flex h-full min-h-[180px] items-center justify-center p-4">
            <div className="text-center">
              <Plus className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-2 text-sm font-medium">Create Custom Part</p>
              <p className="mt-1 text-xs text-gray-500">Add to catalogue</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBackToCategories}>
          Back to Categories
        </Button>
        <Button
          onClick={onContinueToReview}
          disabled={pendingParts.length === 0}
        >
          Continue to Review ({pendingParts.length})
        </Button>
      </div>
    </div>
  );
}

// Review Step
interface PendingPart {
  partId: string;
  partDefinition: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    };
  quantity: number;
  supplierPartId?: string;
}

interface ReviewStepProps {
  pendingParts: PendingPart[];
  supplierPartsData: Map<
    string,
    Array<{
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      isPreferred: boolean;
      supplier: {
        id: string;
        name: string;
      };
    }>
  >;
  onUpdateQuantity: (partId: string, delta: number) => void;
  onSetQuantity: (partId: string, quantity: number) => void;
  onUpdateSupplier: (partId: string, supplierPartId: string) => void;
  onRemovePart: (partId: string) => void;
}

export function ReviewStep({
  pendingParts,
  supplierPartsData,
  onUpdateQuantity,
  onSetQuantity,
  onUpdateSupplier,
  onRemovePart,
}: ReviewStepProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Review Parts</h3>
      <div className="space-y-4">
        {pendingParts.map((pendingPart) => {
          const partsData = supplierPartsData.get(pendingPart.partId) ?? [];
          return (
            <div
              key={pendingPart.partId}
              className="flex items-start gap-4 rounded-lg border p-4"
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                {pendingPart.partDefinition.imageUrl ? (
                  <Image
                    src={pendingPart.partDefinition.imageUrl}
                    alt={pendingPart.partDefinition.displayName}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {pendingPart.partDefinition.displayName}
                    </p>
                    <div className="mt-1 flex gap-1">
                      {pendingPart.partDefinition.material && (
                        <Badge variant="outline" className="text-xs">
                          {pendingPart.partDefinition.material}
                        </Badge>
                      )}
                      {pendingPart.partDefinition.size && (
                        <Badge variant="outline" className="text-xs">
                          {formatSizeAsFraction(pendingPart.partDefinition.size)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <button
                    title="Remove part"
                    onClick={() => onRemovePart(pendingPart.partId)}
                    className="ml-2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600">Quantity:</label>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateQuantity(pendingPart.partId, -1)}
                        className="h-8 w-8 p-0"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={pendingPart.quantity}
                        onChange={(e) =>
                          onSetQuantity(
                            pendingPart.partId,
                            parseInt(e.target.value) || 1,
                          )
                        }
                        className="h-8 w-16 [appearance:textfield] text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpdateQuantity(pendingPart.partId, 1)}
                        className="h-8 w-8 p-0"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {partsData.length > 0 && (
                    <div className="flex-1">
                      <label className="text-sm text-gray-600">Supplier:</label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className="mt-1 h-8 w-full justify-start text-xs"
                          >
                            {partsData.find(
                              (sp) => sp.id === pendingPart.supplierPartId,
                            )?.supplier.name ?? "Select supplier"}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {partsData.map((sp) => (
                            <DropdownMenuItem
                              key={sp.id}
                              onClick={() =>
                                onUpdateSupplier(pendingPart.partId, sp.id)
                              }
                            >
                              {sp.supplier.name}
                              {sp.supplierSku ? ` (${sp.supplierSku})` : ""}
                              {sp.isPreferred && " ⭐"}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
