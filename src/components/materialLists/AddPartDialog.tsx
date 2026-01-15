"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import { parseSizeInput, formatSize } from "~/lib/size-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Plus,
  Minus,
  ChevronDown,
} from "lucide-react";
import Image from "next/image";
import { WizardProgressIndicator } from "./WizardProgressIndicator";
import { ValveSelectionDialog } from "./ValveSelectionDialog";
import { CreateCustomPartDialog } from "./CreateCustomPartDialog";
import type { WizardStage, PendingPart } from "./wizard/types";

interface AddPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
}

export function AddPartDialog({
  open,
  onOpenChange,
  materialListId,
}: AddPartDialogProps) {
  // Wizard state
  const [wizardStage, setWizardStage] = useState<WizardStage>("material");
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<{
    nominal: number;
    unit: string;
  } | null>(null);
  const [selectedPartTypeCategory, setSelectedPartTypeCategory] = useState<
    string | null
  >(null);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [isValveDialogOpen, setIsValveDialogOpen] = useState(false);
  const [pendingParts, setPendingParts] = useState<PendingPart[]>([]);
  const [isCreateCustomPartDialogOpen, setIsCreateCustomPartDialogOpen] =
    useState(false);
  const [customPartContext, setCustomPartContext] = useState<{
    material?: string | null;
    size?: { nominal: number; unit: string } | null;
    partType?: string | null;
  } | null>(null);

  const [showCustomMaterialInput, setShowCustomMaterialInput] = useState(false);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [customSizeUnitId, setCustomSizeUnitId] = useState<string | null>(null);
  const [showCustomPartTypeInput, setShowCustomPartTypeInput] = useState(false);
  const [customPartTypeName, setCustomPartTypeName] = useState("");

  // Fetch data
  const { data: materials } = api.catalogue.getMaterials.useQuery();
  const { data: partTypeCategories } =
    api.catalogue.getPartTypeCategories.useQuery();
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery();
  const { data: allPartTypes } = api.catalogue.getPartTypes.useQuery(
    { category: selectedPartTypeCategory ?? undefined },
    { enabled: !!selectedPartTypeCategory },
  );
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();

  // Helper to find parent category ID by name
  const findParentCategoryId = (parentName: string): string | null => {
    if (!categoryTree) return null;

    const findCategory = (
      nodes: Array<{
        id: string;
        name: string;
        children: Array<unknown>;
      }>,
    ): { id: string; name: string; children: Array<unknown> } | null => {
      for (const node of nodes) {
        if (node.name === parentName && node.children.length > 0) {
          return node;
        }
        const found = findCategory(
          node.children as Array<{
            id: string;
            name: string;
            children: Array<unknown>;
          }>,
        );
        if (found) return found;
      }
      return null;
    };

    const parent = findCategory(categoryTree);
    return parent?.id ?? null;
  };

  // Get category ID for selected parent category
  const selectedParentCategoryId = useMemo(() => {
    if (!selectedPartTypeCategory || !categoryTree) return null;
    return findParentCategoryId(selectedPartTypeCategory);
  }, [selectedPartTypeCategory, categoryTree]);

  // Fetch parts matching current material, size, and part type category
  const { data: partsForSelection } = api.catalogue.searchParts.useQuery(
    {
      material: selectedMaterial ?? undefined,
      sizeNominal: selectedSize?.nominal,
      sizeUnit: selectedSize?.unit,
      categoryId: selectedParentCategoryId ?? undefined,
    },
    {
      enabled:
        wizardStage === "part" &&
        !!selectedMaterial &&
        !!selectedSize &&
        !!selectedPartTypeCategory &&
        !!selectedParentCategoryId,
    },
  );

  // Fetch parts for category count (material + size only)
  const { data: partsForCategoryCount } = api.catalogue.searchParts.useQuery(
    {
      material: selectedMaterial ?? undefined,
      sizeNominal: selectedSize?.nominal,
      sizeUnit: selectedSize?.unit,
    },
    {
      enabled:
        wizardStage === "partTypeCategory" &&
        !!selectedMaterial &&
        !!selectedSize,
    },
  );

  // Calculate part counts per category by deriving parent categories from parts
  const categoryCounts = useMemo(() => {
    if (!partsForCategoryCount || !partTypeCategories || !categoryTree)
      return new Map<string, number>();

    // Create a map of category ID to parent category name
    const categoryIdToParentName = new Map<string, string>();
    const categoryIdToName = new Map<string, string>();

    const buildCategoryMaps = (
      nodes: Array<{
        id: string;
        name: string;
        children: Array<unknown>;
      }>,
      parentName: string | null = null,
    ) => {
      for (const node of nodes) {
        categoryIdToName.set(node.id, node.name);
        if (parentName) {
          categoryIdToParentName.set(node.id, parentName);
        }
        buildCategoryMaps(
          node.children as Array<{
            id: string;
            name: string;
            children: Array<unknown>;
          }>,
          node.name,
        );
      }
    };

    buildCategoryMaps(categoryTree);

    const counts = new Map<string, number>();
    partTypeCategories.forEach((parentCategoryName) => {
      // Find all category IDs that belong to this parent
      const categoryIdsForParent = new Set<string>();
      for (const [catId, parentName] of categoryIdToParentName.entries()) {
        if (parentName === parentCategoryName) {
          categoryIdsForParent.add(catId);
        }
      }
      // Also check if the parent category itself exists (root category)
      for (const [catId, catName] of categoryIdToName.entries()) {
        if (catName === parentCategoryName) {
          // Check if it's a root category (no parent)
          if (!categoryIdToParentName.has(catId)) {
            categoryIdsForParent.add(catId);
          }
        }
      }

      // Count parts that have categoryId in this parent's tree
      const count = partsForCategoryCount.filter((p) => {
        if (!p.categoryId) return false;
        return categoryIdsForParent.has(p.categoryId);
      }).length;
      counts.set(parentCategoryName, count);
    });
    return counts;
  }, [partsForCategoryCount, partTypeCategories, categoryTree]);

  // Mutations for creating custom items
  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (newMaterial) {
        setSelectedMaterial(newMaterial.name);
        setCustomMaterialName("");
        setShowCustomMaterialInput(false);
        setWizardStage("size");
        void utils.catalogue.getMaterials.invalidate();
      }
    },
  });

  const createSize = api.catalogue.createSize.useMutation({
    onSuccess: (newSize) => {
      if (newSize) {
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
      }
    },
  });

  // Handler for creating custom category - no mutation needed, just use the string directly
  const handleCustomCategorySubmit = () => {
    if (customPartTypeName.trim()) {
      setSelectedPartTypeCategory(customPartTypeName.trim());
      setCustomPartTypeName("");
      setShowCustomPartTypeInput(false);
      setWizardStage("part");
    }
  };

  // Fetch available sizes (from sizes table and part definitions)
  const { data: availableSizesFromQuery } =
    api.catalogue.getAvailableSizes.useQuery(
      {},
      { enabled: wizardStage === "size" },
    );

  // Fetch parts for size selection (filtered by material) - for counting parts per size
  const { data: partsForSize } = api.catalogue.searchParts.useQuery(
    {
      material: selectedMaterial ?? undefined,
    },
    { enabled: wizardStage === "size" && !!selectedMaterial },
  );

  const utils = api.useUtils();
  const addItem = api.materialList.addItemToMaterialList.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.materialList.getMaterialList.cancel({ materialListId });

      // Snapshot previous value
      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });

      // Try to get part definition from cache or use minimal structure
      // The server will return the full structure, so we use a placeholder
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const unitCost = variables.unitCost ?? null;
      const cost = unitCost ?? 0;
      const extendedPrice = variables.quantity * cost;

      const newItem = {
        id: tempId,
        quantity: variables.quantity.toString(),
        unitCost: unitCost?.toString() ?? null,
        extendedPrice: extendedPrice.toString(),
        descriptionSnapshot: variables.oneOffDisplayName ?? null,
        partDefinition: variables.partDefinitionId
          ? {
              id: variables.partDefinitionId,
              displayName: null,
              imageUrl: null,
              material: null,
            }
          : null,
        oneOff: variables.oneOffDisplayName
          ? {
              displayName: variables.oneOffDisplayName,
              description: variables.oneOffDescription ?? null,
              material: variables.oneOffMaterial ?? null,
              partType: variables.oneOffPartType ?? null,
              sizeNominal: variables.oneOffSizeNominal?.toString() ?? null,
              sizeUnitId: variables.oneOffSizeUnitId ?? null,
            }
          : null,
        supplierPart: variables.supplierPartId
          ? {
              id: variables.supplierPartId,
              supplierId: "",
              supplierSku: null,
              lastKnownUnitCost: unitCost?.toString() ?? null,
              supplier: {
                id: "",
                name: "",
              },
            }
          : null,
        uom: null, // Will be set by server
      };

      // Optimistically add item to material list
      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = [...old.items, newItem];

        // Recalculate material total
        const newMaterialTotal = updatedItems.reduce((sum, item) => {
          const price = item.extendedPrice
            ? parseFloat(item.extendedPrice.toString())
            : 0;
          return sum + price;
        }, 0);

        return {
          ...old,
          items: updatedItems,
          materialTotal: newMaterialTotal,
        };
      });

      return { previousMaterialList };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousMaterialList) {
        utils.materialList.getMaterialList.setData(
          { materialListId },
          context.previousMaterialList,
        );
      }
    },
    onSettled: () => {
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
  });

  // Store supplier parts data
  const [supplierPartsData, setSupplierPartsData] = useState<
    Map<
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
    >
  >(new Map());

  const [fetchingParts, setFetchingParts] = useState<Set<string>>(new Set());
  const supplierPartsDataRef = useRef(supplierPartsData);
  const fetchingPartsRef = useRef(fetchingParts);

  useEffect(() => {
    supplierPartsDataRef.current = supplierPartsData;
  }, [supplierPartsData]);

  useEffect(() => {
    fetchingPartsRef.current = fetchingParts;
  }, [fetchingParts]);

  // Fetch supplier parts for pending parts
  useEffect(() => {
    const pendingPartIds = pendingParts.map((p) => p.partId);

    pendingPartIds.forEach((partId) => {
      if (
        supplierPartsDataRef.current.has(partId) ||
        fetchingPartsRef.current.has(partId)
      ) {
        return;
      }

      setFetchingParts((prev) => {
        const next = new Set(prev);
        next.add(partId);
        return next;
      });

      void utils.supplier.getSupplierPartsByPart
        .fetch({ partDefinitionId: partId })
        .then(
          (
            data: Array<{
              id: string;
              supplierId: string;
              supplierSku: string | null;
              lastKnownUnitCost: string | null;
              isPreferred: boolean;
              supplier: {
                id: string;
                name: string;
              };
            }>,
          ) => {
            setSupplierPartsData((prev) => {
              const next = new Map(prev);
              next.set(partId, data);
              return next;
            });
          },
        )
        .catch((error) => {
          console.error(`Error fetching supplier parts for ${partId}:`, error);
        })
        .finally(() => {
          setFetchingParts((prev) => {
            const next = new Set(prev);
            next.delete(partId);
            return next;
          });
        });
    });

    // Clean up supplier parts data for parts no longer pending
    const currentPartIds = new Set(pendingPartIds);
    setSupplierPartsData((prev) => {
      const next = new Map(prev);
      let hasChanges = false;
      for (const [partId] of next) {
        if (!currentPartIds.has(partId)) {
          next.delete(partId);
          hasChanges = true;
        }
      }
      return hasChanges ? next : prev;
    });
  }, [pendingParts, utils.supplier.getSupplierPartsByPart]);

  // Auto-select preferred supplier when part is added
  useEffect(() => {
    pendingParts.forEach((pendingPart) => {
      if (pendingPart.supplierPartId) return;

      const partsData = supplierPartsData.get(pendingPart.partId);
      if (partsData && partsData.length > 0) {
        const preferred = partsData.find((sp) => sp.isPreferred);
        const supplierPartId = preferred?.id ?? partsData[0]?.id;
        if (supplierPartId) {
          setPendingParts((prev) =>
            prev.map((p) =>
              p.partId === pendingPart.partId ? { ...p, supplierPartId } : p,
            ),
          );
        }
      }
    });
  }, [pendingParts, supplierPartsData]);

  // Group sizes from parts and combine with sizes from query
  const availableSizes = useMemo(() => {
    const sizeMap = new Map<
      string,
      { nominal: number; unit: string; count: number }
    >();

    // Add sizes from sizes table and part definitions (from query)
    if (availableSizesFromQuery) {
      availableSizesFromQuery.forEach((size) => {
        const key = `${size.nominal}_${size.unit}`;
        sizeMap.set(key, {
          nominal: size.nominal,
          unit: size.unit,
          count: 0, // Will be updated from partsForSize
        });
      });
    }

    // Count parts for each size
    if (partsForSize) {
      partsForSize.forEach((part) => {
        if (part.sizeNominal && part.sizeUnit) {
          const key = `${part.sizeNominal}_${part.sizeUnit}`;
          const existing = sizeMap.get(key);
          if (existing) {
            sizeMap.set(key, { ...existing, count: existing.count + 1 });
          } else {
            sizeMap.set(key, {
              nominal: parseFloat(part.sizeNominal),
              unit: part.sizeUnit,
              count: 1,
            });
          }
        }
      });
    }

    return Array.from(sizeMap.values()).sort((a, b) => {
      if (a.unit !== b.unit) {
        return a.unit.localeCompare(b.unit);
      }
      return a.nominal - b.nominal;
    });
  }, [availableSizesFromQuery, partsForSize]);

  // Navigation handlers
  const handleMaterialSelect = (material: string) => {
    setSelectedMaterial(material);
    setWizardStage("size");
    setSelectedSize(null);
    setShowCustomSize(false);
    setCustomSizeInput("");
  };

  const handleSizeSelect = (size: { nominal: number; unit: string }) => {
    setSelectedSize(size);
    setWizardStage("partTypeCategory");
    setShowCustomSize(false);
    setCustomSizeInput("");
    setCustomSizeUnitId(null);
    setSelectedPartTypeCategory(null);
  };

  const handleCustomSizeSubmit = () => {
    const parsed = parseSizeInput(customSizeInput);
    if (parsed !== null && selectedMaterial) {
      // Find the unit from available sizes (default to "in")
      const unit =
        availableSizes.length > 0 ? (availableSizes[0]?.unit ?? "in") : "in";
      handleSizeSelect({ nominal: parsed, unit });
    }
  };

  // Handler for part type category selection
  const handlePartTypeCategorySelection = (category: string) => {
    setSelectedPartTypeCategory(category);
    setWizardStage("part");
  };

  // Handler for individual part selection
  const handlePartSelect = (part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    partType: string | null;
  }) => {
    addToPendingList(part.id, part);
  };

  const handleValveSelected = (partId: string) => {
    // Find "Valves" category ID
    const valvesCategoryId = findParentCategoryId("Valves");
    if (!valvesCategoryId) return;

    // Fetch the part and add to pending
    void utils.catalogue.searchParts
      .fetch({
        material: selectedMaterial ?? undefined,
        sizeNominal: selectedSize?.nominal,
        sizeUnit: selectedSize?.unit,
        categoryId: valvesCategoryId,
      })
      .then((parts) => {
        const part = parts.find((p) => p.id === partId);
        if (part) {
          addToPendingList(partId, {
            id: part.id,
            displayName: part.displayName,
            imageUrl: part.imageUrl,
            material: part.material,
            size: part.size,
            partType: part.partType,
          });
        }
      });
  };

  const addToPendingList = (
    partId: string,
    part: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
      partType: string | null;
    },
  ) => {
    // Check if already in pending list
    if (pendingParts.some((p) => p.partId === partId)) {
      // Increment quantity
      setPendingParts((prev) =>
        prev.map((p) =>
          p.partId === partId ? { ...p, quantity: p.quantity + 1 } : p,
        ),
      );
    } else {
      // Add new part
      setPendingParts((prev) => [
        ...prev,
        {
          partId,
          partDefinition: {
            id: part.id,
            displayName: part.displayName,
            imageUrl: part.imageUrl,
            material: part.material,
            size: part.size,
            partType: part.partType,
          },
          quantity: 1,
        },
      ]);
    }
  };

  const handleCustomPartCreated = (part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    partType: string | null;
  }) => {
    addToPendingList(part.id, part);
    setCustomPartContext(null);
  };

  const handleOpenCustomPartDialog = (context?: {
    material?: string | null;
    size?: { nominal: number; unit: string } | null;
    partType?: string | null;
  }) => {
    setCustomPartContext(context ?? null);
    setIsCreateCustomPartDialogOpen(true);
  };

  const handleUpdateQuantity = (partId: string, delta: number) => {
    setPendingParts((prev) =>
      prev.map((p) => {
        if (p.partId === partId) {
          const newQuantity = Math.max(1, p.quantity + delta);
          return { ...p, quantity: newQuantity };
        }
        return p;
      }),
    );
  };

  const handleSetQuantity = (partId: string, quantity: number) => {
    setPendingParts((prev) =>
      prev.map((p) => {
        if (p.partId === partId) {
          return { ...p, quantity: Math.max(1, quantity) };
        }
        return p;
      }),
    );
  };

  const handleUpdateSupplier = (partId: string, supplierPartId: string) => {
    setPendingParts((prev) =>
      prev.map((p) => {
        if (p.partId === partId) {
          return { ...p, supplierPartId };
        }
        return p;
      }),
    );
  };

  const handleRemovePendingPart = (partId: string) => {
    setPendingParts((prev) => prev.filter((p) => p.partId !== partId));
  };

  const handleContinueAdding = () => {
    setWizardStage("partTypeCategory");
    setSelectedPartTypeCategory(null);
  };

  const handleReviewAndAdd = () => {
    setWizardStage("review");
  };

  const handleAddToMaterialList = async () => {
    if (pendingParts.length === 0) return;

    try {
      await Promise.all(
        pendingParts.map((pendingPart) =>
          addItem.mutateAsync({
            materialListId,
            partDefinitionId: pendingPart.partId,
            quantity: pendingPart.quantity,
            supplierPartId: pendingPart.supplierPartId,
          }),
        ),
      );

      void utils.materialList.getMaterialList.invalidate({ materialListId });
      setPendingParts([]);
      setWizardStage("material");
      setSelectedMaterial(null);
      setSelectedSize(null);
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding parts:", error);
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPendingParts([]);
      setWizardStage("material");
      setSelectedMaterial(null);
      setSelectedSize(null);
      setShowCustomSize(false);
      setCustomSizeInput("");
      setIsValveDialogOpen(false);
    }
  }, [open]);

  // Render stage content
  const renderStageContent = () => {
    switch (wizardStage) {
      case "material":
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
                  onClick={() => handleMaterialSelect(material)}
                >
                  <CardContent className="p-4 text-center">
                    <p className="font-medium">{material}</p>
                  </CardContent>
                </Card>
              ))}
              <Card
                className={`cursor-pointer border-dashed transition-all hover:shadow-md ${
                  showCustomMaterialInput ? "border-primary border-2" : ""
                }`}
                onClick={() => setShowCustomMaterialInput(true)}
              >
                <CardContent className="p-4 text-center">
                  <p className="font-medium">Other</p>
                </CardContent>
              </Card>
            </div>
            {showCustomMaterialInput && (
              <div className="mt-4 flex gap-2">
                <Input
                  placeholder="Enter custom material name"
                  value={customMaterialName}
                  onChange={(e) => setCustomMaterialName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customMaterialName.trim()) {
                      createMaterial.mutate({
                        name: customMaterialName.trim(),
                      });
                    }
                  }}
                  className="flex-1"
                  autoFocus
                  disabled={createMaterial.isPending}
                />
                <Button
                  onClick={() => {
                    if (customMaterialName.trim()) {
                      createMaterial.mutate({
                        name: customMaterialName.trim(),
                      });
                    }
                  }}
                  disabled={
                    !customMaterialName.trim() || createMaterial.isPending
                  }
                >
                  {createMaterial.isPending ? "Adding..." : "Add Material"}
                </Button>
              </div>
            )}
          </div>
        );

      case "size":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Select Size</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {availableSizes.map((size) => (
                <Card
                  key={`${size.nominal}_${size.unit}`}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedSize?.nominal === size.nominal &&
                    selectedSize?.unit === size.unit
                      ? "border-primary border-2 shadow-md"
                      : ""
                  }`}
                  onClick={() => handleSizeSelect(size)}
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
              <Card
                className={`cursor-pointer transition-all hover:shadow-md ${
                  showCustomSize ? "border-primary border-2 shadow-md" : ""
                }`}
                onClick={() => setShowCustomSize(true)}
              >
                <CardContent className="p-4 text-center">
                  <p className="font-medium">Other</p>
                </CardContent>
              </Card>
            </div>
            {showCustomSize && (
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Size (number required)
                    </label>
                    <Input
                      type="text"
                      placeholder="Enter size (e.g., 1 ½, 2.5)"
                      value={customSizeInput}
                      onChange={(e) => setCustomSizeInput(e.target.value)}
                      className="mt-1"
                      autoFocus
                      disabled={createSize.isPending}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Unit
                    </label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="mt-1 w-full justify-between"
                          disabled={createSize.isPending}
                        >
                          {customSizeUnitId
                            ? (allUnits?.find((u) => u.id === customSizeUnitId)
                                ?.code ?? "Select unit")
                            : "Select unit"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {allUnits?.map((unit) => (
                          <DropdownMenuItem
                            key={unit.id}
                            onClick={() => setCustomSizeUnitId(unit.id)}
                          >
                            {unit.code}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    const parsed = parseSizeInput(customSizeInput);
                    if (parsed !== null && customSizeUnitId) {
                      createSize.mutate({
                        nominal: parsed,
                        unitId: customSizeUnitId,
                      });
                    }
                  }}
                  disabled={
                    !customSizeInput.trim() ||
                    !customSizeUnitId ||
                    createSize.isPending ||
                    parseSizeInput(customSizeInput) === null
                  }
                  className="w-full"
                >
                  {createSize.isPending ? "Adding..." : "Add Size"}
                </Button>
              </div>
            )}
          </div>
        );

      case "partTypeCategory":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Select Part Type Category</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {partTypeCategories?.map((category) => {
                const count = categoryCounts.get(category) ?? 0;
                return (
                  <Card
                    key={category}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedPartTypeCategory === category
                        ? "border-primary border-2 shadow-md"
                        : ""
                    }`}
                    onClick={() => handlePartTypeCategorySelection(category)}
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
              <Card
                className={`cursor-pointer border-dashed transition-all hover:shadow-md ${
                  showCustomPartTypeInput ? "border-primary border-2" : ""
                }`}
                onClick={() => setShowCustomPartTypeInput(true)}
              >
                <CardContent className="p-4 text-center">
                  <p className="font-medium">Other</p>
                </CardContent>
              </Card>
            </div>
            {showCustomPartTypeInput && (
              <div className="mt-4 flex gap-2">
                <Input
                  placeholder="Enter custom category name"
                  value={customPartTypeName}
                  onChange={(e) => setCustomPartTypeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customPartTypeName.trim()) {
                      handleCustomCategorySubmit();
                    }
                  }}
                  className="flex-1"
                  autoFocus
                />
                <Button
                  onClick={handleCustomCategorySubmit}
                  disabled={!customPartTypeName.trim()}
                >
                  Add Category
                </Button>
              </div>
            )}
          </div>
        );

      case "part":
        if (!partsForSelection || partsForSelection.length === 0) {
          return (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">No Parts Found</h3>
              <p className="text-sm text-gray-500">
                No parts found for the selected material, size, and category.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    handleOpenCustomPartDialog({
                      material: selectedMaterial,
                      size: selectedSize,
                      partType: null,
                    })
                  }
                >
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWizardStage("review")}
              >
                Review ({pendingParts.length})
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {partsForSelection.map((part) => {
                const isPending = pendingParts.some(
                  (p) => p.partId === part.id,
                );
                return (
                  <Card
                    key={part.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      isPending ? "border-primary border-2" : ""
                    }`}
                    onClick={() => handlePartSelect(part)}
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
                          <h4 className="text-sm font-medium">
                            {part.displayName}
                          </h4>
                          {part.partType && (
                            <Badge variant="outline" className="mt-1 text-xs">
                              {part.partType}
                            </Badge>
                          )}
                        </div>
                        {isPending && <Badge className="w-fit">Added</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              <Card className="cursor-pointer border-dashed transition-all hover:shadow-md">
                <CardContent className="flex h-full min-h-[180px] items-center justify-center p-4">
                  <div className="text-center">
                    <Plus className="mx-auto h-8 w-8 text-gray-400" />
                    <p className="mt-2 text-sm font-medium">Add One-off Part</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Temporary part (not saved to catalogue)
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer border-dashed transition-all hover:shadow-md"
                onClick={() =>
                  handleOpenCustomPartDialog({
                    material: selectedMaterial,
                    size: selectedSize,
                    partType: null,
                  })
                }
              >
                <CardContent className="flex h-full min-h-[180px] items-center justify-center p-4">
                  <div className="text-center">
                    <Plus className="mx-auto h-8 w-8 text-gray-400" />
                    <p className="mt-2 text-sm font-medium">
                      Create Custom Part
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Add to catalogue
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedPartTypeCategory(null);
                  setWizardStage("partTypeCategory");
                }}
              >
                Back to Categories
              </Button>
              <Button
                onClick={() => setWizardStage("review")}
                disabled={pendingParts.length === 0}
              >
                Continue to Review ({pendingParts.length})
              </Button>
            </div>
          </div>
        );

      case "review":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Review Parts</h3>
            <div className="space-y-4">
              {pendingParts.map((pendingPart) => {
                const partsData =
                  supplierPartsData.get(pendingPart.partId) ?? [];
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
                                {pendingPart.partDefinition.size}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <button
                          title="Remove part"
                          onClick={() =>
                            handleRemovePendingPart(pendingPart.partId)
                          }
                          className="ml-2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">
                            Quantity:
                          </label>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleUpdateQuantity(pendingPart.partId, -1)
                              }
                              className="h-8 w-8 p-0"
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              type="number"
                              min="1"
                              value={pendingPart.quantity}
                              onChange={(e) =>
                                handleSetQuantity(
                                  pendingPart.partId,
                                  parseInt(e.target.value) || 1,
                                )
                              }
                              className="h-8 w-16 [appearance:textfield] text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleUpdateQuantity(pendingPart.partId, 1)
                              }
                              className="h-8 w-8 p-0"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {partsData.length > 0 && (
                          <div className="flex-1">
                            <label className="text-sm text-gray-600">
                              Supplier:
                            </label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="mt-1 h-8 w-full justify-start text-xs"
                                >
                                  {partsData.find(
                                    (sp) =>
                                      sp.id === pendingPart.supplierPartId,
                                  )?.supplier.name ?? "Select supplier"}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {partsData.map((sp) => (
                                  <DropdownMenuItem
                                    key={sp.id}
                                    onClick={() =>
                                      handleUpdateSupplier(
                                        pendingPart.partId,
                                        sp.id,
                                      )
                                    }
                                  >
                                    {sp.supplier.name}
                                    {sp.supplierSku
                                      ? ` (${sp.supplierSku})`
                                      : ""}
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

      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col p-0 sm:w-full">
          <DialogHeader className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
            <DialogTitle className="text-lg sm:text-xl">Add Parts</DialogTitle>
            <DialogDescription className="text-sm">
              Select material, size, and part type to add parts to your list
            </DialogDescription>
          </DialogHeader>

          <div className="shrink-0 border-b px-4 sm:px-6">
            <WizardProgressIndicator
              currentStage={wizardStage}
              selectedMaterial={selectedMaterial}
              selectedSize={selectedSize}
              selectedPartTypeCategory={selectedPartTypeCategory}
              onStageClick={(stage) => {
                if (stage === "material") {
                  setWizardStage("material");
                } else if (stage === "size" && selectedMaterial) {
                  setWizardStage("size");
                } else if (
                  stage === "partTypeCategory" &&
                  selectedMaterial &&
                  selectedSize
                ) {
                  setWizardStage("partTypeCategory");
                } else if (
                  stage === "part" &&
                  selectedMaterial &&
                  selectedSize &&
                  selectedPartTypeCategory
                ) {
                  setWizardStage("part");
                }
              }}
            />
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-4 sm:px-6">
            {renderStageContent()}
          </div>

          {/* Pending Parts Sidebar */}
          {pendingParts.length > 0 && wizardStage !== "review" && (
            <div className="shrink-0 border-t bg-gray-50 px-4 py-4 sm:px-6">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-semibold">
                  Pending Parts ({pendingParts.length})
                </h4>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleContinueAdding}
                  >
                    Continue Adding
                  </Button>
                  <Button size="sm" onClick={handleReviewAndAdd}>
                    Review & Add
                  </Button>
                </div>
              </div>
              <div className="max-h-32 space-y-2 overflow-y-auto">
                {pendingParts.map((pendingPart) => (
                  <div
                    key={pendingPart.partId}
                    className="flex items-center gap-2 rounded border bg-white p-2 text-sm"
                  >
                    <div className="flex-1 truncate">
                      {pendingPart.partDefinition.displayName}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleUpdateQuantity(pendingPart.partId, -1)
                        }
                        className="h-6 w-6 p-0"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={pendingPart.quantity}
                        onChange={(e) =>
                          handleSetQuantity(
                            pendingPart.partId,
                            parseInt(e.target.value) || 1,
                          )
                        }
                        className="h-6 w-12 [appearance:textfield] text-center text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleUpdateQuantity(pendingPart.partId, 1)
                        }
                        className="h-6 w-6 p-0"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 border-t px-4 py-4 sm:px-6">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  if (wizardStage === "size") {
                    setWizardStage("material");
                  } else if (wizardStage === "partTypeCategory") {
                    setWizardStage("size");
                  } else if (wizardStage === "part") {
                    setWizardStage("partTypeCategory");
                  } else if (wizardStage === "review") {
                    setWizardStage("part");
                  } else {
                    onOpenChange(false);
                  }
                }}
                disabled={wizardStage === "material"}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                {wizardStage === "review" && (
                  <Button
                    onClick={handleAddToMaterialList}
                    disabled={pendingParts.length === 0 || addItem.isPending}
                  >
                    {addItem.isPending
                      ? "Adding..."
                      : `Add ${pendingParts.length} Part${pendingParts.length !== 1 ? "s" : ""}`}
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ValveSelectionDialog
        open={isValveDialogOpen}
        onOpenChange={setIsValveDialogOpen}
        material={selectedMaterial ?? ""}
        size={selectedSize ?? { nominal: 0, unit: "in" }}
        onValveSelected={handleValveSelected}
      />

      <CreateCustomPartDialog
        open={isCreateCustomPartDialogOpen}
        onOpenChange={setIsCreateCustomPartDialogOpen}
        onPartCreated={handleCustomPartCreated}
        initialContext={customPartContext ?? undefined}
      />
    </>
  );
}
