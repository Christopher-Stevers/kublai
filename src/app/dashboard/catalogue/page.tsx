"use client";

import { useState, useMemo, useEffect } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Package, Filter, X } from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import { parseSizeInput } from "~/lib/size-utils";
import { CategoryTree } from "~/components/catalogue/CategoryTree";
import { PartCard } from "~/components/catalogue/PartCard";
import { SearchAndFilters } from "~/components/catalogue/SearchAndFilters";
import { PartsTableView } from "~/components/catalogue/PartsTableView";

export default function CataloguePage() {
  // Filter state
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPartType, setSelectedPartType] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [sizeValue, setSizeValue] = useState<string>(""); // User input: "1/2"
  const [sizeUnit, setSizeUnit] = useState<string>("in");
  const [attributeKey, setAttributeKey] = useState<string | null>(null);
  const [attributeValueMin, setAttributeValueMin] = useState<string>("");
  const [attributeValueMax, setAttributeValueMax] = useState<string>("");
  const [attributeUnit, setAttributeUnit] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [editingPartId, setEditingPartId] = useState<string | null>(null);

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

  // Query to get partTypes with IDs for lookup
  const { data: partTypesWithIds } = api.catalogue.getPartTypesWithIds.useQuery();

  // Look up IDs from names
  const selectedPartTypeId = useMemo(() => {
    if (!selectedPartType || !partTypesWithIds) return undefined;
    const partType = partTypesWithIds.find((pt) => pt.name === selectedPartType);
    return partType?.id;
  }, [selectedPartType, partTypesWithIds]);

  const selectedMaterialId = useMemo(() => {
    if (!selectedMaterial || !materials) return undefined;
    // materials is an array of { id, name }
    const material = materials.find((m) => m.name === selectedMaterial);
    return material?.id;
  }, [selectedMaterial, materials]);

  // Unified search query with all filters
  const { data: searchResults, isLoading: searchLoading } =
    api.catalogue.searchParts.useQuery({
      query: debouncedSearchQuery || undefined,
      categoryId: selectedCategoryId ?? undefined,
      partTypeId: selectedPartTypeId,
      materialId: selectedMaterialId,
      sizeNominal: normalizedSize ?? undefined,
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

  // Fetch supplier information for displayed parts
  const partIds = parts.map((p) => p.id);
  const { data: supplierInfoMap } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds },
    { enabled: partIds.length > 0 },
  );

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
    <div className="relative flex h-[calc(100vh-4rem)]">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg lg:hidden">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-4">
                <span className="font-semibold text-gray-900">Categories</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close sidebar"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {categoriesLoading ? (
                  <div className="p-4">
                    <div className="animate-pulse space-y-2">
                      <div className="h-4 w-3/4 rounded bg-gray-200"></div>
                      <div className="h-4 w-1/2 rounded bg-gray-200"></div>
                      <div className="h-4 w-2/3 rounded bg-gray-200"></div>
                    </div>
                  </div>
                ) : (
                  <CategoryTree
                    categories={categoryTree ?? []}
                    selectedCategoryId={selectedCategoryId}
                    onSelectCategory={(id) => {
                      setSelectedCategoryId(id);
                      setSidebarOpen(false);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Desktop Category Sidebar */}
      <div className="hidden w-64 flex-col overflow-hidden border-r bg-white lg:flex">
        {categoriesLoading ? (
          <div className="p-4">
            <div className="animate-pulse space-y-2">
              <div className="h-4 w-3/4 rounded bg-gray-200"></div>
              <div className="h-4 w-1/2 rounded bg-gray-200"></div>
              <div className="h-4 w-2/3 rounded bg-gray-200"></div>
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
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
              Parts Catalogue
            </h1>
            <Button
              variant="outline"
              size="sm"
              className="h-10 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open categories"
            >
              <Filter className="mr-2 h-4 w-4" />
              Categories
            </Button>
          </div>
          <SearchAndFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categoryTree={categoryTree ?? []}
            selectedCategoryId={selectedCategoryId}
            onCategoryChange={setSelectedCategoryId}
            partTypes={partTypes ?? []}
            selectedPartType={selectedPartType}
            onPartTypeChange={setSelectedPartType}
            materials={materials?.map((m) => (typeof m === "string" ? m : m.name)) ?? []}
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

        <div className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <div className="aspect-square animate-pulse bg-gray-200" />
                  <CardContent className="p-4">
                    <div className="mb-2 h-4 animate-pulse rounded bg-gray-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : parts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-gray-500">
              <Package className="mb-4 h-16 w-16 text-gray-400" />
              <p className="text-lg font-medium">No parts found</p>
              <p className="text-sm">
                {debouncedSearchQuery || hasActiveFilters
                  ? "Try adjusting your search or filters"
                  : "No parts available"}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {parts.length} {parts.length === 1 ? "part" : "parts"} found
                </div>
                <ViewToggle view={viewMode} onViewChange={setViewMode} />
              </div>
              {/* Grid View */}
              {viewMode === "grid" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {parts.map((part) => (
                    <PartCard
                      key={part.id}
                      part={part}
                      onEdit={(partId) => setEditingPartId(partId)}
                      supplierInfo={supplierInfoMap?.[part.id]}
                    />
                  ))}
                </div>
              )}
              {/* Table View */}
              {viewMode === "table" && (
                <Card className="hidden md:block">
                  <CardContent className="p-0">
                    <PartsTableView
                      parts={parts}
                      categoryTree={categoryTree ?? []}
                      onEdit={(partId) => setEditingPartId(partId)}
                      supplierInfoMap={supplierInfoMap}
                    />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit Part Dialog */}
      <EditPartDialog
        open={editingPartId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPartId(null);
        }}
        partId={editingPartId}
      />
    </div>
  );
}
