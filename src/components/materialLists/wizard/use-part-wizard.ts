"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import type { WizardStage } from "./types";

export function usePartWizard() {
  const [wizardStage, setWizardStage] = useState<WizardStage>("catalog");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [hasCatalogSelection, setHasCatalogSelection] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [hasMaterialSelection, setHasMaterialSelection] = useState(false);
  const [selectedSize, setSelectedSize] = useState<{
    nominal: number;
    unit: string;
  } | null>(null);
  const [hasSizeSelection, setHasSizeSelection] = useState(false);
  const [selectedPartTypeCategory, setSelectedPartTypeCategory] = useState<{
    categoryId: string | null;
    name: string;
  } | null>(null);
  const [hasCategorySelection, setHasCategorySelection] = useState(false);
  const [showCustomCatalogInput, setShowCustomCatalogInput] = useState(false);
  const [customCatalogName, setCustomCatalogName] = useState("");
  const [showCustomMaterialInput, setShowCustomMaterialInput] = useState(false);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [customSizeUnitId, setCustomSizeUnitId] = useState<string | null>(null);
  const [showCustomPartTypeInput, setShowCustomPartTypeInput] = useState(false);
  const [customPartTypeName, setCustomPartTypeName] = useState("");
  const [wizardSearchQuery, setWizardSearchQuery] = useState("");

  const utils = api.useUtils();
  const { data: catalogs } = api.catalogue.getCatalogs.useQuery();
  const { data: materials } = api.catalogue.getMaterials.useQuery();
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();

  const { data: partTypeCategories } = api.catalogue.getPartTypeCategories.useQuery(
    wizardStage === "partTypeCategory" && hasCatalogSelection && hasMaterialSelection
      ? {
          catalogId: selectedCatalogId ?? undefined,
          materialId: selectedMaterialId ?? undefined,
          sizeNominal: selectedSize?.nominal,
          sizeUnit: selectedSize?.unit,
        }
      : undefined,
    {
      enabled:
        wizardStage === "partTypeCategory" && hasCatalogSelection && hasMaterialSelection,
    },
  );

  const { data: partsForSelection } = api.catalogue.searchParts.useQuery(
    {
      catalogId: selectedCatalogId ?? undefined,
      materialId: selectedMaterialId ?? undefined,
      sizeNominal: selectedSize?.nominal,
      sizeUnit: selectedSize?.unit,
      categoryId: selectedPartTypeCategory?.categoryId ?? undefined,
    },
    {
      enabled:
        wizardStage === "part" &&
        hasCatalogSelection &&
        hasMaterialSelection &&
        hasSizeSelection &&
        hasCategorySelection,
    },
  );

  const { data: allPartsForMaterialCount } = api.catalogue.searchParts.useQuery(
    { catalogId: selectedCatalogId ?? undefined },
    { enabled: hasCatalogSelection },
  );

  const { data: availableSizesFromQuery } = api.catalogue.getAvailableSizes.useQuery(
    {
      catalogId: selectedCatalogId ?? undefined,
      materialId: selectedMaterialId ?? undefined,
    },
    { enabled: hasCatalogSelection && hasMaterialSelection },
  );

  const catalogsWithCounts = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (catalogs ?? [])
      .filter((catalog) => !query || catalog.name.toLowerCase().includes(query))
      .map((catalog) => ({
        ...catalog,
        count: catalog.partCount ?? 0,
      }))
      .filter((catalog) => catalog.count > 0 || selectedCatalogId === catalog.id);
  }, [catalogs, selectedCatalogId, wizardSearchQuery]);

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

  const materialsWithCounts = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (materials ?? [])
      .filter((mat) => !query || mat.name.toLowerCase().includes(query))
      .map((mat) => ({
        ...mat,
        count: materialCounts.get(mat.id) ?? 0,
      }))
      .filter((material) => material.count > 0 || selectedMaterialId === material.id);
  }, [materials, materialCounts, selectedMaterialId, wizardSearchQuery]);

  const categoriesWithCounts = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (partTypeCategories ?? [])
      .filter((cat) => !query || cat.name.toLowerCase().includes(query))
      .map((cat) => ({
        categoryId: cat.categoryId,
        name: cat.name,
        count: cat.count ?? 0,
      }))
      .filter(
        (category) => category.count > 0 || selectedPartTypeCategory?.categoryId === category.categoryId,
      );
  }, [partTypeCategories, selectedPartTypeCategory, wizardSearchQuery]);

  const filteredAvailableSizes = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (availableSizesFromQuery ?? [])
      .filter(
        (size) => !query || `${size.nominal} ${size.unit}`.toLowerCase().includes(query),
      )
      .sort((a, b) => {
        if (a.nominal !== b.nominal) {
          return a.nominal - b.nominal;
        }
        return a.unit.localeCompare(b.unit);
      });
  }, [availableSizesFromQuery, wizardSearchQuery]);

  const filteredPartsForSelection = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (partsForSelection ?? []).filter((part) => {
      if (!query) return true;
      return [part.displayName, part.description, part.material, part.size]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }, [partsForSelection, wizardSearchQuery]);

  const createCatalog = api.catalogue.createCatalog.useMutation({
    onSuccess: (newCatalog) => {
      if (!newCatalog) return;
      setSelectedCatalogId(newCatalog.id);
      setHasCatalogSelection(true);
      setCustomCatalogName("");
      setShowCustomCatalogInput(false);
      setWizardStage("material");
      void utils.catalogue.getCatalogs.invalidate();
    },
  });

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (!newMaterial) return;
      setSelectedMaterialId(newMaterial.id);
      setHasMaterialSelection(true);
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
        setSelectedSize({
          nominal: parseFloat(newSize.nominal.toString()),
          unit: unit.code,
        });
        setHasSizeSelection(true);
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
      if (!newCategory) return;
      setSelectedPartTypeCategory({
        categoryId: newCategory.id,
        name: newCategory.name,
      });
      setHasCategorySelection(true);
      setCustomPartTypeName("");
      setShowCustomPartTypeInput(false);
      setWizardStage("part");
      void utils.catalogue.getPartTypeCategories.invalidate();
    },
  });

  const handleCatalogSelect = (catalogId: string | null) => {
    setSelectedCatalogId(catalogId);
    setHasCatalogSelection(true);
    setSelectedMaterialId(null);
    setHasMaterialSelection(false);
    setSelectedSize(null);
    setHasSizeSelection(false);
    setSelectedPartTypeCategory(null);
    setHasCategorySelection(false);
    setWizardStage("material");
  };

  const handleMaterialSelect = (materialId: string | null) => {
    setSelectedMaterialId(materialId);
    setHasMaterialSelection(true);
    setSelectedSize(null);
    setHasSizeSelection(false);
    setSelectedPartTypeCategory(null);
    setHasCategorySelection(false);
    setShowCustomSize(false);
    setCustomSizeInput("");
    setWizardStage("size");
  };

  const handleSizeSelect = (size: { nominal: number; unit: string } | null) => {
    setSelectedSize(size);
    setHasSizeSelection(true);
    setSelectedPartTypeCategory(null);
    setHasCategorySelection(false);
    setShowCustomSize(false);
    setCustomSizeInput("");
    setCustomSizeUnitId(null);
    setWizardStage("partTypeCategory");
  };

  const handlePartTypeCategorySelection = (category: {
    categoryId: string | null;
    name: string;
  }) => {
    setSelectedPartTypeCategory({
      categoryId: category.categoryId,
      name: category.name,
    });
    setHasCategorySelection(true);
    setWizardStage("part");
  };

  const handleCustomCategorySubmit = () => {
    if (customPartTypeName.trim()) {
      createCategory.mutate({ name: customPartTypeName.trim() });
    }
  };

  const handleStageClick = (stage: Exclude<WizardStage, "review">) => {
    if (stage === "catalog") {
      setWizardStage("catalog");
    } else if (stage === "material" && hasCatalogSelection) {
      setWizardStage("material");
    } else if (stage === "size" && hasCatalogSelection && hasMaterialSelection) {
      setWizardStage("size");
    } else if (
      stage === "partTypeCategory" &&
      hasCatalogSelection &&
      hasMaterialSelection &&
      hasSizeSelection
    ) {
      setWizardStage("partTypeCategory");
    } else if (
      stage === "part" &&
      hasCatalogSelection &&
      hasMaterialSelection &&
      hasSizeSelection &&
      hasCategorySelection
    ) {
      setWizardStage("part");
    }
  };

  const resetWizard = () => {
    setWizardStage("catalog");
    setSelectedCatalogId(null);
    setHasCatalogSelection(false);
    setSelectedMaterialId(null);
    setHasMaterialSelection(false);
    setSelectedSize(null);
    setHasSizeSelection(false);
    setSelectedPartTypeCategory(null);
    setHasCategorySelection(false);
    setShowCustomCatalogInput(false);
    setCustomCatalogName("");
    setShowCustomMaterialInput(false);
    setCustomMaterialName("");
    setShowCustomSize(false);
    setCustomSizeInput("");
    setCustomSizeUnitId(null);
    setShowCustomPartTypeInput(false);
    setCustomPartTypeName("");
    setWizardSearchQuery("");
  };

  useEffect(() => {
    setWizardSearchQuery("");
  }, [wizardStage]);

  const selectedCatalogName = hasCatalogSelection
    ? selectedCatalogId
      ? catalogs?.find((catalog) => catalog.id === selectedCatalogId)?.name ?? null
      : "All Catalogs"
    : null;

  const selectedMaterialName = hasMaterialSelection
    ? selectedMaterialId
      ? materials?.find((material) => material.id === selectedMaterialId)?.name ?? null
      : "All Materials"
    : null;

  const selectedSizeName = hasSizeSelection
    ? selectedSize ?? { nominal: 0, unit: "All Sizes" }
    : null;

  const selectedCategoryName = hasCategorySelection
    ? selectedPartTypeCategory ?? { categoryId: null, name: "All Categories" }
    : null;

  const wizardSearchPlaceholder =
    wizardStage === "catalog"
      ? "Search catalogs..."
      : wizardStage === "material"
        ? "Search materials..."
        : wizardStage === "size"
          ? "Search sizes..."
          : wizardStage === "partTypeCategory"
            ? "Search categories..."
            : wizardStage === "part"
              ? "Search parts..."
              : "";

  return {
    wizardStage,
    setWizardStage,
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
    filteredPartsForSelection,
    createCatalog,
    createMaterial,
    createSize,
    handleCatalogSelect,
    handleMaterialSelect,
    handleSizeSelect,
    handlePartTypeCategorySelection,
    handleCustomCategorySubmit,
    handleStageClick,
    resetWizard,
    selectedCatalogName,
    selectedMaterialName,
    selectedSizeName,
    selectedCategoryName,
    wizardSearchPlaceholder,
  };
}
