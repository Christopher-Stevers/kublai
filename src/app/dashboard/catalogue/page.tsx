"use client";

import { useState, useMemo, useEffect } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Package } from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import { CreateCustomPartDialog } from "~/components/materialLists/CreateCustomPartDialog";
import { parseSizeInput } from "~/lib/size-utils";
import { CatalogStage } from "~/components/materialLists/wizard/CatalogStage";
import { MaterialStage } from "~/components/materialLists/wizard/MaterialStage";
import { SizeStage } from "~/components/materialLists/wizard/SizeStage";
import { PartTypeCategoryStage } from "~/components/materialLists/wizard/PartTypeCategoryStage";
import { WizardHeader } from "~/components/materialLists/WizardHeader";
import { usePartWizard } from "~/components/materialLists/wizard/use-part-wizard";
import { PartCard } from "~/components/catalogue/PartCard";
import { SearchAndFilters } from "~/components/catalogue/SearchAndFilters";
import { PartsTableView } from "~/components/catalogue/PartsTableView";
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";

export default function CataloguePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [sizeValue, setSizeValue] = useState<string>("");
  const [sizeUnit, setSizeUnit] = useState<string>("in");
  const [attributeKey, setAttributeKey] = useState<string | null>(null);
  const [attributeValueMin, setAttributeValueMin] = useState<string>("");
  const [attributeValueMax, setAttributeValueMax] = useState<string>("");
  const [attributeUnit, setAttributeUnit] = useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isCreatePartDialogOpen, setIsCreatePartDialogOpen] = useState(false);

  const {
    wizardStage,
    selectedCatalogId,
    hasCatalogSelection,
    selectedMaterialId,
    hasMaterialSelection,
    selectedSize,
    hasSizeSelection,
    selectedPartTypeCategory,
    hasCategorySelection,
    setSelectedPartTypeCategory,
    showCustomCatalogInput,
    setShowCustomCatalogInput,
    customCatalogName,
    setCustomCatalogName,
    showCustomMaterialInput,
    setShowCustomMaterialInput,
    customMaterialName,
    setCustomMaterialName,
    showCustomSize,
    setShowCustomSize,
    customSizeInput,
    setCustomSizeInput,
    customSizeUnitId,
    setCustomSizeUnitId,
    showCustomPartTypeInput,
    setShowCustomPartTypeInput,
    customPartTypeName,
    setCustomPartTypeName,
    wizardSearchQuery,
    setWizardSearchQuery,
    catalogs,
    catalogsWithCounts,
    materials,
    materialsWithCounts,
    allUnits,
    categoriesWithCounts,
    filteredAvailableSizes,
    createCatalog,
    createMaterial,
    createSize,
    handleCatalogSelect,
    handleMaterialSelect,
    handleSizeSelect,
    handlePartTypeCategorySelection,
    handleCustomCategorySubmit,
    handleStageClick,
    selectedCatalogName,
    selectedMaterialName,
    selectedSizeName,
    selectedCategoryName,
    wizardSearchPlaceholder,
  } = usePartWizard();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const normalizedSize = useMemo(() => {
    if (!sizeValue) return undefined;
    return parseSizeInput(sizeValue);
  }, [sizeValue]);

  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery();
  const { data: sizeUnits } = api.catalogue.getSizeUnits.useQuery();
  const { data: attributeKeys } = api.catalogue.getAttributeKeys.useQuery();

  const selectedMaterialFilterId = useMemo(() => {
    if (!selectedMaterial || !materials) return undefined;
    return materials.find((m) => m.name === selectedMaterial)?.id;
  }, [selectedMaterial, materials]);

  const { data: searchResults, isLoading: searchLoading } = api.catalogue.searchParts.useQuery({
    query: debouncedSearchQuery || undefined,
    catalogId: selectedCatalogId ?? undefined,
    categoryId: selectedPartTypeCategory?.categoryId ?? undefined,
    materialId: selectedMaterialFilterId ?? selectedMaterialId ?? undefined,
    sizeNominal: normalizedSize ?? selectedSize?.nominal ?? undefined,
    sizeUnit: normalizedSize ? sizeUnit : selectedSize?.unit,
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
  }, {
    enabled: !!selectedCatalogId && (wizardStage === "part" || wizardStage === "review"),
  });

  const parts = searchResults ?? [];
  const paginatedParts = useClientPagination(parts);
  const partIds = parts.map((p) => p.id);
  const { data: supplierInfoMap } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds },
    { enabled: partIds.length > 0 },
  );

  const hasActiveFilters = !!(selectedMaterial || sizeValue || attributeKey || debouncedSearchQuery);

  const handleClearFilters = () => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setSelectedMaterial(null);
    setSizeValue("");
    setSizeUnit("in");
    setAttributeKey(null);
    setAttributeValueMin("");
    setAttributeValueMax("");
    setAttributeUnit("");
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      <div className="border-b bg-white p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Parts Catalogue</h1>
        </div>
        <WizardHeader
          currentStage={wizardStage}
          selectedCatalog={selectedCatalogName}
          selectedMaterial={selectedMaterialName}
          selectedSize={selectedSizeName}
          selectedPartTypeCategory={selectedCategoryName}
          onStageClick={handleStageClick}
          searchQuery={wizardSearchQuery}
          onSearchChange={setWizardSearchQuery}
          searchPlaceholder={wizardSearchPlaceholder}
          hideSearch={wizardStage === "part"}
          actionLabel="Create Part"
          onActionClick={() => setIsCreatePartDialogOpen(true)}
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">
        {wizardStage === "catalog" && (
          <CatalogStage
            catalogs={catalogsWithCounts}
            selectedCatalogId={selectedCatalogId}
            allSelected={hasCatalogSelection && selectedCatalogId === null}
            onCatalogSelect={(catalogId) => {
              handleCatalogSelect(catalogId);
              handleClearFilters();
            }}
            showCustomCatalogInput={showCustomCatalogInput}
            onShowCustomCatalogInput={setShowCustomCatalogInput}
            customCatalogName={customCatalogName}
            onCustomCatalogNameChange={setCustomCatalogName}
            onCreateCatalog={createCatalog}
          />
        )}

        {wizardStage === "material" && hasCatalogSelection && (
          <MaterialStage
            materials={materialsWithCounts}
            selectedMaterialId={selectedMaterialId}
            allSelected={hasMaterialSelection && selectedMaterialId === null}
            onMaterialSelect={handleMaterialSelect}
            showCustomMaterialInput={showCustomMaterialInput}
            onShowCustomMaterialInput={setShowCustomMaterialInput}
            customMaterialName={customMaterialName}
            onCustomMaterialNameChange={setCustomMaterialName}
            onCreateMaterial={createMaterial}
          />
        )}

        {wizardStage === "size" && hasCatalogSelection && hasMaterialSelection && (
          <SizeStage
            availableSizes={filteredAvailableSizes}
            selectedSize={selectedSize}
            allSelected={hasSizeSelection && selectedSize === null}
            onSizeSelect={handleSizeSelect}
            showCustomSize={showCustomSize}
            onShowCustomSize={setShowCustomSize}
            customSizeInput={customSizeInput}
            onCustomSizeInputChange={setCustomSizeInput}
            customSizeUnitId={customSizeUnitId}
            onCustomSizeUnitIdChange={setCustomSizeUnitId}
            allUnits={(allUnits ?? []).map((u) => ({ id: u.id, code: u.code }))}
            onCreateSize={createSize}
          />
        )}

        {wizardStage === "partTypeCategory" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection && (
          <PartTypeCategoryStage
            partTypeCategories={categoriesWithCounts}
            selectedPartTypeCategory={selectedPartTypeCategory}
            allSelected={hasCategorySelection && selectedPartTypeCategory?.categoryId === null}
            onPartTypeCategorySelect={handlePartTypeCategorySelection}
            showCustomPartTypeInput={showCustomPartTypeInput}
            onShowCustomPartTypeInput={setShowCustomPartTypeInput}
            customPartTypeName={customPartTypeName}
            onCustomPartTypeNameChange={setCustomPartTypeName}
            onCustomCategorySubmit={handleCustomCategorySubmit}
          />
        )}

        {wizardStage === "part" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection && hasCategorySelection && (
          <div className="space-y-4">
            <SearchAndFilters
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              categoryTree={categoryTree ?? []}
              selectedCategoryId={selectedPartTypeCategory?.categoryId ?? null}
              onCategoryChange={(categoryId) => {
                const category = (categoryTree ?? []).find((c) => c.id === categoryId);
                setSelectedPartTypeCategory(category ? { categoryId: category.id, name: category.name } : null);
              }}
              materials={materials?.map((m) => m.name) ?? []}
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
            />

            {searchLoading ? (
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
                  {hasActiveFilters ? "Try adjusting your search or filters" : "No parts available"}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm text-gray-600">{parts.length} {parts.length === 1 ? "part" : "parts"} found</div>
                  <ViewToggle view={viewMode} onViewChange={setViewMode} />
                </div>
                {viewMode === "grid" && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {paginatedParts.paginatedItems.map((part) => (
                      <PartCard key={part.id} part={part} onEdit={(partId) => setEditingPartId(partId)} supplierInfo={supplierInfoMap?.[part.id]} />
                    ))}
                  </div>
                )}
                {viewMode === "table" && (
                  <Card className="hidden md:block">
                    <CardContent className="p-0">
                      <PartsTableView parts={paginatedParts.paginatedItems} categoryTree={categoryTree ?? []} onEdit={(partId) => setEditingPartId(partId)} supplierInfoMap={supplierInfoMap} />
                    </CardContent>
                  </Card>
                )}
                <ListPagination
                  page={paginatedParts.page}
                  totalPages={paginatedParts.totalPages}
                  totalItems={paginatedParts.totalItems}
                  startItem={paginatedParts.startItem}
                  endItem={paginatedParts.endItem}
                  itemLabel="parts"
                  onPageChange={paginatedParts.setPage}
                />
              </>
            )}
          </div>
        )}
      </div>

      <EditPartDialog
        open={editingPartId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPartId(null);
        }}
        partId={editingPartId}
      />
      <CreateCustomPartDialog
        open={isCreatePartDialogOpen}
        onOpenChange={setIsCreatePartDialogOpen}
        onPartCreated={() => {
          setIsCreatePartDialogOpen(false);
        }}
        initialContext={{
          catalogId: selectedCatalogId,
          materialId: selectedMaterialId,
          size: selectedSize,
          categoryId: selectedPartTypeCategory?.categoryId ?? null,
          categoryName: selectedPartTypeCategory?.name ?? null,
        }}
      />
    </div>
  );
}
