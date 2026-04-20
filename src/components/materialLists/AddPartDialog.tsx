"use client";

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from "react";
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
import { Plus, Minus, ChevronDown, ChevronUp } from "lucide-react";
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
  const [isPendingTrayOpen, setIsPendingTrayOpen] = useState(false);
  const [quantityPickerPreview, setQuantityPickerPreview] = useState<{
    partId: string;
    partName: string;
    quantity: number;
  } | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const pickerTouchYRef = useRef<number | null>(null);
  const pickerTouchAccumulatorRef = useRef(0);
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
  const fetchSupplierPartsRef = useRef(utils.supplier.getSupplierPartsByPart.fetch);
  const pendingPartIdsKey = useMemo(
    () => pendingParts.map((p) => p.partId).sort().join("|"),
    [pendingParts],
  );

  useEffect(() => {
    supplierPartsDataRef.current = supplierPartsData;
  }, [supplierPartsData]);

  useEffect(() => {
    fetchingPartsRef.current = fetchingParts;
  }, [fetchingParts]);

  useEffect(() => {
    fetchSupplierPartsRef.current = utils.supplier.getSupplierPartsByPart.fetch;
  }, [utils.supplier.getSupplierPartsByPart.fetch]);

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
        if (prev.has(partId)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(partId);
        return next;
      });

      void fetchSupplierPartsRef.current({ partDefinitionId: partId })
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
            if (!prev.has(partId)) {
              return prev;
            }
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
  }, [pendingPartIdsKey]);

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

  const handlePartQuantitySet = (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
    },
    quantity: number,
  ) => {
    setPendingParts((prev) => {
      const existing = prev.find((pendingPart) => pendingPart.partId === part.id);

      if (quantity <= 0) {
        return prev.filter((pendingPart) => pendingPart.partId !== part.id);
      }

      if (existing) {
        return prev.map((pendingPart) =>
          pendingPart.partId === part.id
            ? { ...pendingPart, quantity }
            : pendingPart,
        );
      }

      return [
        ...prev,
        {
          partId: part.id,
          partDefinition: {
            id: part.id,
            displayName: part.displayName,
            imageUrl: part.imageUrl,
            material: part.material,
            size: part.size,
          },
          quantity,
        },
      ];
    });
  };

  // Handler for editing a part
  const handleEditPart = (partId: string) => {
    setEditingPartId(partId);
  };

  useEffect(() => {
    if (!quantityPickerPreview) {
      pickerTouchYRef.current = null;
      pickerTouchAccumulatorRef.current = 0;
      return;
    }

    const clampQuantity = (quantity: number) => Math.max(0, quantity);

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        return;
      }

      event.preventDefault();

      const touchY = event.touches[0]?.clientY;
      if (touchY === undefined) {
        return;
      }

      if (pickerTouchYRef.current === null) {
        pickerTouchYRef.current = touchY;
        return;
      }

      const deltaY = pickerTouchYRef.current - touchY;
      pickerTouchAccumulatorRef.current += deltaY;
      pickerTouchYRef.current = touchY;

      const stepSize = 18;
      const stepDelta = Math.trunc(pickerTouchAccumulatorRef.current / stepSize);
      if (stepDelta === 0) {
        return;
      }

      pickerTouchAccumulatorRef.current -= stepDelta * stepSize;

      setQuantityPickerPreview((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          quantity: clampQuantity(prev.quantity + stepDelta),
        };
      });
    };

    const handleTouchEnd = (event: TouchEvent) => {
      event.preventDefault();

      const matchingPart = filteredPartsForSelection.find(
        (part) => part.id === quantityPickerPreview.partId,
      );

      if (matchingPart) {
        handlePartQuantitySet(matchingPart, quantityPickerPreview.quantity);
      }

      pickerTouchYRef.current = null;
      pickerTouchAccumulatorRef.current = 0;
      setQuantityPickerPreview(null);
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: false });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [filteredPartsForSelection, quantityPickerPreview]);

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
    if (pendingParts.some((p) => p.partId === partId)) {
      setPendingParts((prev) => prev.filter((p) => p.partId !== partId));
      return;
    }

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
      setPendingParts((prev) => (prev.length === 0 ? prev : []));
      setIsPendingTrayOpen(false);
      setQuantityPickerPreview(null);
      resetWizard();
    }
  }, [open, resetWizard]);

  useEffect(() => {
    if (pendingParts.length === 0) {
      setIsPendingTrayOpen(false);
    }
  }, [pendingParts.length]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateViewport = () => setIsMobileViewport(window.innerWidth < 640);

    updateViewport();
    window.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={`relative flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden p-0 sm:w-full sm:max-w-4xl ${quantityPickerPreview ? "touch-none" : ""}`}
          style={
            isMobileViewport
              ? {
                  position: "fixed",
                  top: "0.5rem",
                  right: "0.5rem",
                  left: "0.5rem",
                  bottom: "auto",
                  transform: "none",
                  width: "auto",
                  height: "calc(100dvh - 1rem)",
                  maxWidth: "none",
                  maxHeight: "calc(100dvh - 1rem)",
                }
              : undefined
          }
        >
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

          <div className={`flex-1 space-y-3 overflow-y-auto overscroll-contain px-2 pt-3 pb-3 sm:space-y-4 sm:px-4 sm:pt-4 sm:pb-4 md:px-6 ${quantityPickerPreview ? "touch-none overflow-hidden" : ""}`}>
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
                onPartQuantitySet={handlePartQuantitySet}
                onQuantityPickerPreviewChange={setQuantityPickerPreview}
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

          {/* Pending Parts Tray */}
          {pendingParts.length > 0 && wizardStage !== "review" && (
            <div className="shrink-0 border-t bg-gray-50">
              <button
                type="button"
                onClick={() => setIsPendingTrayOpen((open) => !open)}
                className="flex w-full items-center justify-between px-2 py-3 text-left sm:px-4 sm:py-4 md:px-6"
              >
                <div className="text-sm font-semibold sm:text-base">
                  Pending Parts ({pendingParts.length})
                </div>
                {isPendingTrayOpen ? (
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-500" />
                )}
              </button>

              <div
                className={`grid transition-all duration-200 ease-out ${
                  isPendingTrayOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="border-t px-2 pb-3 sm:px-4 sm:pb-4 md:px-6">
                    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:justify-end sm:py-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReviewAndAdd}
                        className="w-full text-xs sm:w-auto sm:text-sm"
                      >
                        Review Parts
                      </Button>
                    </div>

                    <div className="max-h-32 space-y-2 overflow-y-auto overscroll-contain">
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
                </div>
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

          {quantityPickerPreview && (
            <div
              className="absolute inset-0 z-[90] flex touch-none select-none bg-black/20 backdrop-blur-[1px]"
              style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
            >
              <div className="flex h-full w-full p-2 sm:p-3">
                <div
                  className="flex h-full w-full flex-col rounded-[2rem] bg-white/18 px-4 py-5 text-white shadow-2xl ring-1 ring-white/20 backdrop-blur-md sm:px-8 sm:py-8"
                  style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
                >
                  <div className="mb-6 text-center sm:mb-8">
                    <div className="text-base font-medium uppercase tracking-[0.22em] text-white/70 sm:text-lg">
                      Quantity
                    </div>
                    <div className="mt-2 line-clamp-2 text-base text-white/85 sm:text-xl">
                      {quantityPickerPreview.partName}
                    </div>
                  </div>

                  <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                    <div className="absolute inset-x-0 top-1/2 h-24 -translate-y-1/2 rounded-3xl border border-white/35 bg-white/20 shadow-inner sm:h-28" />
                    <div className="absolute inset-x-0 flex flex-col items-center transition-transform duration-75 ease-out">
                      {Array.from({ length: 13 }, (_, index) => {
                        const rawValue = quantityPickerPreview.quantity - 6 + index;
                        const value = rawValue < 0 ? null : rawValue;
                        const distance = value === null
                          ? Math.abs(rawValue - quantityPickerPreview.quantity)
                          : Math.abs(value - quantityPickerPreview.quantity);
                        const opacity = value === null ? 0 : Math.max(0.18, 1 - distance * 0.18);
                        const scale = Math.max(0.72, 1 - distance * 0.08);

                        return (
                          <div
                            key={`${quantityPickerPreview.quantity}-${rawValue}-${index}`}
                            className="flex h-13 select-none items-center justify-center text-center font-semibold leading-none sm:h-16"
                            style={{
                              opacity,
                              transform: `scale(${scale})`,
                              fontSize:
                                distance === 0
                                  ? "4.5rem"
                                  : distance === 1
                                    ? "2.75rem"
                                    : "1.6rem",
                            }}
                          >
                            {value ?? ""}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {isCreateCustomPartDialogOpen && (
        <CreateCustomPartDialog
          open={isCreateCustomPartDialogOpen}
          onOpenChange={setIsCreateCustomPartDialogOpen}
          onPartCreated={handleCustomPartCreated}
          initialContext={customPartContext ?? undefined}
        />
      )}

      {editingPartId !== null && (
        <EditPartDialog
          open={editingPartId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingPartId(null);
          }}
          partId={editingPartId}
        />
      )}
    </>
  );
}
