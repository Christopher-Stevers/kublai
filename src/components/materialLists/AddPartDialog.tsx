"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { api } from "~/trpc/react";
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
import { ChevronLeft, Plus, Minus } from "lucide-react";
import { WizardProgressIndicator } from "./WizardProgressIndicator";
import { CreateCustomPartDialog } from "./CreateCustomPartDialog";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import type { WizardStage, PendingPart } from "./wizard/types";
import { MaterialStage } from "./wizard/MaterialStage";
import { SizeStage } from "./wizard/SizeStage";
import { PartTypeCategoryStage } from "./wizard/PartTypeCategoryStage";
import { PartStage } from "./wizard/PartStage";
import { ReviewStage } from "./wizard/ReviewStage";

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
  const [pendingSectionOpen, setPendingSectionOpen] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(
    null,
  );
  const [selectedSize, setSelectedSize] = useState<{
    nominal: number;
    unit: string;
  } | null>(null);
  const [selectedPartTypeCategory, setSelectedPartTypeCategory] = useState<{
    categoryId: string | null;
    name: string;
  } | null>(null);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [pendingParts, setPendingParts] = useState<PendingPart[]>([]);
  const [isCreateCustomPartDialogOpen, setIsCreateCustomPartDialogOpen] =
    useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [customPartContext, setCustomPartContext] = useState<{
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    partTypeId?: string | null;
    categoryName?: string | null;
  } | null>(null);

  const [showCustomMaterialInput, setShowCustomMaterialInput] = useState(false);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [customSizeUnitId, setCustomSizeUnitId] = useState<string | null>(null);
  const [showCustomPartTypeInput, setShowCustomPartTypeInput] = useState(false);
  const [customPartTypeName, setCustomPartTypeName] = useState("");

  // Fetch data
  const { data: materials } = api.catalogue.getMaterials.useQuery();
  
  // Fetch categories with filtered counts when on category stage
  const { data: partTypeCategories } =
    api.catalogue.getPartTypeCategories.useQuery(
      wizardStage === "partTypeCategory" && selectedMaterialId && selectedSize
        ? {
            materialId: selectedMaterialId,
            sizeNominal: selectedSize.nominal,
            sizeUnit: selectedSize.unit,
          }
        : undefined,
      {
        enabled: wizardStage === "partTypeCategory",
      },
    );
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery();
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();

  // Helper to find parent category ID by name
  const findParentCategoryId = (parentName: string): string | null => {
    if (!categoryTree) return null;

    // Categories are now flat, so just find by name
    const parent = categoryTree?.find((cat) => cat.name === parentName) ?? null;
    return parent?.id ?? null;
  };

  // Get category ID for selected parent category

  console.log("Search parts", {
    selectedMaterialId,
    selectedSize,
  });
  // Fetch parts matching current material, size, and part type category
  const { data: partsForSelection } = api.catalogue.searchParts.useQuery(
    {
      materialId: selectedMaterialId ?? undefined,
      sizeNominal: selectedSize?.nominal,
      sizeUnit: selectedSize?.unit,
      categoryId: selectedPartTypeCategory?.categoryId ?? undefined,
    },
    {
      enabled:
        wizardStage === "part" &&
        !!selectedMaterialId &&
        !!selectedSize &&
        !!selectedPartTypeCategory,
    },
  );

  // Fetch all parts (no filters) when on material stage - for counting parts per material
  const { data: allPartsForMaterialCount } = api.catalogue.searchParts.useQuery(
    {},
    { enabled: wizardStage === "material" },
  );

  // Calculate counts per material from all parts (no filters)
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

  // Merge materials with counts
  const materialsWithCounts = useMemo(() => {
    return (materials ?? []).map((mat) => ({
      ...mat,
      count: materialCounts.get(mat.id) ?? 0,
    }));
  }, [materials, materialCounts]);

  // Use categories directly from getPartTypeCategories (already filtered and counted by material + size)
  const categoriesWithCounts = useMemo(() => {
    return (partTypeCategories ?? []).map((cat) => ({
      categoryId: cat.categoryId,
      name: cat.name,
      count: cat.count ?? 0,
    }));
  }, [partTypeCategories]);


  // Mutations for creating custom items
  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (newMaterial) {
        setSelectedMaterialId(newMaterial.id);
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

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      if (newCategory) {
        // Set the selected category with the new category's ID
        setSelectedPartTypeCategory({
          categoryId: newCategory.id,
          name: newCategory.name,
        });
        setCustomPartTypeName("");
        setShowCustomPartTypeInput(false);
        setWizardStage("part");
        void utils.catalogue.getPartTypeCategories.invalidate();
      }
    },
  });

  // Handler for creating custom category
  const handleCustomCategorySubmit = () => {
    if (customPartTypeName.trim()) {
      createCategory.mutate({ name: customPartTypeName.trim() });
    }
  };

  // Fetch available sizes (from sizes table and part definitions)
  // Filtered by selected material to show accurate counts
  const { data: availableSizesFromQuery } =
    api.catalogue.getAvailableSizes.useQuery(
      { materialId: selectedMaterialId ?? undefined },
      { enabled: wizardStage === "size" && !!selectedMaterialId },
    );

  // Fetch parts for size selection (filtered by material) - for counting parts per size
  const { data: partsForSize } = api.catalogue.searchParts.useQuery(
    {
      materialId: selectedMaterialId ?? undefined,
    },
    { enabled: wizardStage === "size" && !!selectedMaterialId },
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

  // Navigation handlers
  const handleMaterialSelect = (materialId: string) => {
    setSelectedMaterialId(materialId);
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

  // Handler for part type category selection
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

  // Handler for individual part selection
  const handlePartSelect = (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
      partType: string | null;
    },
    supplierPartId: string,
    quantity?: number,
  ) => {
    addToPendingList(part.id, part, supplierPartId, quantity);
  };

  // Handler for editing a part
  const handleEditPart = (partId: string) => {
    setEditingPartId(partId);
  };

  const addToPendingList = (
    partId: string,
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
      partType: string | null;
    },
    supplierPartId: string,
    quantity?: number,
  ) => {
    // If an explicit quantity was provided (long-press), set it directly
    if (quantity !== undefined) {
      setPendingParts((prev) => {
        const existing = prev.find((p) => p.partId === partId);
        if (existing) {
          return prev.map((p) =>
            p.partId === partId ? { ...p, quantity } : p,
          );
        }
        return [
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
            quantity,
            supplierPartId,
          },
        ];
      });
      return;
    }
    // Check if already in pending list
    if (pendingParts.some((p) => p.partId === partId)) {
      // Deselect (remove from pending list)
      setPendingParts((prev) => prev.filter((p) => p.partId !== partId));
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
          supplierPartId,
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
    supplierPartId?: string;
  }) => {
    // Custom parts should always have a supplier (required during creation)
    if (part.supplierPartId) {
      addToPendingList(
        part.id,
        {
          ...part,
          description: null,
        },
        part.supplierPartId,
      );
    }
    setCustomPartContext(null);
  };

  const handleOpenCustomPartDialog = (context?: {
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    partTypeId?: string | null;
    category?: {
      name?: string | null;
      categoryId?: string | null;
    };
  }) => {
    setCustomPartContext(
      context
        ? {
            materialId: context.materialId,
            size: context.size,
            partTypeId: context.partTypeId,
            categoryName: context.category?.name ?? null,
          }
        : null,
    );
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

    // Validate that all parts have a supplier selected
    const partsWithoutSupplier = pendingParts.filter(
      (p) => !p.supplierPartId,
    );
    if (partsWithoutSupplier.length > 0) {
      // This should be prevented by UI, but add as a safety check
      console.error(
        "Cannot add parts without suppliers:",
        partsWithoutSupplier.map((p) => p.partDefinition.displayName),
      );
      return;
    }

    try {
      await Promise.all(
        pendingParts.map((pendingPart) =>
          addItem.mutateAsync({
            materialListId,
            partDefinitionId: pendingPart.partId,
            quantity: pendingPart.quantity,
            supplierPartId: pendingPart.supplierPartId!,
          }),
        ),
      );

      void utils.materialList.getMaterialList.invalidate({ materialListId });
      setPendingParts([]);
      setWizardStage("material");
      setSelectedMaterialId(null);
      setSelectedSize(null);
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding parts:", error);
    }
  };

  // Check if all pending parts have suppliers
  const allPartsHaveSuppliers = useMemo(() => {
    if (pendingParts.length === 0) return false;
    return pendingParts.every((p) => {
      const partsData = supplierPartsData.get(p.partId) ?? [];
      // Part must have supplierPartId set AND have available suppliers
      return p.supplierPartId && partsData.length > 0;
    });
  }, [pendingParts, supplierPartsData]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPendingParts([]);
      setWizardStage("material");
      setSelectedMaterialId(null);
      setSelectedSize(null);
      setShowCustomSize(false);
      setCustomSizeInput("");
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-4xl flex-col p-0 sm:w-full sm:max-w-4xl">
          <DialogHeader className="shrink-0 px-2 pt-3 pb-2 sm:px-4 sm:pt-4 sm:pb-3 md:px-6 md:pt-6 md:pb-4">
            <DialogTitle className="text-base sm:text-lg md:text-xl">Add Parts</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Select material, size, and part type to add parts to your list
            </DialogDescription>
          </DialogHeader>

          <div className="shrink-0 border-b px-2 sm:px-4 md:px-6">
            <WizardProgressIndicator
              currentStage={wizardStage}
              selectedMaterial={
                materials?.find((m) => m.id === selectedMaterialId)?.name ??
                null
              }
              selectedSize={selectedSize}
              selectedPartTypeCategory={selectedPartTypeCategory}
              onStageClick={(stage) => {
                if (stage === "material") {
                  setWizardStage("material");
                } else if (stage === "size" && selectedMaterialId) {
                  setWizardStage("size");
                } else if (
                  stage === "partTypeCategory" &&
                  selectedMaterialId &&
                  selectedSize
                ) {
                  setWizardStage("partTypeCategory");
                } else if (
                  stage === "part" &&
                  selectedMaterialId &&
                  selectedSize &&
                  selectedPartTypeCategory
                ) {
                  setWizardStage("part");
                }
              }}
            />
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-2 pt-3 pb-3 sm:space-y-4 sm:px-4 sm:pt-4 sm:pb-4 md:px-6">
            {wizardStage === "material" && (
              <MaterialStage
                materials={materialsWithCounts}
                selectedMaterialId={selectedMaterialId}
                onMaterialSelect={handleMaterialSelect}
                showCustomMaterialInput={showCustomMaterialInput}
                onShowCustomMaterialInput={setShowCustomMaterialInput}
                customMaterialName={customMaterialName}
                onCustomMaterialNameChange={setCustomMaterialName}
                onCreateMaterial={createMaterial}
              />
            )}
            {wizardStage === "size" && (
              <SizeStage
                availableSizes={availableSizesFromQuery}
                selectedSize={selectedSize}
                onSizeSelect={handleSizeSelect}
                showCustomSize={showCustomSize}
                onShowCustomSize={setShowCustomSize}
                customSizeInput={customSizeInput}
                onCustomSizeInputChange={setCustomSizeInput}
                customSizeUnitId={customSizeUnitId}
                onCustomSizeUnitIdChange={setCustomSizeUnitId}
                allUnits={allUnits ?? []}
                onCreateSize={createSize}
              />
            )}
            {wizardStage === "partTypeCategory" && (
              <PartTypeCategoryStage
                partTypeCategories={categoriesWithCounts}
                selectedPartTypeCategory={selectedPartTypeCategory}
                onPartTypeCategorySelect={handlePartTypeCategorySelection}
                showCustomPartTypeInput={showCustomPartTypeInput}
                onShowCustomPartTypeInput={setShowCustomPartTypeInput}
                customPartTypeName={customPartTypeName}
                onCustomPartTypeNameChange={setCustomPartTypeName}
                onCustomCategorySubmit={handleCustomCategorySubmit}
              />
            )}
            {wizardStage === "part" && (
              <PartStage
                partsForSelection={partsForSelection ?? []}
                pendingParts={pendingParts}
                onPartSelect={handlePartSelect}
                onEditPart={handleEditPart}
                onOpenCustomPartDialog={handleOpenCustomPartDialog}
                selectedMaterialId={selectedMaterialId}
                selectedSize={selectedSize}
                selectedPartTypeCategory={selectedPartTypeCategory}
                onBackToCategories={() => {
                  setSelectedPartTypeCategory(null);
                  setWizardStage("partTypeCategory");
                }}
                onContinueToReview={() => setWizardStage("review")}
              />
            )}
            {wizardStage === "review" && (
              <ReviewStage
                pendingParts={pendingParts}
                supplierPartsData={supplierPartsData}
                onUpdateQuantity={handleUpdateQuantity}
                onSetQuantity={handleSetQuantity}
                onUpdateSupplier={handleUpdateSupplier}
                onRemovePendingPart={handleRemovePendingPart}
                allPartsHaveSuppliers={allPartsHaveSuppliers}
              />
            )}
          </div>



          {/* Pending Parts Sidebar */}
          {pendingParts.length > 0 && wizardStage !== "review" && (
            <div className="shrink-0 border-t bg-gray-50">
              <button
                type="button"
                className="flex w-full items-center justify-between px-2 py-3 sm:px-4 sm:py-4 md:px-6"
                onClick={() => setPendingSectionOpen((prev) => !prev)}
              >
                <h4 className="text-sm font-semibold sm:text-base">
                  Pending Parts ({pendingParts.length})
                </h4>
                <svg
                  className={`h-4 w-4 text-gray-500 transition-transform ${pendingSectionOpen ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pendingSectionOpen && (
              <div className="px-2 pb-3 sm:px-4 sm:pb-4 md:px-6">
              <div className="mb-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleReviewAndAdd}
                    className="text-xs sm:text-sm"
                  >
                    Review & Add
                  </Button>
                </div>
              <div className="max-h-32 space-y-2 overflow-y-auto">
                {pendingParts.map((pendingPart) => (
                  <div
                    key={pendingPart.partId}
                    className="flex items-center gap-2 rounded border bg-white p-1.5 text-xs sm:p-2 sm:text-sm"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      {pendingPart.partDefinition.displayName}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdateQuantity(pendingPart.partId, -1)}
                        className="h-6 w-6 p-0"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={pendingPart.quantity}
                        onChange={(e) =>
                          handleSetQuantity(pendingPart.partId, parseInt(e.target.value) || 1)
                        }
                        className="h-6 w-12 [appearance:textfield] text-center text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdateQuantity(pendingPart.partId, 1)}
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
            </div>
          )}

          {wizardStage === "review" && (
            <DialogFooter className="shrink-0 border-t px-2 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex w-full justify-end">
                <Button
                  onClick={handleAddToMaterialList}
                  disabled={
                    pendingParts.length === 0 ||
                    !allPartsHaveSuppliers ||
                    addItem.isPending
                  }
                  title={
                    !allPartsHaveSuppliers
                      ? "Please select a supplier for all parts"
                      : undefined
                  }
                  className="w-full text-xs sm:w-auto sm:text-sm"
                >
                  {addItem.isPending
                    ? "Adding..."
                    : `Add ${pendingParts.length} Part${pendingParts.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <CreateCustomPartDialog
        open={isCreateCustomPartDialogOpen}
        onOpenChange={setIsCreateCustomPartDialogOpen}
        onPartCreated={handleCustomPartCreated}
        initialContext={customPartContext ?? undefined}
      />

      <EditPartDialog
        open={editingPartId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPartId(null);
        }}
        partId={editingPartId}
      />
    </>
  );
}
