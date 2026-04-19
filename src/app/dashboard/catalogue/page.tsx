"use client";

import { useState, useMemo, useEffect } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Package } from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import { parseSizeInput } from "~/lib/size-utils";
import { CatalogStage } from "~/components/materialLists/wizard/CatalogStage";
import { MaterialStage } from "~/components/materialLists/wizard/MaterialStage";
import { SizeStage } from "~/components/materialLists/wizard/SizeStage";
import { PartTypeCategoryStage } from "~/components/materialLists/wizard/PartTypeCategoryStage";
import { WizardProgressIndicator } from "~/components/materialLists/WizardProgressIndicator";
import { PartCard } from "~/components/catalogue/PartCard";
import { SearchAndFilters } from "~/components/catalogue/SearchAndFilters";
import { PartsTableView } from "~/components/catalogue/PartsTableView";
import type { WizardStage } from "~/components/materialLists/wizard/types";

export default function CataloguePage() {
  const [wizardStage, setWizardStage] = useState<WizardStage>("catalog");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<{ nominal: number; unit: string } | null>(null);
  const [selectedPartTypeCategory, setSelectedPartTypeCategory] = useState<{
    categoryId: string | null;
    name: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPartType, setSelectedPartType] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [sizeValue, setSizeValue] = useState<string>("");
  const [sizeUnit, setSizeUnit] = useState<string>("in");
  const [attributeKey, setAttributeKey] = useState<string | null>(null);
  const [attributeValueMin, setAttributeValueMin] = useState<string>("");
  const [attributeValueMax, setAttributeValueMax] = useState<string>("");
  const [attributeUnit, setAttributeUnit] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [showCustomCatalogInput, setShowCustomCatalogInput] = useState(false);
  const [customCatalogName, setCustomCatalogName] = useState("");
  const [showCustomMaterialInput, setShowCustomMaterialInput] = useState(false);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [customSizeUnitId, setCustomSizeUnitId] = useState<string | null>(null);
  const [showCustomPartTypeInput, setShowCustomPartTypeInput] = useState(false);
  const [customPartTypeName, setCustomPartTypeName] = useState("");

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

  const utils = api.useUtils();
  const { data: catalogs } = api.catalogue.getCatalogs.useQuery();
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery();
  const { data: materials } = api.catalogue.getMaterials.useQuery();
  const { data: partTypes } = api.catalogue.getPartTypes.useQuery();
  const { data: sizeUnits } = api.catalogue.getSizeUnits.useQuery();
  const { data: attributeKeys } = api.catalogue.getAttributeKeys.useQuery();
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();
  const { data: partTypesWithIds } = api.catalogue.getPartTypesWithIds.useQuery();

  const selectedPartTypeId = useMemo(() => {
    if (!selectedPartType || !partTypesWithIds) return undefined;
    return partTypesWithIds.find((pt) => pt.name === selectedPartType)?.id;
  }, [selectedPartType, partTypesWithIds]);

  const selectedMaterialFilterId = useMemo(() => {
    if (!selectedMaterial || !materials) return undefined;
    return materials.find((m) => m.name === selectedMaterial)?.id;
  }, [selectedMaterial, materials]);

  const { data: allPartsForMaterialCount } = api.catalogue.searchParts.useQuery(
    { catalogId: selectedCatalogId ?? undefined },
    { enabled: !!selectedCatalogId },
  );

  const materialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (allPartsForMaterialCount) {
      for (const part of allPartsForMaterialCount) {
        if (part.materialId) {
          counts.set(part.materialId, (counts.get(part.materialId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [allPartsForMaterialCount]);

  const materialsWithCounts = useMemo(
    () =>
      (materials ?? []).map((mat) => ({
        ...mat,
        count: materialCounts.get(mat.id) ?? 0,
      })),
    [materials, materialCounts],
  );

  const { data: availableSizes } = api.catalogue.getAvailableSizes.useQuery(
    {
      catalogId: selectedCatalogId ?? undefined,
      materialId: selectedMaterialId ?? undefined,
    },
    { enabled: !!selectedCatalogId && !!selectedMaterialId },
  );

  const { data: partTypeCategories } = api.catalogue.getPartTypeCategories.useQuery(
    wizardStage === "partTypeCategory" && selectedCatalogId && selectedMaterialId && selectedSize
      ? {
          catalogId: selectedCatalogId,
          materialId: selectedMaterialId,
          sizeNominal: selectedSize.nominal,
          sizeUnit: selectedSize.unit,
        }
      : undefined,
    { enabled: wizardStage === "partTypeCategory" },
  );

  const categoriesWithCounts = useMemo(
    () =>
      (partTypeCategories ?? []).map((cat) => ({
        categoryId: cat.categoryId,
        name: cat.name,
        count: cat.count ?? 0,
      })),
    [partTypeCategories],
  );

  const { data: searchResults, isLoading: searchLoading } = api.catalogue.searchParts.useQuery({
    query: debouncedSearchQuery || undefined,
    catalogId: selectedCatalogId ?? undefined,
    categoryId: selectedPartTypeCategory?.categoryId ?? undefined,
    partTypeId: selectedPartTypeId,
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
  const partIds = parts.map((p) => p.id);
  const { data: supplierInfoMap } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds },
    { enabled: partIds.length > 0 },
  );

  const createCatalog = api.catalogue.createCatalog.useMutation({
    onSuccess: (catalog) => {
      if (!catalog) return;
      setSelectedCatalogId(catalog.id);
      setCustomCatalogName("");
      setShowCustomCatalogInput(false);
      setWizardStage("material");
      void utils.catalogue.getCatalogs.invalidate();
    },
  });

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (material) => {
      if (!material) return;
      setSelectedMaterialId(material.id);
      setCustomMaterialName("");
      setShowCustomMaterialInput(false);
      setWizardStage("size");
      void utils.catalogue.getMaterials.invalidate();
    },
  });

  const createSize = api.catalogue.createSize.useMutation({
    onSuccess: (newSize) => {
      if (!newSize) return;
      const unit = allUnits?.find((u) => u.id === newSize.unitId);
      if (unit) {
        setSelectedSize({ nominal: parseFloat(newSize.nominal.toString()), unit: unit.code });
        setCustomSizeInput("");
        setCustomSizeUnitId(null);
        setShowCustomSize(false);
        setWizardStage("partTypeCategory");
      }
      void utils.catalogue.getAvailableSizes.invalidate();
    },
  });

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      setSelectedPartTypeCategory({ categoryId: newCategory.id, name: newCategory.name });
      setCustomPartTypeName("");
      setShowCustomPartTypeInput(false);
      setWizardStage("part");
      void utils.catalogue.getPartTypeCategories.invalidate();
    },
  });

  const selectedCatalogName = catalogs?.find((c) => c.id === selectedCatalogId)?.name ?? null;
  const selectedMaterialName = materials?.find((m) => m.id === selectedMaterialId)?.name ?? null;

  const hasActiveFilters = !!(selectedPartType || selectedMaterial || sizeValue || attributeKey || debouncedSearchQuery);

  const handleClearFilters = () => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
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
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      <div className="border-b bg-white p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Parts Catalogue</h1>
        </div>
        <WizardProgressIndicator
          currentStage={wizardStage}
          selectedCatalog={selectedCatalogName}
          selectedMaterial={selectedMaterialName}
          selectedSize={selectedSize}
          selectedPartTypeCategory={selectedPartTypeCategory}
          onStageClick={(stage) => {
            if (stage === "catalog") setWizardStage("catalog");
            else if (stage === "material" && selectedCatalogId) setWizardStage("material");
            else if (stage === "size" && selectedCatalogId && selectedMaterialId) setWizardStage("size");
            else if (stage === "partTypeCategory" && selectedCatalogId && selectedMaterialId && selectedSize) setWizardStage("partTypeCategory");
            else if (stage === "part" && selectedCatalogId && selectedMaterialId && selectedSize && selectedPartTypeCategory) setWizardStage("part");
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">
        {wizardStage === "catalog" && (
          <CatalogStage
            catalogs={(catalogs ?? []).map((c) => ({ ...c, count: c.partCount ?? 0 }))}
            selectedCatalogId={selectedCatalogId}
            onCatalogSelect={(catalogId) => {
              setSelectedCatalogId(catalogId);
              setSelectedMaterialId(null);
              setSelectedSize(null);
              setSelectedPartTypeCategory(null);
              handleClearFilters();
              setWizardStage("material");
            }}
            showCustomCatalogInput={showCustomCatalogInput}
            onShowCustomCatalogInput={setShowCustomCatalogInput}
            customCatalogName={customCatalogName}
            onCustomCatalogNameChange={setCustomCatalogName}
            onCreateCatalog={createCatalog}
          />
        )}

        {wizardStage === "material" && selectedCatalogId && (
          <MaterialStage
            materials={materialsWithCounts}
            selectedMaterialId={selectedMaterialId}
            onMaterialSelect={(materialId) => {
              setSelectedMaterialId(materialId);
              setSelectedSize(null);
              setSelectedPartTypeCategory(null);
              setWizardStage("size");
            }}
            showCustomMaterialInput={showCustomMaterialInput}
            onShowCustomMaterialInput={setShowCustomMaterialInput}
            customMaterialName={customMaterialName}
            onCustomMaterialNameChange={setCustomMaterialName}
            onCreateMaterial={createMaterial}
          />
        )}

        {wizardStage === "size" && selectedCatalogId && selectedMaterialId && (
          <SizeStage
            availableSizes={availableSizes}
            selectedSize={selectedSize}
            onSizeSelect={(size) => {
              setSelectedSize(size);
              setSelectedPartTypeCategory(null);
              setWizardStage("partTypeCategory");
            }}
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

        {wizardStage === "partTypeCategory" && selectedCatalogId && selectedMaterialId && selectedSize && (
          <PartTypeCategoryStage
            partTypeCategories={categoriesWithCounts}
            selectedPartTypeCategory={selectedPartTypeCategory}
            onPartTypeCategorySelect={(category) => {
              setSelectedPartTypeCategory(category);
              setWizardStage("part");
            }}
            showCustomPartTypeInput={showCustomPartTypeInput}
            onShowCustomPartTypeInput={setShowCustomPartTypeInput}
            customPartTypeName={customPartTypeName}
            onCustomPartTypeNameChange={setCustomPartTypeName}
            onCustomCategorySubmit={() => {
              if (customPartTypeName.trim()) {
                createCategory.mutate({ name: customPartTypeName.trim() });
              }
            }}
          />
        )}

        {wizardStage === "part" && selectedCatalogId && (
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
              partTypes={partTypes ?? []}
              selectedPartType={selectedPartType}
              onPartTypeChange={setSelectedPartType}
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
              showFilters={showFilters}
              onToggleFilters={() => setShowFilters(!showFilters)}
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
                    {parts.map((part) => (
                      <PartCard key={part.id} part={part} onEdit={(partId) => setEditingPartId(partId)} supplierInfo={supplierInfoMap?.[part.id]} />
                    ))}
                  </div>
                )}
                {viewMode === "table" && (
                  <Card className="hidden md:block">
                    <CardContent className="p-0">
                      <PartsTableView parts={parts} categoryTree={categoryTree ?? []} onEdit={(partId) => setEditingPartId(partId)} supplierInfoMap={supplierInfoMap} />
                    </CardContent>
                  </Card>
                )}
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
    </div>
  );
}
