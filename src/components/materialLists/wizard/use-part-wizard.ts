"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import {
  getOfflineCatalogueSnapshot,
  setOfflineCatalogueSnapshot,
} from "~/lib/offline-catalogue";
import type { WizardStage } from "./types";

type PreloadedPart = {
  id: string;
  displayName: string;
  description: string | null;
  imageUrl: string | null;
  material: string | null;
  materialId: string | null;
  size: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  catalogId: string;
  categoryId: string | null;
  isOrgSpecific: boolean;
};

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
  const [cachedCatalogueData, setCachedCatalogueData] = useState(
    () => getOfflineCatalogueSnapshot()?.data ?? null,
  );

  const utils = api.useUtils();
  const { data: serverCatalogs } = api.catalogue.getCatalogs.useQuery();
  const { data: serverMaterials } = api.catalogue.getMaterials.useQuery();
  const { data: serverAllUnits } = api.catalogue.getAllUnits.useQuery();
  const { data: serverCategoryTree } = api.catalogue.getCategoryTree.useQuery();
  const { data: serverAllParts } = api.catalogue.searchParts.useQuery({}, { staleTime: 1000 * 60 * 5 });

  useEffect(() => {
    setCachedCatalogueData(getOfflineCatalogueSnapshot()?.data ?? null);
  }, []);

  useEffect(() => {
    if (!serverCatalogs || !serverMaterials || !serverAllUnits || !serverCategoryTree || !serverAllParts) {
      return;
    }

    const nextSnapshot = {
      catalogs: serverCatalogs,
      materials: serverMaterials,
      categories: serverCategoryTree,
      allUnits: serverAllUnits,
      parts: serverAllParts,
    };

    setOfflineCatalogueSnapshot(nextSnapshot);
    setCachedCatalogueData(nextSnapshot);
  }, [serverAllParts, serverAllUnits, serverCatalogs, serverCategoryTree, serverMaterials]);

  const catalogs = serverCatalogs ?? cachedCatalogueData?.catalogs;
  const materials = serverMaterials ?? cachedCatalogueData?.materials;
  const allUnits = serverAllUnits ?? cachedCatalogueData?.allUnits;
  const categoryTree = serverCategoryTree ?? cachedCatalogueData?.categories;
  const allParts = serverAllParts ?? cachedCatalogueData?.parts;

  const partsByCatalog = useMemo(
    () =>
      (allParts ?? []).filter((part) =>
        !hasCatalogSelection || selectedCatalogId === null
          ? true
          : part.catalogId === selectedCatalogId,
      ),
    [allParts, hasCatalogSelection, selectedCatalogId],
  );

  const partsByMaterial = useMemo(
    () =>
      partsByCatalog.filter((part) =>
        !hasMaterialSelection || selectedMaterialId === null
          ? true
          : part.materialId === selectedMaterialId,
      ),
    [hasMaterialSelection, partsByCatalog, selectedMaterialId],
  );

  const partsBySize = useMemo(
    () =>
      partsByMaterial.filter((part) => {
        if (!hasSizeSelection || selectedSize === null) {
          return true;
        }

        const nominal = part.sizeNominal === null ? null : Number(part.sizeNominal);
        return nominal === selectedSize.nominal && part.sizeUnit === selectedSize.unit;
      }),
    [hasSizeSelection, partsByMaterial, selectedSize],
  );

  const partsByCategory = useMemo(
    () =>
      partsBySize.filter((part) => {
        if (
          !hasCategorySelection ||
          !selectedPartTypeCategory ||
          selectedPartTypeCategory.categoryId === null
        ) {
          return true;
        }

        return part.categoryId === selectedPartTypeCategory.categoryId;
      }),
    [hasCategorySelection, partsBySize, selectedPartTypeCategory],
  );

  const catalogsWithCounts = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    const countMap = new Map<string, number>();

    for (const part of allParts ?? []) {
      countMap.set(part.catalogId, (countMap.get(part.catalogId) ?? 0) + 1);
    }

    return (catalogs ?? [])
      .filter((catalog) => !query || catalog.name.toLowerCase().includes(query))
      .map((catalog) => ({
        ...catalog,
        count: countMap.get(catalog.id) ?? 0,
      }))
      .filter((catalog) => catalog.count > 0 || selectedCatalogId === catalog.id);
  }, [allParts, catalogs, selectedCatalogId, wizardSearchQuery]);

  const materialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of partsByCatalog) {
      if (part.materialId) {
        counts.set(part.materialId, (counts.get(part.materialId) ?? 0) + 1);
      }
    }
    return counts;
  }, [partsByCatalog]);

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
    const countMap = new Map<string | null, number>();

    for (const part of partsBySize) {
      countMap.set(part.categoryId, (countMap.get(part.categoryId) ?? 0) + 1);
    }

    return (categoryTree ?? [])
      .map((category) => ({
        categoryId: category.id,
        name: category.name,
        count: countMap.get(category.id) ?? 0,
      }))
      .filter((cat) => !query || cat.name.toLowerCase().includes(query))
      .filter(
        (category) => category.count > 0 || selectedPartTypeCategory?.categoryId === category.categoryId,
      );
  }, [categoryTree, partsBySize, selectedPartTypeCategory, wizardSearchQuery]);

  const filteredAvailableSizes = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    const counts = new Map<string, number>();

    for (const part of partsByMaterial) {
      const nominal = part.sizeNominal === null ? null : Number(part.sizeNominal);
      if (nominal === null || !part.sizeUnit) {
        continue;
      }

      const key = `${nominal}:${part.sizeUnit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return partsByMaterial
      .flatMap((part) => {
        const nominal = part.sizeNominal === null ? null : Number(part.sizeNominal);
        if (nominal === null || !part.sizeUnit) {
          return [];
        }

        const key = `${nominal}:${part.sizeUnit}`;
        const count = counts.get(key) ?? 0;
        if (count === 0) {
          return [];
        }
        counts.delete(key);

        return [{ nominal, unit: part.sizeUnit, count }];
      })
      .filter(
        (size) => !query || `${size.nominal} ${size.unit}`.toLowerCase().includes(query),
      )
      .sort((a, b) => {
        if (a.nominal !== b.nominal) {
          return a.nominal - b.nominal;
        }
        return a.unit.localeCompare(b.unit);
      });
  }, [partsByMaterial, wizardSearchQuery]);

  const filteredPartsForSelection = useMemo(() => {
    const query = wizardSearchQuery.trim().toLowerCase();
    return partsByCategory.filter((part) => {
      if (!query) return true;
      return [part.displayName, part.description, part.material, part.size]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }, [partsByCategory, wizardSearchQuery]);

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
