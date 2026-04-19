"use client";

import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDown, Search, X } from "lucide-react";
import { FilterBadge } from "./FilterBadge";

interface SearchAndFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categoryTree: Array<{ id: string; name: string }>;
  selectedCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  materials: string[];
  selectedMaterial: string | null;
  onMaterialChange: (material: string | null) => void;
  sizeValue: string;
  onSizeValueChange: (value: string) => void;
  sizeUnit: string;
  onSizeUnitChange: (unit: string) => void;
  sizeUnits: Array<{ code: string; displayName: string }>;
  attributeKeys: string[];
  attributeKey: string | null;
  onAttributeKeyChange: (key: string | null) => void;
  attributeValueMin: string;
  onAttributeValueMinChange: (value: string) => void;
  attributeValueMax: string;
  onAttributeValueMaxChange: (value: string) => void;
  attributeUnit: string;
  onAttributeUnitChange: (unit: string) => void;
  onClearFilters: () => void;
}

export function SearchAndFilters({
  searchQuery,
  onSearchChange,
  categoryTree,
  selectedCategoryId,
  onCategoryChange,
  materials,
  selectedMaterial,
  onMaterialChange,
  sizeValue,
  onSizeValueChange,
  sizeUnit,
  onSizeUnitChange,
  sizeUnits,
  attributeKeys,
  attributeKey,
  onAttributeKeyChange,
  attributeValueMin,
  onAttributeValueMinChange,
  attributeValueMax,
  onAttributeValueMaxChange,
  attributeUnit,
  onAttributeUnitChange,
  onClearFilters,
}: SearchAndFiltersProps) {
  // Find category name from flat list
  const findCategoryName = (
    tree: Array<{ id: string; name: string }>,
    id: string | null,
  ): string | null => {
    if (!id) return null;
    const cat = tree.find((c) => c.id === id);
    return cat?.name ?? null;
  };

  const categoryName = findCategoryName(categoryTree, selectedCategoryId);
  const hasActiveFilters =
    selectedCategoryId ||
    selectedMaterial ||
    sizeValue ||
    attributeKey;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
          <Input
            type="text"
            placeholder="Search by name, synonym, size, or material..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 pl-10"
          />
        </div>
        {hasActiveFilters && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onClearFilters}
              size="sm"
              className="h-11"
            >
              <X className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Clear All</span>
            </Button>
          </div>
        )}
      </div>

      {/* Active Filter Badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2">
          {categoryName && (
            <FilterBadge
              label="Category"
              value={categoryName}
              onRemove={() => onCategoryChange(null)}
            />
          )}
          {selectedMaterial && (
            <FilterBadge
              label="Material"
              value={selectedMaterial}
              onRemove={() => onMaterialChange(null)}
            />
          )}
          {sizeValue && (
            <FilterBadge
              label="Size"
              value={`${sizeValue} ${sizeUnit}`}
              onRemove={() => {
                onSizeValueChange("");
                onSizeUnitChange("in");
              }}
            />
          )}
          {attributeKey && (
            <FilterBadge
              label={attributeKey}
              value={
                attributeValueMin || attributeValueMax
                  ? `${attributeValueMin || "0"}-${attributeValueMax || "∞"} ${attributeUnit || ""}`
                  : attributeKey
              }
              onRemove={() => {
                onAttributeKeyChange(null);
                onAttributeValueMinChange("");
                onAttributeValueMaxChange("");
                onAttributeUnitChange("");
              }}
            />
          )}
        </div>
      )}

      {/* Filter Controls */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border bg-gray-50 p-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Material Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Material
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedMaterial || "All Materials"}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuItem onClick={() => onMaterialChange(null)}>
                  All Materials
                </DropdownMenuItem>
                {materials.map((material) => (
                  <DropdownMenuItem
                    key={material}
                    onClick={() => onMaterialChange(material)}
                  >
                    {material}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Size Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Size</label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="1/2 or 0.5"
                value={sizeValue}
                onChange={(e) => onSizeValueChange(e.target.value)}
                className="flex-1"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-20">
                    {sizeUnit}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {sizeUnits.map((unit) => (
                    <DropdownMenuItem
                      key={unit.code}
                      onClick={() => onSizeUnitChange(unit.code)}
                    >
                      {unit.displayName}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Attribute Filter */}
          {attributeKeys.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Attribute
              </label>
              <div className="space-y-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                    >
                      {attributeKey || "Select Attribute"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    <DropdownMenuItem
                      onClick={() => onAttributeKeyChange(null)}
                    >
                      None
                    </DropdownMenuItem>
                    {attributeKeys.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => onAttributeKeyChange(key)}
                      >
                        {key}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {attributeKey && (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      value={attributeValueMin}
                      onChange={(e) =>
                        onAttributeValueMinChange(e.target.value)
                      }
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="Max"
                      value={attributeValueMax}
                      onChange={(e) =>
                        onAttributeValueMaxChange(e.target.value)
                      }
                      className="flex-1"
                    />
                    <Input
                      type="text"
                      placeholder="Unit"
                      value={attributeUnit}
                      onChange={(e) => onAttributeUnitChange(e.target.value)}
                      className="w-20"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
