"use client";

import { useState, useMemo, useEffect } from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Package,
  Filter,
} from "lucide-react";
import Image from "next/image";

// Category Tree Component
function CategoryTree({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: {
  categories: Array<{
    id: string;
    name: string;
    children: Array<unknown>;
    partCount?: number;
  }>;
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpanded(newExpanded);
  };

  const renderCategory = (
    category: {
      id: string;
      name: string;
      children: Array<unknown>;
      partCount?: number;
    },
    level = 0,
  ) => {
    const hasChildren = category.children.length > 0;
    const isExpanded = expanded.has(category.id);
    const isSelected = selectedCategoryId === category.id;

    return (
      <div key={category.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-100 cursor-pointer ${
            isSelected ? "bg-blue-50 text-blue-900 font-medium" : "text-gray-700"
          }`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(category.id);
              }}
              className="flex items-center justify-center w-4 h-4"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}
          <button
            onClick={() => onSelectCategory(category.id)}
            className="flex-1 text-left flex items-center justify-between"
          >
            <span>{category.name}</span>
            {category.partCount !== undefined && category.partCount > 0 && (
              <span className="text-xs text-gray-500">
                {category.partCount}
              </span>
            )}
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {category.children.map((child) =>
              renderCategory(child as typeof category, level + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-gray-900">Categories</h2>
      </div>
      <div className="py-2">
        <button
          onClick={() => onSelectCategory(null)}
          className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-100 ${
            selectedCategoryId === null
              ? "bg-blue-50 text-blue-900 font-medium"
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

// Part Card Component
function PartCard({
  part,
}: {
  part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    partType: string | null;
    size: string | null;
  };
}) {
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="aspect-square relative bg-gray-100">
        {part.imageUrl ? (
          <Image
            src={part.imageUrl}
            alt={part.displayName}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="h-12 w-12 text-gray-400" />
          </div>
        )}
      </div>
      <CardContent className="p-4">
        <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">
          {part.displayName}
        </h3>
        <div className="flex flex-wrap gap-2">
          {part.partType && (
            <Badge variant="secondary" className="text-xs">
              {part.partType}
            </Badge>
          )}
          {part.size && (
            <Badge variant="secondary" className="text-xs">
              {part.size}
            </Badge>
          )}
          {part.material && (
            <Badge variant="secondary" className="text-xs">
              {part.material}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Active Filter Badge Component
function FilterBadge({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <Badge
      variant="secondary"
      className="flex items-center gap-1 px-2 py-1 text-xs"
    >
      <span>
        {label}: {value}
      </span>
      <button
        onClick={onRemove}
        className="ml-1 hover:bg-gray-300 rounded-full p-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

// Search and Filters Component
function SearchAndFilters({
  searchQuery,
  onSearchChange,
  categoryTree,
  selectedCategoryId,
  onCategoryChange,
  partTypes,
  selectedPartType,
  onPartTypeChange,
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
  showFilters,
  onToggleFilters,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categoryTree: Array<{ id: string; name: string; children: Array<unknown> }>;
  selectedCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  partTypes: string[];
  selectedPartType: string | null;
  onPartTypeChange: (partType: string | null) => void;
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
  showFilters: boolean;
  onToggleFilters: () => void;
}) {
  // Find category name from tree
  const findCategoryName = (
    tree: Array<{ id: string; name: string; children: Array<unknown> }>,
    id: string | null,
  ): string | null => {
    if (!id) return null;
    for (const cat of tree) {
      if (cat.id === id) return cat.name;
      if (cat.children.length > 0) {
        const found = findCategoryName(
          cat.children as typeof tree,
          id,
        );
        if (found) return found;
      }
    }
    return null;
  };

  const categoryName = findCategoryName(categoryTree, selectedCategoryId);
  const hasActiveFilters =
    selectedCategoryId ||
    selectedPartType ||
    selectedMaterial ||
    sizeValue ||
    attributeKey;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search by name, synonym, size, or material..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant="outline"
          onClick={onToggleFilters}
          className="flex items-center gap-2"
        >
          <Filter className="h-4 w-4" />
          Filters
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" onClick={onClearFilters} size="sm">
            <X className="h-4 w-4" />
            Clear All
          </Button>
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
          {selectedPartType && (
            <FilterBadge
              label="Type"
              value={selectedPartType}
              onRemove={() => onPartTypeChange(null)}
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
      {showFilters && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 border rounded-lg bg-gray-50">
          {/* Part Type Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Part Type
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedPartType || "All Types"}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuItem onClick={() => onPartTypeChange(null)}>
                  All Types
                </DropdownMenuItem>
                {partTypes.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => onPartTypeChange(type)}
                  >
                    {type}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

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
                    <Button variant="outline" className="w-full justify-between">
                      {attributeKey || "Select Attribute"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    <DropdownMenuItem onClick={() => onAttributeKeyChange(null)}>
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
                      onChange={(e) => onAttributeValueMinChange(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="Max"
                      value={attributeValueMax}
                      onChange={(e) => onAttributeValueMaxChange(e.target.value)}
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
      )}
    </div>
  );
}

/**
 * Parse size string to normalized number
 * Handles fractions (1/2 → 0.5), decimals (0.5 → 0.5), and mixed (1 1/2 → 1.5)
 */
function parseSizeInput(input: string): number | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Try parsing as decimal first
  const decimal = parseFloat(trimmed);
  if (!isNaN(decimal) && isFinite(decimal)) {
    // Check if it's a pure decimal (not a fraction that happens to parse)
    if (!trimmed.includes("/")) {
      return decimal;
    }
  }

  // Handle fractions: "1/2", "3/4", etc.
  const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    const numerator = parseFloat(fractionMatch[1] ?? "0");
    const denominator = parseFloat(fractionMatch[2] ?? "1");
    if (denominator !== 0) {
      return numerator / denominator;
    }
  }

  // Handle mixed numbers: "1 1/2", "2 3/4", etc.
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1] ?? "0");
    const numerator = parseFloat(mixedMatch[2] ?? "0");
    const denominator = parseFloat(mixedMatch[3] ?? "1");
    if (denominator !== 0) {
      return whole + numerator / denominator;
    }
  }

  // If all else fails, try parsing as number
  const final = parseFloat(trimmed);
  if (!isNaN(final) && isFinite(final)) {
    return final;
  }

  return null;
}

export default function CataloguePage() {
  // Filter state
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPartType, setSelectedPartType] = useState<string | null>(
    null,
  );
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(
    null,
  );
  const [sizeValue, setSizeValue] = useState<string>(""); // User input: "1/2"
  const [sizeUnit, setSizeUnit] = useState<string>("in");
  const [attributeKey, setAttributeKey] = useState<string | null>(null);
  const [attributeValueMin, setAttributeValueMin] = useState<string>("");
  const [attributeValueMax, setAttributeValueMax] = useState<string>("");
  const [attributeUnit, setAttributeUnit] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Parse size value to normalized number
  const normalizedSize = useMemo(() => {
    if (!sizeValue) return undefined;
    return parseSizeInput(sizeValue);
  }, [sizeValue]);

  // Fetch filter data
  const { data: categoryTree, isLoading: categoriesLoading } =
    api.catalogue.getCategoryTree.useQuery();

  const { data: materials } = api.catalogue.getMaterials.useQuery();
  const { data: partTypes } = api.catalogue.getPartTypes.useQuery();
  const { data: sizeUnits } = api.catalogue.getSizeUnits.useQuery();
  const { data: attributeKeys } = api.catalogue.getAttributeKeys.useQuery();

  // Unified search query with all filters
  const { data: searchResults, isLoading: searchLoading } =
    api.catalogue.searchParts.useQuery({
      query: debouncedSearchQuery || undefined,
      categoryId: selectedCategoryId ?? undefined,
      partType: selectedPartType || undefined,
      material: selectedMaterial || undefined,
      sizeNominal: normalizedSize,
      sizeUnit: normalizedSize ? sizeUnit : undefined,
      attributeKey: attributeKey || undefined,
      attributeValueMin:
        attributeValueMin && attributeValueMin.trim()
          ? parseFloat(attributeValueMin.trim())
          : undefined,
      attributeValueMax:
        attributeValueMax && attributeValueMax.trim()
          ? parseFloat(attributeValueMax.trim())
          : undefined,
      attributeUnit: attributeKey && attributeUnit ? attributeUnit : undefined,
    });

  const parts = searchResults ?? [];
  const isLoading = searchLoading || categoriesLoading;

  const hasActiveFilters =
    selectedCategoryId ||
    selectedPartType ||
    selectedMaterial ||
    sizeValue ||
    attributeKey;

  const handleClearFilters = () => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setSelectedCategoryId(null);
    setSelectedPartType(null);
    setSelectedMaterial(null);
    setSizeValue("");
    setSizeUnit("in");
    setAttributeKey(null);
    setAttributeValueMin("");
    setAttributeValueMax("");
    setAttributeUnit("");
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Category Sidebar */}
      <div className="w-64 border-r bg-white overflow-hidden flex flex-col">
        {categoriesLoading ? (
          <div className="p-4">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          </div>
        ) : (
          <CategoryTree
            categories={categoryTree ?? []}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={(id) => {
              setSelectedCategoryId(id);
            }}
          />
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b bg-white">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Parts Catalogue</h1>
          <SearchAndFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categoryTree={categoryTree ?? []}
            selectedCategoryId={selectedCategoryId}
            onCategoryChange={setSelectedCategoryId}
            partTypes={partTypes ?? []}
            selectedPartType={selectedPartType}
            onPartTypeChange={setSelectedPartType}
            materials={materials ?? []}
            selectedMaterial={selectedMaterial}
            onMaterialChange={setSelectedMaterial}
            sizeValue={sizeValue}
            onSizeValueChange={setSizeValue}
            sizeUnit={sizeUnit}
            onSizeUnitChange={setSizeUnit}
            sizeUnits={sizeUnits ?? []}
            attributeKeys={attributeKeys ?? []}
            attributeKey={attributeKey}
            onAttributeKeyChange={setAttributeKey}
            attributeValueMin={attributeValueMin}
            onAttributeValueMinChange={setAttributeValueMin}
            attributeValueMax={attributeValueMax}
            onAttributeValueMaxChange={setAttributeValueMax}
            attributeUnit={attributeUnit}
            onAttributeUnitChange={setAttributeUnit}
            onClearFilters={handleClearFilters}
            showFilters={showFilters}
            onToggleFilters={() => setShowFilters(!showFilters)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <div className="aspect-square bg-gray-200 animate-pulse" />
                  <CardContent className="p-4">
                    <div className="h-4 bg-gray-200 rounded animate-pulse mb-2" />
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : parts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Package className="h-16 w-16 mb-4 text-gray-400" />
              <p className="text-lg font-medium">No parts found</p>
              <p className="text-sm">
                {debouncedSearchQuery || hasActiveFilters
                  ? "Try adjusting your search or filters"
                  : "No parts available"}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-sm text-gray-600">
                {parts.length} {parts.length === 1 ? "part" : "parts"} found
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {parts.map((part) => (
                  <PartCard key={part.id} part={part} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

