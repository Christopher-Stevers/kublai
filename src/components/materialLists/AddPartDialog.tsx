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
import { CategoryStage } from "./wizard/CategoryStage";
import { PartStage } from "./wizard/PartStage";
import { ReviewStage } from "./wizard/ReviewStage";
import { usePartWizard } from "./wizard/use-part-wizard";
import { VerticalPickerOverlay } from "./wizard/VerticalPickerOverlay";
import {
  applyOfflineAddItem,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineMaterialListSyncRunner } from "~/hooks/use-offline-material-list-sync";
import {
  getOfflineSupplierPartsByPart,
  setOfflineSupplierPartsByPart,
} from "~/lib/offline-supplier-parts";
import { parseOfflineSupplierPartId } from "~/lib/offline-suppliers";
import { markUserAction, measureUserAction } from "~/lib/performance-marks";

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
  const [isAddingParts, setIsAddingParts] = useState(false);
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
  } = usePartWizard();

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();

  // Fetch parts for size selection (filtered by material) - for counting parts per size
  const { data: partsForSize } = api.catalogue.searchParts.useQuery(
    {
      catalogId: selectedCatalogId ?? undefined,
      materialId: selectedMaterialId ?? undefined,
    },
    { enabled: isOnline && wizardStage === "size" && hasCatalogSelection && hasMaterialSelection },
  );

  const syncOfflineMaterialLists = useOfflineMaterialListSyncRunner();

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
      const now = new Date();
      const unitCost = variables.unitCost ?? null;
      const cost = unitCost ?? 0;
      const extendedPrice = variables.quantity * cost;

      const newItem = {
        id: tempId,
        quantity: variables.quantity.toString(),
        unitCost: unitCost?.toString() ?? null,
        extendedPrice: extendedPrice.toString(),
        descriptionSnapshot: variables.oneOffDisplayName ?? null,
        createdAt: now,
        updatedAt: now,
        syncVersion: now.toISOString(),
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
        addedBy: null,
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
  const supplierPartResolutionPromisesRef = useRef(new Map<string, Promise<string>>());
  const [resolvingSupplierPartIds, setResolvingSupplierPartIds] = useState<Set<string>>(
    () => new Set(),
  );
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

      const cachedSupplierParts = getOfflineSupplierPartsByPart(partId);
      if (cachedSupplierParts) {
        setSupplierPartsData((prev) => {
          const next = new Map(prev);
          next.set(partId, cachedSupplierParts);
          return next;
        });
        return;
      }

      if (!isOnline) {
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
            setOfflineSupplierPartsByPart(partId, data);
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
  }, [isOnline, pendingPartIdsKey]);

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

      const deltaY = touchY - pickerTouchYRef.current;
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

  const handleCacheSupplierPart = (
    partId: string,
    supplierPart: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      isPreferred: boolean;
      supplier: { id: string; name: string };
    },
  ) => {
    setSupplierPartsData((prev) => {
      const existing = prev.get(partId) ?? [];
      if (existing.some((sp) => sp.id === supplierPart.id)) return prev;
      const next = new Map(prev);
      next.set(partId, [...existing, supplierPart]);
      return next;
    });
  };

  const handleSupplierPartResolutionStart = (
    partId: string,
    resolution: Promise<string>,
  ) => {
    supplierPartResolutionPromisesRef.current.set(partId, resolution);
    setResolvingSupplierPartIds((prev) => new Set(prev).add(partId));

    void resolution
      .then((supplierPartId) => {
        handleUpdateSupplier(partId, supplierPartId);
      })
      .finally(() => {
        supplierPartResolutionPromisesRef.current.delete(partId);
        setResolvingSupplierPartIds((prev) => {
          const next = new Set(prev);
          next.delete(partId);
          return next;
        });
      });
  };

  const handleRemovePendingPart = (partId: string) => {
    setPendingParts((prev) => prev.filter((p) => p.partId !== partId));
  };

  const handleReviewAndAdd = () => {
    setWizardStage("review");
  };

  const handleAddToMaterialList = async () => {
    if (pendingParts.length === 0) return;

    setIsAddingParts(true);

    const resolvedSupplierPartIds = new Map<string, string>();

    try {
      const pendingSupplierResolutions = pendingParts
        .filter((pendingPart) => !pendingPart.supplierPartId)
        .map((pendingPart) => ({
          partId: pendingPart.partId,
          resolution: supplierPartResolutionPromisesRef.current.get(pendingPart.partId),
        }));

      const missingSupplierSelections = pendingSupplierResolutions.filter(
        ({ resolution }) => !resolution,
      );

      if (missingSupplierSelections.length > 0) {
        console.error(
          "Cannot add parts without suppliers:",
          missingSupplierSelections.map(({ partId }) => partId),
        );
        setIsAddingParts(false);
        return;
      }

      await Promise.all(
        pendingSupplierResolutions.map(async ({ partId, resolution }) => {
          if (!resolution) return;
          resolvedSupplierPartIds.set(partId, await resolution);
        }),
      );

      const partsReadyToAdd = pendingParts.map((pendingPart) => ({
        ...pendingPart,
        supplierPartId:
          pendingPart.supplierPartId ?? resolvedSupplierPartIds.get(pendingPart.partId),
      }));

      const partsWithoutSupplier = partsReadyToAdd.filter((p) => !p.supplierPartId);
      if (partsWithoutSupplier.length > 0) {
        console.error(
          "Cannot add parts without suppliers:",
          partsWithoutSupplier.map((p) => p.partDefinition.displayName),
        );
        setIsAddingParts(false);
        return;
      }

      await utils.materialList.getMaterialList.cancel({ materialListId });
      const now = new Date();
      const localItems = partsReadyToAdd.map((pendingPart) => {
        const selectedSupplierPart = (supplierPartsData.get(pendingPart.partId) ?? []).find(
          (supplierPart) => supplierPart.id === pendingPart.supplierPartId,
        );
        const unitCost = selectedSupplierPart?.lastKnownUnitCost
          ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
          : 0;
        const partDefinitionSnapshot = {
          id: pendingPart.partDefinition.id,
          displayName: pendingPart.partDefinition.displayName,
          imageUrl: pendingPart.partDefinition.imageUrl,
          material: pendingPart.partDefinition.material,
        };
        const supplierPartSnapshot = selectedSupplierPart
          ? {
              id: selectedSupplierPart.id,
              supplierId: selectedSupplierPart.supplierId,
              supplierSku: selectedSupplierPart.supplierSku,
              lastKnownUnitCost: selectedSupplierPart.lastKnownUnitCost,
              supplier: selectedSupplierPart.supplier,
            }
          : null;

        return {
          localItemId: `offline-${Date.now()}-${pendingPart.partId}-${Math.random().toString(36).slice(2, 8)}`,
          pendingPart,
          unitCost,
          partDefinitionSnapshot,
          supplierPartSnapshot,
        };
      });

      for (const item of localItems) {
        await applyOfflineAddItem(materialListId, {
          localItemId: item.localItemId,
          quantity: item.pendingPart.quantity,
          unitCost: item.unitCost,
          partDefinitionSnapshot: item.partDefinitionSnapshot,
          supplierPartSnapshot: item.supplierPartSnapshot,
        });

        await enqueueOfflineMutation({
          type: "addItem",
          materialListId,
          localItemId: item.localItemId,
          partDefinitionId: item.pendingPart.partId,
          quantity: item.pendingPart.quantity,
          supplierPartId: item.pendingPart.supplierPartId!,
          supplierId: parseOfflineSupplierPartId(item.pendingPart.supplierPartId!)?.supplierId,
          unitCost: item.unitCost,
          partDefinitionSnapshot: item.partDefinitionSnapshot,
          supplierPartSnapshot: item.supplierPartSnapshot,
          queuedAt: now.toISOString(),
        });
      }

      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const optimisticItems = localItems.map((item) => {
          const extendedPrice = item.pendingPart.quantity * item.unitCost;
          return {
            id: item.localItemId,
            quantity: item.pendingPart.quantity.toString(),
            unitCost: item.unitCost.toString(),
            extendedPrice: extendedPrice.toString(),
            descriptionSnapshot: item.pendingPart.partDefinition.displayName,
            createdAt: now,
            updatedAt: now,
            syncVersion: now.toISOString(),
            partDefinition: item.partDefinitionSnapshot,
            oneOff: null,
            supplierPart: item.supplierPartSnapshot,
            uom: null,
            addedBy: null,
          };
        });
        const updatedItems = [...old.items, ...optimisticItems];
        const materialTotal = updatedItems.reduce((sum, item) => {
          const price = item.extendedPrice ? parseFloat(item.extendedPrice.toString()) : 0;
          return sum + price;
        }, 0);

        return {
          ...old,
          items: updatedItems,
          materialTotal,
        };
      });

      markUserAction("add-parts-optimistic-commit", {
        materialListId,
        count: localItems.length,
      });
      setPendingParts([]);
      resetWizard();
      onOpenChange(false);
      setIsAddingParts(false);

      if (isOnline) {
        void syncOfflineMaterialLists().catch((error) => {
          console.error("Error syncing added parts:", error);
        });
      }
    } catch (error) {
      console.error("Error adding parts:", error);
      setIsAddingParts(false);
    }
  };

  // Local-first add requires real supplierPartIds. A supplier creation/link that is
  // still resolving cannot be queued safely because the offline mutation needs the
  // final supplierPartId.
  const allPartsHaveSuppliers = useMemo(() => {
    if (pendingParts.length === 0) return false;
    return pendingParts.every((p) => !!p.supplierPartId);
  }, [pendingParts]);

  const reviewedPartsTotal = useMemo(() => {
    return pendingParts.reduce((sum, pendingPart) => {
      const selectedSupplierPart = (supplierPartsData.get(pendingPart.partId) ?? []).find(
        (supplierPart) => supplierPart.id === pendingPart.supplierPartId,
      );
      const unitCost = selectedSupplierPart?.lastKnownUnitCost
        ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
        : 0;

      return sum + pendingPart.quantity * unitCost;
    }, 0);
  }, [pendingParts, supplierPartsData]);

  // Reset state when dialog closes
  useEffect(() => {
    if (open) {
      measureUserAction("add-part-dialog-ready", "add-part-open", { materialListId });
      return;
    }

    if (!open) {
      setPendingParts((prev) => (prev.length === 0 ? prev : []));
      setIsPendingTrayOpen(false);
      setQuantityPickerPreview(null);
      supplierPartResolutionPromisesRef.current.clear();
      setResolvingSupplierPartIds(new Set());
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

  const isWizardSearchActive = wizardStage !== "review" && wizardSearchQuery.trim().length > 0;

  const addPartsBackStateRef = useRef<History["state"]>(null);
  const addPartsDialogStateRef = useRef({
    editingPartId,
    isCreateCustomPartDialogOpen,
    isPendingTrayOpen,
    quantityPickerPreview,
    wizardStage,
  });

  useEffect(() => {
    addPartsDialogStateRef.current = {
      editingPartId,
      isCreateCustomPartDialogOpen,
      isPendingTrayOpen,
      quantityPickerPreview,
      wizardStage,
    };
  }, [
    editingPartId,
    isCreateCustomPartDialogOpen,
    isPendingTrayOpen,
    quantityPickerPreview,
    wizardStage,
  ]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const dialogState = {
      ...(window.history.state ?? {}),
      foremenAddPartsDialog: true,
    };
    addPartsBackStateRef.current = dialogState;
    window.history.pushState(dialogState, "");

    const keepDialogOnPage = () => {
      window.history.pushState(addPartsBackStateRef.current ?? dialogState, "");
    };

    const handlePopState = () => {
      const current = addPartsDialogStateRef.current;

      if (current.isCreateCustomPartDialogOpen) {
        setIsCreateCustomPartDialogOpen(false);
        keepDialogOnPage();
        return;
      }
      if (current.editingPartId !== null) {
        setEditingPartId(null);
        keepDialogOnPage();
        return;
      }
      if (current.quantityPickerPreview) {
        setQuantityPickerPreview(null);
        keepDialogOnPage();
        return;
      }
      if (current.isPendingTrayOpen) {
        setIsPendingTrayOpen(false);
        keepDialogOnPage();
        return;
      }

      if (current.wizardStage === "review") {
        setWizardStage("part");
        keepDialogOnPage();
        return;
      }
      if (current.wizardStage === "part") {
        setWizardStage("category");
        keepDialogOnPage();
        return;
      }
      if (current.wizardStage === "category") {
        setSelectedCategory(null);
        setShowCustomCategoryInput(false);
        setCustomCategoryName("");
        setWizardStage("size");
        keepDialogOnPage();
        return;
      }
      if (current.wizardStage === "size") {
        setShowCustomSize(false);
        setCustomSizeInput("");
        setCustomSizeUnitId(null);
        setWizardStage("material");
        keepDialogOnPage();
        return;
      }
      if (current.wizardStage === "material") {
        setShowCustomMaterialInput(false);
        setCustomMaterialName("");
        setWizardStage("catalog");
        keepDialogOnPage();
        return;
      }

      onOpenChange(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    onOpenChange,
    open,
    setCustomCategoryName,
    setCustomMaterialName,
    setCustomSizeInput,
    setCustomSizeUnitId,
    setSelectedCategory,
    setShowCustomCategoryInput,
    setShowCustomMaterialInput,
    setShowCustomSize,
    setWizardStage,
  ]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={`relative flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col overflow-hidden p-0 sm:h-[90vh] sm:max-h-[90vh] sm:w-[calc(100vw-3rem)] sm:max-w-[90rem] ${quantityPickerPreview ? "touch-none" : ""}`}
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

          {wizardStage !== "review" && (
            <div className="shrink-0 border-b px-2 pb-3 sm:px-4 sm:pb-4 md:px-6">
              <WizardHeader
                currentStage={wizardStage}
                selectedCatalog={selectedCatalogName}
                selectedMaterial={selectedMaterialName}
                selectedSize={selectedSizeName}
                selectedCategory={selectedCategoryName}
                onStageClick={handleStageClick}
                searchQuery={wizardSearchQuery}
                onSearchChange={setWizardSearchQuery}
                searchPlaceholder={wizardSearchPlaceholder}
                actionLabel="Create Part"
                onActionClick={() =>
                  handleOpenCustomPartDialog({
                    materialId: selectedMaterialId,
                    size: selectedSize,
                    category: selectedCategory
                      ? {
                          categoryId: selectedCategory.categoryId,
                          name: selectedCategory.name,
                        }
                      : undefined,
                  })
                }
              />
            </div>
          )}

          <div className={`flex-1 space-y-3 overflow-y-auto overscroll-contain pt-3 pb-3 sm:space-y-4 sm:pt-4 sm:pb-4 ${wizardStage === "review" ? "px-4 sm:px-6" : "px-2 sm:px-4 md:px-6"} ${quantityPickerPreview ? "touch-none overflow-hidden" : ""}`}>
            {isWizardSearchActive ? (
              <PartStage
                partsForSelection={filteredPartsForSelection}
                pendingParts={pendingParts}
                onPartSelect={handlePartSelect}
                onPartQuantitySet={handlePartQuantitySet}
                onQuantityPickerPreviewChange={setQuantityPickerPreview}
                onEditPart={handleEditPart}
                selectedMaterialId={selectedMaterialId}
                selectedSize={selectedSize}
                selectedCategory={selectedCategory}
                onContinueToReview={() => setWizardStage("review")}
                title="Matching Parts"
              />
            ) : wizardStage === "catalog" && (
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
            {!isWizardSearchActive && wizardStage === "material" && (
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
            {!isWizardSearchActive && wizardStage === "size" && (
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
            {!isWizardSearchActive && wizardStage === "category" && (
              <CategoryStage
                categories={categoriesWithCounts}
                selectedCategory={selectedCategory}
                allSelected={hasCategorySelection && selectedCategory?.categoryId === null}
                onCategorySelect={handleCategorySelection}
                showCustomCategoryInput={showCustomCategoryInput}
                onShowCustomCategoryInput={setShowCustomCategoryInput}
                customCategoryName={customCategoryName}
                onCustomCategoryNameChange={setCustomCategoryName}
                onCustomCategorySubmit={handleCustomCategorySubmit}
              />
            )}
            {!isWizardSearchActive && wizardStage === "part" && (
              <PartStage
                partsForSelection={filteredPartsForSelection}
                pendingParts={pendingParts}
                onPartSelect={handlePartSelect}
                onPartQuantitySet={handlePartQuantitySet}
                onQuantityPickerPreviewChange={setQuantityPickerPreview}
                onEditPart={handleEditPart}
                selectedMaterialId={selectedMaterialId}
                selectedSize={selectedSize}
                selectedCategory={selectedCategory}
                onContinueToReview={() => setWizardStage("review")}
              />
            )}
            {!isWizardSearchActive && wizardStage === "review" && (
              <ReviewStage
                pendingParts={pendingParts}
                supplierPartsData={supplierPartsData}
                onUpdateQuantity={handleUpdateQuantity}
                onSetQuantity={handleSetQuantity}
                onUpdateSupplier={handleUpdateSupplier}
                onCacheSupplierPart={handleCacheSupplierPart}
                onSupplierPartResolutionStart={handleSupplierPartResolutionStart}
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
                className="flex w-full items-center justify-between gap-2 px-2 py-3 text-left sm:px-4 sm:py-4 md:px-6"
              >
                <div className="text-sm font-semibold sm:text-base">
                  Pending Parts ({pendingParts.length})
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleReviewAndAdd();
                    }}
                    className="h-8 px-2.5 text-xs sm:h-9 sm:text-sm"
                  >
                    Review Parts
                  </Button>
                  {isPendingTrayOpen ? (
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronUp className="h-4 w-4 text-gray-500" />
                  )}
                </div>
              </button>

              <div
                className={`grid transition-all duration-200 ease-out ${
                  isPendingTrayOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="border-t px-2 pt-3 pb-3 sm:px-4 sm:pt-4 sm:pb-4 md:px-6">
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
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-left sm:text-right">
                  <p className="text-xs text-gray-600 sm:text-sm">Review Total</p>
                  <p className="text-lg font-semibold sm:text-xl">
                    ${reviewedPartsTotal.toFixed(2)}
                  </p>
                </div>
                <Button
                  onClick={handleAddToMaterialList}
                  disabled={
                    pendingParts.length === 0 ||
                    !allPartsHaveSuppliers ||
                    addItem.isPending ||
                    isAddingParts
                  }
                  title={
                    !allPartsHaveSuppliers
                      ? "Please select a supplier for all parts"
                      : undefined
                  }
                  className="w-full text-xs sm:w-auto sm:text-sm"
                >
                  {addItem.isPending || isAddingParts
                    ? "Adding..."
                    : `Add ${pendingParts.length} Part${pendingParts.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </DialogFooter>
          )}

          {quantityPickerPreview && (
            <VerticalPickerOverlay
              className="absolute"
              title="Quantity"
              subtitle={quantityPickerPreview.partName}
              centerIndex={quantityPickerPreview.quantity}
              getItem={(value) => (value < 0 ? null : value)}
              renderItem={(value) => value}
            />
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
