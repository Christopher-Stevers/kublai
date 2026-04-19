"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import type { WizardStage } from "./types";

export function usePartWizard() {
  const [wizardStage, setWizardStage] = useState<WizardStage>("catalog");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<{
    nominal: number;
    unit: string;
  } | null>(null);
  const [selectedPartTypeCategory, setSelectedPartTypeCategory] = useState<{
    categoryId: string | null;
    name: string;
  } | null>(null);
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
    wizardStage === "partTypeCategory" &&
      selectedCatalogId &&
      selectedMaterialId &&
      selectedSize
      ? {
          catalogId: selectedCatalogId,
          materialId: selectedMaterialId,
          sizeNominal: selectedSize.nominal,
          sizeUnit: selectedSize.unit,
        }
      : undefined,
    {
      enabled: wizardStage === "partTypeCategory",
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
        !!selectedCatalogId &&
        !!selectedMaterialId &&
        !!selectedSize &&
        !!selectedPartTypeCategory,
    },
  );

  const { data: allPartsForMaterialCount } = api.catalogue.searchParts.useQuery(
    { catalogId: selectedCatalogId ?? undefined },
    { enabled: !!selectedCatalogId },
  );

  const { data: availableSizesFromQuery } = api.catalogue.getAvailableSizes.useQuery(
    {
      catalogId: selectedCatalogId ?? undefined,
      materialId: selectedMaterialId ?? undefined,
    },
    { enabled: !!selectedCatalogId && !!selectedMaterialId },
  );

  const catalogsWithCounts = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (catalogs ?? [])
      .filter((catalog) => !query || catalog.name.toLowerCase().includes(query))
      .map((catalog) => ({
        ...catalog,
        count: catalog.partCount ?? 0,
      }));
  }, [catalogs, wizardSearchQuery]);

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
      }));
  }, [materials, materialCounts, wizardSearchQuery]);

  const categoriesWithCounts = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (partTypeCategories ?? [])
      .filter((cat) => !query || cat.name.toLowerCase().includes(query))
      .map((cat) => ({
        categoryId: cat.categoryId,
        name: cat.name,
        count: cat.count ?? 0,
      }));
  }, [partTypeCategories, wizardSearchQuery]);

  const filteredAvailableSizes = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return (availableSizesFromQuery ?? []).filter(
      (size) => !query || `${size.nominal} ${size.unit}`.toLowerCase().includes(query),
    );
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
      setCustomPartTypeName("");
      setShowCustomPartTypeInput(false);
      setWizardStage("part");
      void utils.catalogue.getPartTypeCategories.invalidate();
    },
  });

  const handleCatalogSelect = (catalogId: string) => {
    setSelectedCatalogId(catalogId);
    setSelectedMaterialId(null);
    setSelectedSize(null);
    setSelectedPartTypeCategory(null);
    setWizardStage("material");
  };

  const handleMaterialSelect = (materialId: string) => {
    setSelectedMaterialId(materialId);
    setSelectedSize(null);
    setSelectedPartTypeCategory(null);
    setShowCustomSize(false);
    setCustomSizeInput("");
    setWizardStage("size");
  };

  const handleSizeSelect = (size: { nominal: number; unit: string }) => {
    setSelectedSize(size);
    setSelectedPartTypeCategory(null);
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
    } else if (stage === "material" && selectedCatalogId) {
      setWizardStage("material");
    } else if (stage === "size" && selectedCatalogId && selectedMaterialId) {
      setWizardStage("size");
    } else if (
      stage === "partTypeCategory" &&
      selectedCatalogId &&
      selectedMaterialId &&
      selectedSize
    ) {
      setWizardStage("partTypeCategory");
    } else if (
      stage === "part" &&
      selectedCatalogId &&
      selectedMaterialId &&
      selectedSize &&
      selectedPartTypeCategory
    ) {
      setWizardStage("part");
    }
  };

  const resetWizard = () => {
    setWizardStage("catalog");
    setSelectedCatalogId(null);
    setSelectedMaterialId(null);
    setSelectedSize(null);
    setSelectedPartTypeCategory(null);
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

  const selectedCatalogName =
    catalogs?.find((catalog) => catalog.id === selectedCatalogId)?.name ?? null;
  const selectedMaterialName =
    materials?.find((material) => material.id === selectedMaterialId)?.name ?? null;

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
    selectedMaterialId,
    selectedSize,
    selectedPartTypeCategory,
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
    wizardSearchPlaceholder,
  };
}
