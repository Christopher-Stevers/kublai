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
import { Plus, Minus } from "lucide-react";
import { CreateCustomPartDialog } from "./CreateCustomPartDialog";
import { WizardHeader } from "./WizardHeader";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import type { PendingPart } from "./wizard/types";
import { CatalogStage } from "./wizard/CatalogStage";
import { MaterialStage } from "./wizard/MaterialStage";
import { SizeStage } from "./wizard/SizeStage";
import { PartTypeCategoryStage } from "./wizard/PartTypeCategoryStage";
import { PartStage } from "./wizard/PartStage";
import { ReviewStage } from "./wizard/ReviewStage";
import { usePartWizard } from "./wizard/use-part-wizard";

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
  const [pendingParts, setPendingParts] = useState<PendingPart[]>([]);
  const [isCreateCustomPartDialogOpen, setIsCreateCustomPartDialogOpen] =
    useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [customPartContext, setCustomPartContext] = useState<{
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    catalogId?: string | null;
    categoryId?: string | null;
    categoryName?: string | null;
  } | null>(null);

  const {
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
  } = usePartWizard();

  const utils = api.useUtils();

  // Fetch parts for size selection (filtered by material) - for counting parts per size
  const { data: partsForSize } = api.catalogue.searchParts.useQuery(
    {
      catalogId: selectedCatalogId ?? undefined,
      materialId: selectedMaterialId ?? undefined,
    },
    { enabled: wizardStage === "size" && hasCatalogSelection && hasMaterialSelection },
  );

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

  // Handler for individual part selection
  const handlePartSelect = (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
    },
    supplierPartId?: string,
  ) => {
    addToPendingList(part.id, part, supplierPartId);
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
    },
    supplierPartId?: string,
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
    category?: {
      name?: string | null;
      categoryId?: string | null;
    };
  }) => {
    setCustomPartContext(
      context
        ? {
            catalogId: selectedCatalogId,
            materialId: context.materialId,
            size: context.size,
            categoryId: context.category?.categoryId ?? null,
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
      resetWizard();
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
      resetWizard();
    }
  }, [open, resetWizard]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-4xl flex-col p-0 sm:w-full sm:max-w-4xl">
          <DialogHeader className="shrink-0 px-2 pt-3 pb-2 sm:px-4 sm:pt-4 sm:pb-3 md:px-6 md:pt-6 md:pb-4">
            <DialogTitle className="text-base sm:text-lg md:text-xl">Add Parts</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Select catalog, material, size, and category to add parts to your list
            </DialogDescription>
          </DialogHeader>

          <div className="shrink-0 border-b px-2 pb-3 sm:px-4 sm:pb-4 md:px-6">
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
              hideSearch={wizardStage === "review"}
              actionLabel={wizardStage === "review" ? undefined : "Create Part"}
              onActionClick={() =>
                handleOpenCustomPartDialog({
                  materialId: selectedMaterialId,
                  size: selectedSize,
                  category: selectedPartTypeCategory
                    ? {
                        categoryId: selectedPartTypeCategory.categoryId,
                        name: selectedPartTypeCategory.name,
                      }
                    : undefined,
                })
              }
            />
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-2 pt-3 pb-3 sm:space-y-4 sm:px-4 sm:pt-4 sm:pb-4 md:px-6">
            {wizardStage === "catalog" && (
              <CatalogStage
                catalogs={catalogsWithCounts}
                selectedCatalogId={selectedCatalogId}
                allSelected={hasCatalogSelection && selectedCatalogId === null}
                onCatalogSelect={(catalogId) => {
                  handleCatalogSelect(catalogId);
                  setPendingParts([]);
                }}
                showCustomCatalogInput={showCustomCatalogInput}
                onShowCustomCatalogInput={setShowCustomCatalogInput}
                customCatalogName={customCatalogName}
                onCustomCatalogNameChange={setCustomCatalogName}
                onCreateCatalog={createCatalog}
              />
            )}
            {wizardStage === "material" && (
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
            {wizardStage === "size" && (
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
                allUnits={allUnits ?? []}
                onCreateSize={createSize}
              />
            )}
            {wizardStage === "partTypeCategory" && (
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
            {wizardStage === "part" && (
              <PartStage
                partsForSelection={filteredPartsForSelection}
                pendingParts={pendingParts}
                onPartSelect={handlePartSelect}
                onEditPart={handleEditPart}
                selectedMaterialId={selectedMaterialId}
                selectedSize={selectedSize}
                selectedPartTypeCategory={selectedPartTypeCategory}
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
            <div className="shrink-0 border-t bg-gray-50 px-2 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-semibold sm:text-base">
                  Pending Parts ({pendingParts.length})
                </h4>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleContinueAdding}
                    className="w-full text-xs sm:w-auto sm:text-sm"
                  >
                    Continue Adding
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={handleReviewAndAdd}
                    className="w-full text-xs sm:w-auto sm:text-sm"
                  >
                    Review & Add
                  </Button>
                </div>
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
