"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import {
  getOfflineCatalogueSnapshot,
  setOfflineCatalogueSnapshot,
} from "~/lib/offline-catalogue";
import { setOfflineSupplierPartsByPart } from "~/lib/offline-supplier-parts";
import { useOnlineStatus } from "~/hooks/use-online-status";
import type { WizardStage } from "./types";

type PreloadedPart = {
  id: string;
  displayName: string;
  description: string | null;
  imageUrl: string | null;
  material: string | null;
  materialId: string | null;
  size: string | null;
  sizeLabel?: string | null;
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
    sizeLabel?: string | null;
  } | null>(null);
  const [hasSizeSelection, setHasSizeSelection] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<{
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
  const [showCustomCategoryInput, setShowCustomCategoryInput] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [wizardSearchQuery, setWizardSearchQuery] = useState("");
  const deferredWizardSearchQuery = useDeferredValue(wizardSearchQuery);
  const [cachedCatalogueData, setCachedCatalogueData] = useState(
    () => getOfflineCatalogueSnapshot()?.data ?? null,
  );

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: serverCatalogs } = api.catalogue.getCatalogs.useQuery(undefined, {
    enabled: isOnline,
  });
  const { data: serverMaterials } = api.catalogue.getMaterials.useQuery(undefined, {
    enabled: isOnline,
  });
  const { data: serverAllUnits } = api.catalogue.getAllUnits.useQuery(undefined, {
    enabled: isOnline,
  });
  const { data: serverCategoryTree } = api.catalogue.getCategoryTree.useQuery(undefined, {
    enabled: isOnline,
  });
  const { data: serverAllParts } = api.catalogue.searchParts.useQuery({}, {
    enabled: isOnline,
    staleTime: 1000 * 60 * 5,
  });
  const serverAllPartIds = useMemo(
    () => serverAllParts?.map((part) => part.id) ?? [],
    [serverAllParts],
  );
  const { data: serverSupplierPartsByPart } = api.supplier.getSupplierPartsByParts.useQuery(
    { partDefinitionIds: serverAllPartIds },
    {
      enabled: isOnline && serverAllPartIds.length > 0,
      staleTime: 1000 * 60 * 5,
    },
  );

  useEffect(() => {
    setCachedCatalogueData(getOfflineCatalogueSnapshot()?.data ?? null);
  }, []);

  useEffect(() => {
    if (!isOnline || !serverCatalogs || !serverMaterials || !serverAllUnits || !serverCategoryTree || !serverAllParts) {
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
  }, [isOnline, serverAllParts, serverAllUnits, serverCatalogs, serverCategoryTree, serverMaterials]);

  useEffect(() => {
    if (!isOnline || !serverSupplierPartsByPart) return;

    for (const [partDefinitionId, supplierParts] of Object.entries(serverSupplierPartsByPart)) {
      setOfflineSupplierPartsByPart(partDefinitionId, supplierParts);
    }
  }, [isOnline, serverSupplierPartsByPart]);

  const catalogs = isOnline ? (serverCatalogs ?? cachedCatalogueData?.catalogs) : cachedCatalogueData?.catalogs;
  const materials = isOnline ? (serverMaterials ?? cachedCatalogueData?.materials) : cachedCatalogueData?.materials;
  const allUnits = isOnline ? (serverAllUnits ?? cachedCatalogueData?.allUnits) : cachedCatalogueData?.allUnits;
  const categoryTree = isOnline ? (serverCategoryTree ?? cachedCatalogueData?.categories) : cachedCatalogueData?.categories;
  const allParts = isOnline ? (serverAllParts ?? cachedCatalogueData?.parts) : cachedCatalogueData?.parts;

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
        const primaryMatch = nominal === selectedSize.nominal && part.sizeUnit === selectedSize.unit;
        if (!primaryMatch) return false;
        if (!selectedSize.sizeLabel) return true;
        return (part.sizeLabel ?? part.size) === selectedSize.sizeLabel;
      }),
    [hasSizeSelection, partsByMaterial, selectedSize],
  );

  const partsByCategory = useMemo(
    () =>
      partsBySize.filter((part) => {
        if (
          !hasCategorySelection ||
          !selectedCategory ||
          selectedCategory.categoryId === null
        ) {
          return true;
        }

        return part.categoryId === selectedCategory.categoryId;
      }),
    [hasCategorySelection, partsBySize, selectedCategory],
  );

  const partDisplayNameMatchesQuery = useCallback((part: PreloadedPart, query: string) => {
    if (!query) return true;
    return part.displayName.toLowerCase().includes(query);
  }, []);

  const catalogsWithCounts = useMemo(() => {
    const query = deferredWizardSearchQuery.trim().toLowerCase();
    const countMap = new Map<string, number>();

    for (const part of allParts ?? []) {
      if (!partDisplayNameMatchesQuery(part, query)) continue;
      countMap.set(part.catalogId, (countMap.get(part.catalogId) ?? 0) + 1);
    }

    return (catalogs ?? [])
      .map((catalog) => ({
        ...catalog,
        count: countMap.get(catalog.id) ?? 0,
      }))
      .filter((catalog) => catalog.count > 0 || selectedCatalogId === catalog.id);
  }, [allParts, catalogs, selectedCatalogId, deferredWizardSearchQuery, partDisplayNameMatchesQuery]);

  const materialCounts = useMemo(() => {
    const query = deferredWizardSearchQuery.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const part of partsByCatalog) {
      if (!partDisplayNameMatchesQuery(part, query)) continue;
      if (part.materialId) {
        counts.set(part.materialId, (counts.get(part.materialId) ?? 0) + 1);
      }
    }
    return counts;
  }, [partsByCatalog, deferredWizardSearchQuery, partDisplayNameMatchesQuery]);

  const materialsWithCounts = useMemo(() => {
    return (materials ?? [])
      .map((mat) => ({
        ...mat,
        count: materialCounts.get(mat.id) ?? 0,
      }))
      .filter((material) => material.count > 0 || selectedMaterialId === material.id);
  }, [materials, materialCounts, selectedMaterialId]);

  const categoriesWithCounts = useMemo(() => {
    const query = deferredWizardSearchQuery.trim().toLowerCase();
    const countMap = new Map<string | null, number>();

    for (const part of partsBySize) {
      if (!partDisplayNameMatchesQuery(part, query)) continue;
      countMap.set(part.categoryId, (countMap.get(part.categoryId) ?? 0) + 1);
    }

    return (categoryTree ?? [])
      .map((category) => ({
        categoryId: category.id,
        name: category.name,
        count: countMap.get(category.id) ?? 0,
      }))
      .filter(
        (category) => category.count > 0 || selectedCategory?.categoryId === category.categoryId,
      );
  }, [categoryTree, partsBySize, selectedCategory, deferredWizardSearchQuery, partDisplayNameMatchesQuery]);

  const filteredAvailableSizes = useMemo(() => {
    const query = deferredWizardSearchQuery.trim().toLowerCase();
    const sizeMap = new Map<
      string,
      {
        nominal: number;
        unit: string;
        count: number;
        subSizes: Array<{ label: string; count: number }>;
        subSizeMap: Map<string, number>;
      }
    >();

    for (const part of partsByMaterial) {
      if (!partDisplayNameMatchesQuery(part, query)) continue;
      const nominal = part.sizeNominal === null ? null : Number(part.sizeNominal);
      if (nominal === null || !part.sizeUnit) {
        continue;
      }

      const key = `${nominal}:${part.sizeUnit}`;
      const current =
        sizeMap.get(key) ??
        {
          nominal,
          unit: part.sizeUnit,
          count: 0,
          subSizes: [],
          subSizeMap: new Map<string, number>(),
        };
      current.count += 1;

      const label = part.sizeLabel ?? part.size;
      if (label) {
        current.subSizeMap.set(label, (current.subSizeMap.get(label) ?? 0) + 1);
      }

      sizeMap.set(key, current);
    }

    return Array.from(sizeMap.values())
      .map((size) => ({
        nominal: size.nominal,
        unit: size.unit,
        count: size.count,
        subSizes: Array.from(size.subSizeMap.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
      }))
      .sort((a, b) => {
        if (a.nominal !== b.nominal) {
          return a.nominal - b.nominal;
        }
        return a.unit.localeCompare(b.unit);
      });
  }, [partsByMaterial, deferredWizardSearchQuery, partDisplayNameMatchesQuery]);

  const filteredPartsForSelection = useMemo(() => {
    const query = deferredWizardSearchQuery.trim().toLowerCase();
    return partsByCategory.filter((part) => partDisplayNameMatchesQuery(part, query));
  }, [partsByCategory, deferredWizardSearchQuery, partDisplayNameMatchesQuery]);

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
        setWizardStage("category");
      }
      void utils.catalogue.getAvailableSizes.invalidate();
    },
  });

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      if (!newCategory) return;
      setSelectedCategory({
        categoryId: newCategory.id,
        name: newCategory.name,
      });
      setHasCategorySelection(true);
      setCustomCategoryName("");
      setShowCustomCategoryInput(false);
      setWizardStage("part");
      void utils.catalogue.getCategories.invalidate();
    },
  });

  const handleCatalogSelect = (catalogId: string | null) => {
    setSelectedCatalogId(catalogId);
    setHasCatalogSelection(true);
    setSelectedMaterialId(null);
    setHasMaterialSelection(false);
    setSelectedSize(null);
    setHasSizeSelection(false);
    setSelectedCategory(null);
    setHasCategorySelection(false);
    setWizardStage("material");
  };

  const handleMaterialSelect = (materialId: string | null) => {
    setSelectedMaterialId(materialId);
    setHasMaterialSelection(true);
    setSelectedSize(null);
    setHasSizeSelection(false);
    setSelectedCategory(null);
    setHasCategorySelection(false);
    setShowCustomSize(false);
    setCustomSizeInput("");
    setWizardStage("size");
  };

  const handleSizeSelect = (size: { nominal: number; unit: string; sizeLabel?: string | null } | null) => {
    setSelectedSize(size);
    setHasSizeSelection(true);
    setSelectedCategory(null);
    setHasCategorySelection(false);
    setShowCustomSize(false);
    setCustomSizeInput("");
    setCustomSizeUnitId(null);
    setWizardStage("category");
  };

  const handleCategorySelection = (category: {
    categoryId: string | null;
    name: string;
  }) => {
    setSelectedCategory({
      categoryId: category.categoryId,
      name: category.name,
    });
    setHasCategorySelection(true);
    setWizardStage("part");
  };

  const handleCustomCategorySubmit = () => {
    if (customCategoryName.trim()) {
      createCategory.mutate({ name: customCategoryName.trim() });
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
      stage === "category" &&
      hasCatalogSelection &&
      hasMaterialSelection &&
      hasSizeSelection
    ) {
      setWizardStage("category");
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

  const resetWizard = useCallback(() => {
    setWizardStage("catalog");
    setSelectedCatalogId(null);
    setHasCatalogSelection(false);
    setSelectedMaterialId(null);
    setHasMaterialSelection(false);
    setSelectedSize(null);
    setHasSizeSelection(false);
    setSelectedCategory(null);
    setHasCategorySelection(false);
    setShowCustomCatalogInput(false);
    setCustomCatalogName("");
    setShowCustomMaterialInput(false);
    setCustomMaterialName("");
    setShowCustomSize(false);
    setCustomSizeInput("");
    setCustomSizeUnitId(null);
    setShowCustomCategoryInput(false);
    setCustomCategoryName("");
    setWizardSearchQuery("");
  }, []);

  useEffect(() => {
    setWizardSearchQuery("");
  }, [wizardStage]);

  useEffect(() => {
    if (deferredWizardSearchQuery.trim()) return;
    if (!allParts) return;

    if (wizardStage === "catalog") {
      if (catalogs === undefined) return;
      if (catalogsWithCounts.length === 0) {
        handleCatalogSelect(null);
      }
      return;
    }

    if (wizardStage === "material" && hasCatalogSelection) {
      if (materials === undefined) return;
      if (materialsWithCounts.length === 0) {
        handleMaterialSelect(null);
      }
      return;
    }

    if (wizardStage === "size" && hasCatalogSelection && hasMaterialSelection) {
      if (filteredAvailableSizes.length === 0) {
        handleSizeSelect(null);
      }
      return;
    }

    if (wizardStage === "category" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection) {
      if (categoryTree === undefined) return;
      if (categoriesWithCounts.length === 0) {
        handleCategorySelection({ categoryId: null, name: "All Categories" });
      }
    }
  }, [
    allParts,
    catalogs,
    catalogsWithCounts.length,
    categoriesWithCounts.length,
    categoryTree,
    deferredWizardSearchQuery,
    filteredAvailableSizes.length,
    hasCatalogSelection,
    hasMaterialSelection,
    hasSizeSelection,
    materials,
    materialsWithCounts.length,
    wizardStage,
  ]);

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
    ? selectedCategory ?? { categoryId: null, name: "All Categories" }
    : null;

  const wizardSearchPlaceholder =
    wizardStage === "review" ? "" : "Search part names...";

  return {
    wizardStage,
    setWizardStage,
    selectedCatalogId,
    hasCatalogSelection,
    selectedMaterialId,
    hasMaterialSelection,
    selectedSize,
    hasSizeSelection,
    selectedCategory,
    hasCategorySelection,
    setSelectedCategory,
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
    showCustomCategoryInput,
    setShowCustomCategoryInput,
    customCategoryName,
    setCustomCategoryName,
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
    handleCategorySelection,
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
