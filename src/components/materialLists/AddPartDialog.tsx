"use client";
import { LandscapeSubBar } from "~/components/app/LandscapeSubBar";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { SupplierLabelContext } from "~/components/suppliers/SupplierLabel";
import { useJobPricing, jobPriceStatus } from "~/hooks/use-job-pricing";
import { findPreferredJobPrice, indexJobPrices, listedPartsFirst } from "~/lib/job-pricing";
import { packContents, packsFromPieces, individualUnitLabel } from "~/lib/pack-quantity";

import { purchaseLineTotal } from "~/lib/purchase-quantity";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";

import { useState, useMemo, useEffect, useRef } from "react";
import { useMaterialListSortPreference } from "~/hooks/use-material-list-sort";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { AlertCircle, Search, XIcon, PlusIcon, ArrowLeftRight, ListChecksIcon, PackagePlusIcon } from "lucide-react";
import { CreateCustomPartDialog } from "./CreateCustomPartDialog";
import { WizardHeader } from "./WizardHeader";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import type { PendingPart, PendingSupplierPartSnapshot } from "./wizard/types";
import { useHeaderBackOverride } from "~/lib/header-back-events";

import { ArcScrollerSurface } from "~/components/ui/arc-scroller";
import { CatalogStage } from "./wizard/CatalogStage";
import { MaterialStage } from "./wizard/MaterialStage";
import { SizeStage } from "./wizard/SizeStage";
import { CategoryStage } from "./wizard/CategoryStage";
import { PartStage } from "./wizard/PartStage";
import { ChosenPartsView } from "./wizard/ChosenPartsView";
import { usePartWizard } from "./wizard/use-part-wizard";
import { VerticalPickerOverlay } from "./wizard/VerticalPickerOverlay";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useReplicacheMaterialList } from "~/hooks/use-replicache-material-list";
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { matchJobSupplierDefault } from "~/lib/job-supplier-defaults";
import { useCatalogueFirstDownload, useReplicacheCatalogue } from "~/hooks/use-replicache-catalogue";
import {
  getOfflineSupplierPartsByPart,
  setOfflineSupplierPartsByPart,
} from "~/lib/offline-supplier-parts";
import { markUserAction, measureUserAction } from "~/lib/performance-marks";
import { notify } from "~/components/ui/app-dialogs";
import { PrefabsPanel, type PrefabView } from "./prefabs/PrefabsPanel";

interface AddPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId?: string;
  managePrefabs?: boolean;
}

export function AddPartDialog({
  open,
  onOpenChange,
  materialListId = "",
  managePrefabs = false,
}: AddPartDialogProps) {
  const sandbox = useTutorialSandbox();
  const { data: actionPermissions } = api.user.getMyRole.useQuery();
  const canCreateParts = !sandbox && !!actionPermissions?.permissions.can["parts.create"];
  const { getReplicache: getMaterialListReplicache, requestSync: requestMaterialListReplicacheSync } = useWorkspaceMutations();
  // Tool request lists pick from tool catalogs; material lists never do.
  const { materialList: listHeader, items: listItems } =
    useReplicacheMaterialList(materialListId || "catalogue-prefab-manager");
  const [managedPrefabKind, setManagedPrefabKind] = useState<"materials" | "tools">("materials");
  const isToolRequest = managePrefabs ? managedPrefabKind === "tools" : listHeader?.kind === "tools";
  // Prefabs: the panel replaces the wizard while open; with a target set, the
  // wizard picks parts for that prefab instead of this list.
  const [prefabView, setPrefabView] = useState<PrefabView | null>(managePrefabs ? {kind:"list"} : null);
  const [prefabTarget, setPrefabTarget] = useState<{ id: string; name: string } | null>(null);
  // Wizard state
  const [pendingParts, setPendingParts] = useState<PendingPart[]>([]);
  const [isCreateCustomPartDialogOpen, setIsCreateCustomPartDialogOpen] =
    useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [showChosenParts, setShowChosenParts] = useState(false);
  const [quantityPickerPreview, setQuantityPickerPreview] = useState<{
    partId: string;
    partName: string;
    mode?: "individual";
    pointerY?: number;
    inputType?: string;
    quantity: number;
  } | null>(null);
  const [isAddingParts, setIsAddingParts] = useState(false);
  const pickerSwitchLatchedRef = useRef(false);
  const pickerTouchYRef = useRef<number | null>(null);
  const pickerTouchAccumulatorRef = useRef(0);
  const [customPartContext, setCustomPartContext] = useState<{
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    catalogId?: string | null;
    categoryId?: string | null;
    categoryName?: string | null;
  } | null>(null);

  const { sortMode, keywordGroups } = useMaterialListSortPreference();
  const {
    wizardStage,
    selectedCatalogId,
    hasCatalogSelection,
    selectedMaterialId,
    hasMaterialSelection,
    selectedSize,
    hasSizeSelection,
    selectedCategory,
    hasCategorySelection,
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
    catalogsWithCounts,
    materialsWithCounts,
    allUnits,
    categoriesWithCounts,
    filteredAvailableSizes,
    filteredPartsForSelection: baseFilteredPartsForSelection,
    createCatalog,
    createMaterial,
    createSize,
    handleCatalogSelect,
    handleMaterialSelect,
    handleSizeSelect,
    handleCategorySelection,
    handleCustomCategorySubmit,
    handleStageClick,
    returnToStage,
    resetWizard,
    selectedCatalogName,
    selectedMaterialName,
    selectedSizeName,
    selectedCategoryName,
  } = usePartWizard(
    open,
    sortMode,
    keywordGroups,
    isToolRequest ? "assets" : "materials",
    undefined,
    !managePrefabs && !isToolRequest,
  );

  const selectingTools = isToolRequest || catalogsWithCounts.some(catalog => catalog.id === selectedCatalogId && catalog.kind === "assets");
  const toolPartIds = new Set(baseFilteredPartsForSelection
    .filter(part => catalogsWithCounts.some(catalog => catalog.id === part.catalogId && catalog.kind === "assets"))
    .map(part => part.id));
  const defaultJob=useReplicacheJobDetail(listHeader?.jobId??"")?.job;
  const defaultCatalogue=useReplicacheCatalogue();
  const defaultPartsById=useMemo(()=>new Map(defaultCatalogue.parts.map(part=>[part.id,part])),[defaultCatalogue.parts]);
  const {data:priceBookSnapshot}=useJobPricing(listHeader?.kind === "tools" ? null : listHeader?.jobId);
  const jobPriceBook = useMemo(() => priceBookSnapshot && ({ ...priceBookSnapshot, entries: indexJobPrices(priceBookSnapshot.entries) }), [priceBookSnapshot]);
  const filteredPartsForSelection=useMemo(()=>{
    const annotated=baseFilteredPartsForSelection.map(p=>({...p,jobPriceStatus:jobPriceStatus(jobPriceBook,p.id)}));
    return jobPriceBook?.policy?.active ? listedPartsFirst(annotated,p=>p.jobPriceStatus!=="unlisted") : annotated;
  },[baseFilteredPartsForSelection,jobPriceBook]);
  const utils = api.useUtils();
  const { data: orderWheelUsage } = api.catalogue.recentOrderWheelUsage.useQuery(undefined, { staleTime: 60_000 });
  const isOnline = useOnlineStatus();
  const addPrefabItems = api.prefabs.addItems.useMutation();
  const catalogueDownloading = useCatalogueFirstDownload(open);
  const { data: currentUser } = api.user.getMe.useQuery(undefined, {
    enabled: open && isOnline,
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
    packSize?: string | null;
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
  const fetchSupplierPartsRef = useRef(
    utils.supplier.getSupplierPartsByPart.fetch,
  );
  const supplierPartResolutionPromisesRef = useRef(
    new Map<string, Promise<string>>(),
  );
  const [, setResolvingSupplierPartIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingPartIdsKey = useMemo(
    () =>
      pendingParts
        .map((p) => p.partId)
        .sort()
        .join("|"),
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

      const cachedSupplierParts = sandbox ? null : getOfflineSupplierPartsByPart(partId);
      if (cachedSupplierParts) {
        setSupplierPartsData((prev) => {
          const next = new Map(prev);
          next.set(partId, cachedSupplierParts);
          return next;
        });
        // Show cached choices immediately, but refresh them while online.
        if (!isOnline) return;
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

      void fetchSupplierPartsRef
        .current({ partDefinitionId: partId })
        .then(
          (
            data: Array<{
              id: string;
              supplierId: string;
              supplierSku: string | null;
              lastKnownUnitCost: string | null;
    packSize?: string | null;
              isPreferred: boolean;
              supplier: {
                id: string;
                name: string;
              };
            }>,
          ) => {
            if (!sandbox) setOfflineSupplierPartsByPart(partId, data);
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
  }, [isOnline, pendingPartIdsKey, sandbox]);

  // Auto-select preferred supplier when part is added
  useEffect(() => {
    pendingParts.forEach((pendingPart) => {
      if (pendingPart.supplierPartId || pendingPart.isTool) return;

      const partMetadata = defaultPartsById.get(pendingPart.partId);
      const wanted =
        !pendingPart.manualSupplier && partMetadata
          ? matchJobSupplierDefault(defaultJob?.supplierDefaults, partMetadata)
          : null;
      if (wanted) {
        const existing = supplierPartsData
          .get(pendingPart.partId)
          ?.find((option) => option.supplierId === wanted.supplierId);
        const option = {
          id:
            existing?.id ??
            `offline-supplier-part:${pendingPart.partId}:${wanted.supplierId}`,
          supplierId: wanted.supplierId,
          supplierSku: existing?.supplierSku ?? null,
          lastKnownUnitCost: wanted.bookId
            ? null
            : (existing?.lastKnownUnitCost ?? null),
          packSize: existing?.packSize ?? null,
          isPreferred: false,
          supplier: { id: wanted.supplierId, name: wanted.label },
        };
        setPendingParts((prev) =>
          prev.map((item) =>
            item.partId === pendingPart.partId && !item.manualSupplier
              ? {
                  ...item,
                  supplierPartId: option.id,
                  supplierPartSnapshot: option,
                  supplierVersion: wanted,
                }
              : item,
          ),
        );
        if (isOnline)
          void utils.job.previewSupplierDefault
            .fetch(
              { jobId: listHeader!.jobId, partId: pendingPart.partId },
              { staleTime: 0 },
            )
            .then((result) => {
              if (!result) return;
              const resolved = {
                ...option,
                supplier: { id: wanted.supplierId, name: result.supplierName },
                id: result.listing?.id ?? option.id,
                lastKnownUnitCost: result.unitCost,
                supplierSku: result.listing?.supplierSku ?? null,
                packSize: result.listing?.packSize ?? null,
              };
              setPendingParts((prev) =>
                prev.map((item) =>
                  item.partId === pendingPart.partId && !item.manualSupplier
                    ? {
                        ...item,
                        supplierPartId: resolved.id,
                        supplierPartSnapshot: resolved,
                        supplierVersion: result.version,
                      }
                    : item,
                ),
              );
            })
            .catch(() => undefined);
        return;
      }
      const partsData = supplierPartsData.get(pendingPart.partId);
      if (partsData && partsData.length > 0) {
        const jobEntry = findPreferredJobPrice(jobPriceBook?.entries??[],pendingPart.partId);
        const preferred = partsData.find(sp=>sp.id===jobEntry?.supplierPartId) ?? partsData.find((sp) => sp.isPreferred);
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
  }, [pendingParts, supplierPartsData, jobPriceBook, defaultPartsById, defaultJob?.supplierDefaults, isOnline, utils.job.previewSupplierDefault, listHeader]);

  // Handler for individual part selection
  const handlePartSelect = (
    part: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
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
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
    },
    quantity: number,
  ) => {
    setPendingParts((prev) => {
      const existing = prev.find(
        (pendingPart) => pendingPart.partId === part.id,
      );

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
          isTool: selectingTools || toolPartIds.has(part.id),
          partDefinition: {
            id: part.id,
            displayName: part.displayName,
            piecesPerPack: part.piecesPerPack,
            bulkUnit: part.bulkUnit,
            individualUnit: part.individualUnit,
            imageUrl: part.imageUrl,
            jobPriceStatus: jobPriceStatus(jobPriceBook, part.id),
            material: part.material,
            size: part.size,
          },
          quantity,
        },
      ];
    });
  };

  const quantityPickerParts = useMemo(() => [
    ...filteredPartsForSelection,
    ...pendingParts.map(p => ({ ...p.partDefinition, description: null })),
  ], [filteredPartsForSelection, pendingParts]);

  // Handler for editing a part. Catalogue/part editing is an online-only management flow.
  const handleEditPart = (partId: string) => {
    if (!isOnline) return;
    setEditingPartId(partId);
  };

  useEffect(() => {
    if (!quantityPickerPreview) {
      pickerTouchYRef.current = null;
      pickerTouchAccumulatorRef.current = 0;
      return;
    }

    if (pickerTouchYRef.current === null && quantityPickerPreview.pointerY !== undefined) pickerTouchYRef.current = quantityPickerPreview.pointerY;
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
      const stepDelta = Math.trunc(
        pickerTouchAccumulatorRef.current / stepSize,
      );
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
          quantity: packContents(quantityPickerParts.find(part => part.id === prev.partId)?.piecesPerPack) > 1 ? Math.max(-1, prev.quantity + stepDelta) : clampQuantity(prev.quantity + stepDelta),
        };
      });
    };

    const handleTouchEnd = (event: TouchEvent) => {
      event.preventDefault();

      const matchingPart = quantityPickerParts.find(
        (part) => part.id === quantityPickerPreview.partId,
      );

      if (matchingPart) {
        if (quantityPickerPreview.quantity >= 0) handlePartQuantitySet(matchingPart, quantityPickerPreview.mode === "individual" ? packsFromPieces(quantityPickerPreview.quantity, matchingPart.piecesPerPack) : quantityPickerPreview.quantity);
      }

      pickerTouchYRef.current = null;
      pickerTouchAccumulatorRef.current = 0;
      setQuantityPickerPreview(null);
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: false });
    const handleTouchCancel = () => setQuantityPickerPreview(null);
    window.addEventListener("touchcancel", handleTouchCancel, { passive: false });

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [quantityPickerParts, quantityPickerPreview]);

  useEffect(() => {
    if (quantityPickerPreview?.quantity !== -1) pickerSwitchLatchedRef.current = false;
    if (quantityPickerPreview?.inputType !== "touch" || quantityPickerPreview.quantity !== -1 || pickerSwitchLatchedRef.current) return;
    const timer = setTimeout(() => {
      pickerSwitchLatchedRef.current = true;
      pickerTouchAccumulatorRef.current = 0;
      setQuantityPickerPreview(prev => prev?.quantity === -1 ? {...prev, quantity:-1, mode:prev.mode === "individual" ? undefined : "individual"} : prev);
    }, 1000);
    return () => clearTimeout(timer);
  }, [quantityPickerPreview?.partId, quantityPickerPreview?.quantity, quantityPickerPreview?.mode, quantityPickerPreview?.inputType]);

  const addToPendingList = (
    partId: string,
    part: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
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
        isTool: selectingTools || toolPartIds.has(partId),
        partDefinition: {
          id: part.id,
          displayName: part.displayName,
          piecesPerPack: part.piecesPerPack,
          bulkUnit: part.bulkUnit,
          individualUnit: part.individualUnit,
          imageUrl: part.imageUrl,
          jobPriceStatus: jobPriceStatus(jobPriceBook, part.id),
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
    piecesPerPack?: number | null;
    bulkUnit?: string | null;
    individualUnit?: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    supplierPartId?: string;
  }) => {
    // A newly created part must remain visible even without a supplier, or
    // when the supplier lookup fails. The basket can resolve the supplier later.
    addToPendingList(part.id, { ...part, description: null }, part.supplierPartId);
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
    if (!isOnline) return;
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
          const newQuantity = Math.max(packsFromPieces(1, p.partDefinition.piecesPerPack), p.quantity + delta);
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
          return { ...p, quantity: Math.max(packsFromPieces(1, p.partDefinition.piecesPerPack), quantity) };
        }
        return p;
      }),
    );
  };

  const handleUpdateSupplier = (
    partId: string,
    supplierPartId: string,
    supplierPartSnapshot?: PendingSupplierPartSnapshot | null,
    supplierVersion?: import("~/lib/job-supplier-defaults").SupplierVersion | null,
  ) => {
    setPendingParts((prev) =>
      prev.map((p) => {
        if (p.partId === partId) {
          return {
            ...p,
            manualSupplier: true,
            supplierVersion: supplierVersion ?? null,
            supplierPartId,
            supplierPartSnapshot: supplierPartSnapshot ?? null,
          };
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
    packSize?: string | null;
      isPreferred: boolean;
      supplier: { id: string; name: string };
    },
  ) => {
    setSupplierPartsData((prev) => {
      const existing = prev.get(partId) ?? [];
      const nextParts = existing.some((sp) => sp.id === supplierPart.id)
        ? existing.map((sp) => (sp.id === supplierPart.id ? supplierPart : sp))
        : [...existing, supplierPart];
      const next = new Map(prev);
      next.set(partId, nextParts);
      if (!sandbox) setOfflineSupplierPartsByPart(partId, nextParts);
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


  const handleAddToMaterialList = async () => {
    if (pendingParts.length === 0 || isAddingParts) return;
    if (!isToolRequest && pendingParts.some(part => !part.isTool && !part.supplierPartId)) {
      setShowChosenParts(true);
      return;
    }

    setIsAddingParts(true);

    const resolvedSupplierPartIds = new Map<string, string>();

    try {
      const pendingSupplierResolutions = pendingParts
        .filter((pendingPart) => !pendingPart.supplierPartId && !pendingPart.isTool)
        .map((pendingPart) => ({
          partId: pendingPart.partId,
          resolution: supplierPartResolutionPromisesRef.current.get(
            pendingPart.partId,
          ),
        }));

      const missingSupplierSelections = pendingSupplierResolutions.filter(
        ({ resolution }) => !resolution,
      );

      // Tool requests go to the tool room, so tools need no supplier.
      if (missingSupplierSelections.length > 0 && !isToolRequest) {
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
          pendingPart.supplierPartId ??
          resolvedSupplierPartIds.get(pendingPart.partId),
      }));

      const partsWithoutSupplier = partsReadyToAdd.filter(
        (p) => !p.supplierPartId && !p.isTool,
      );
      if (partsWithoutSupplier.length > 0 && !isToolRequest) {
        console.error(
          "Cannot add parts without suppliers:",
          partsWithoutSupplier.map((p) => p.partDefinition.displayName),
        );
        setIsAddingParts(false);
        return;
      }

      if (prefabTarget) {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        await addPrefabItems.mutateAsync({
          prefabId: prefabTarget.id,
          items: partsReadyToAdd.map((part) => ({
            partDefinitionId: part.partId,
            supplierPartId:
              part.supplierPartId && uuid.test(part.supplierPartId) ? part.supplierPartId : null,
            quantity: part.quantity,
          })),
        });
        await utils.prefabs.list.invalidate();
        setPendingParts([]);
        resetWizard();
        setPrefabView({ kind: "edit", prefabId: prefabTarget.id });
        setPrefabTarget(null);
        setIsAddingParts(false);
        return;
      }

      if (managePrefabs) throw new Error("Select a prefab before adding parts.");

      const localItems = partsReadyToAdd.map((pendingPart) => {
        const selectedSupplierPart =
          pendingPart.supplierPartSnapshot ??
          (supplierPartsData.get(pendingPart.partId) ?? []).find(
            (supplierPart) => supplierPart.id === pendingPart.supplierPartId,
          ) ??
          null;
        const jobCost=pendingPart.supplierVersion ? undefined : findPreferredJobPrice(jobPriceBook?.entries??[],pendingPart.partId,selectedSupplierPart?.supplierId,selectedSupplierPart?.id)?.unitCost;
        const unitCost=pendingPart.isTool ? 0 : Number(jobCost ?? selectedSupplierPart?.lastKnownUnitCost ?? 0);
        const partDefinitionSnapshot = {
          id: pendingPart.partDefinition.id,
          displayName: pendingPart.partDefinition.displayName,
          assetTracking: pendingPart.isTool ? "serialized" : null,
          piecesPerPack: pendingPart.partDefinition.piecesPerPack,
          bulkUnit: pendingPart.partDefinition.bulkUnit,
          individualUnit: pendingPart.partDefinition.individualUnit,
          imageUrl: pendingPart.partDefinition.imageUrl,
          material: pendingPart.partDefinition.material,
        };
        const supplierPartSnapshot = selectedSupplierPart
          ? {
              id: selectedSupplierPart.id,
              supplierId: selectedSupplierPart.supplierId,
              supplierSku: selectedSupplierPart.supplierSku,
              lastKnownUnitCost: pendingPart.supplierVersion ? selectedSupplierPart.lastKnownUnitCost : findPreferredJobPrice(jobPriceBook?.entries??[],pendingPart.partId,selectedSupplierPart.supplierId,selectedSupplierPart.id)?.unitCost ?? selectedSupplierPart.lastKnownUnitCost,
              packSize: selectedSupplierPart.packSize ?? null,
              supplier: selectedSupplierPart.supplier,
            }
          : null;

        return {
          localItemId: crypto.randomUUID(),
          pendingPart,
          unitCost,
          supplierId: selectedSupplierPart?.supplierId ?? null,
          partDefinitionSnapshot,
          supplierPartSnapshot,
        };
      });

      markUserAction("add-parts-optimistic-commit", {
        materialListId,
        count: localItems.length,
      });

      const replicache = getMaterialListReplicache();
      await Promise.all(
        localItems.map((item) =>
          replicache.mutate.addItem({
            materialListId,
            itemId: item.localItemId,
            partDefinitionId: item.pendingPart.partId,
            useJobDefaults: !item.pendingPart.manualSupplier && !item.pendingPart.isTool,
            supplierVersionSnapshot: item.pendingPart.supplierVersion??null,
            supplierPartId: item.pendingPart.supplierPartId ?? null,
            supplierId: item.supplierId,
            quantity: item.pendingPart.quantity,
            unitCost: item.unitCost,
            partDefinitionSnapshot: item.partDefinitionSnapshot,
            supplierPartSnapshot: item.supplierPartSnapshot,
            addedBySnapshot: currentUser
              ? {
                  id: currentUser.id,
                  name: currentUser.name,
                  email: currentUser.email,
                  department: currentUser.department ?? null,
                }
              : null,
          }),
        ),
      );
      requestMaterialListReplicacheSync(0, "push-pull");

      closeDialogAndCleanHistory();
      setIsAddingParts(false);
      window.setTimeout(() => {
        setPendingParts([]);
        resetWizard();
      }, 0);
    } catch (error) {
      console.error("Error adding parts:", error);
      if (prefabTarget) notify("Couldn't add the parts to the prefab. Try again.", "error");
      setIsAddingParts(false);
    }
  };

  // Local-first add requires real supplierPartIds. A supplier creation/link that is
  // still resolving cannot be queued safely because the offline mutation needs the
  // final supplierPartId.
  const allPartsHaveSuppliers = useMemo(() => {
    if (pendingParts.length === 0) return false;
    if (isToolRequest) return true;
    return pendingParts.every((p) => p.isTool || !!p.supplierPartId);
  }, [pendingParts, isToolRequest]);

  const chosenPartsTotal = useMemo(() => {
    return pendingParts.reduce((sum, pendingPart) => {
      const selectedSupplierPart =
        pendingPart.supplierPartSnapshot ??
        (supplierPartsData.get(pendingPart.partId) ?? []).find(
          (supplierPart) => supplierPart.id === pendingPart.supplierPartId,
        ) ??
        null;
      const unitCost = selectedSupplierPart?.lastKnownUnitCost
        ? parseFloat(selectedSupplierPart.lastKnownUnitCost)
        : 0;

      return sum + purchaseLineTotal(pendingPart.quantity, unitCost, selectedSupplierPart?.packSize, pendingPart.partDefinition.piecesPerPack);
    }, 0);
  }, [pendingParts, supplierPartsData]);

  // Reset state when dialog closes
  useEffect(() => {
    if (open) {
      measureUserAction("add-part-dialog-ready", "add-part-open", {
        materialListId,
      });
      return;
    }

    if (!open) {
      setPendingParts((prev) => (prev.length === 0 ? prev : []));
      setShowChosenParts(false);
      setQuantityPickerPreview(null);
      setPrefabView(null);
      setPrefabTarget(null);
      supplierPartResolutionPromisesRef.current.clear();
      setResolvingSupplierPartIds(new Set());
      resetWizard();
    }
  }, [open, resetWizard, materialListId]);



  const isWizardSearchActive =
    !showChosenParts && wizardSearchQuery.trim().length > 0;


  const closeDialogAndCleanHistory = () => onOpenChange(false);

  const pageTitle = prefabView
    ? (isToolRequest ? "Tool Prefabs" : "Material Prefabs")
    : prefabTarget
      ? `Add ${isToolRequest ? "Tools" : "Parts"} to ${prefabTarget.name}`
      : isToolRequest ? "Add Tools" : "Add Parts";
  const barButton =
    "h-9 min-h-9 w-full rounded-lg px-1.5 py-1 text-xs leading-tight whitespace-normal";

  // With the on-screen keyboard up, iOS keeps the layout the same height and
  // slides the page instead; fit Add Parts to the visible area above the
  // keyboard so the parts stay in view while searching.
  const [keyboardViewport, setKeyboardViewport] = useState<{
    top: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const update = () => {
      const keyboardOpen = window.innerHeight - viewport.height > 120;
      setKeyboardViewport(
        keyboardOpen ? { top: viewport.offsetTop, height: viewport.height } : null,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setKeyboardViewport(null);
    };
  }, [open]);

  const showStepsBar = open && !showChosenParts && !prefabView;
  // Catalog/material/size/category: the "Select …" heading stays top left and
  // the cards sit in the middle of the space below it (the step fills the
  // scroll area and its grid takes my-auto); long lists still scroll.
  const centerOptionCards =
    !prefabView &&
    !showChosenParts &&
    !isWizardSearchActive &&
    ["catalog", "material", "size", "category"].includes(wizardStage);
  useEffect(() => {
    if (!showStepsBar) return;
    document.body.dataset.flatHeader = "";
    return () => {
      delete document.body.dataset.flatHeader;
    };
  }, [showStepsBar]);

  /** One step back inside Add Parts. Returns false at the first step. */
  const stepBack = () => {
    if (isAddingParts) return true;
    if (quantityPickerPreview) { setQuantityPickerPreview(null); return true; }
    if (showChosenParts) { setShowChosenParts(false); return true; }
    if (prefabTarget) {
      setPendingParts([]);
      resetWizard();
      setPrefabView({ kind: "edit", prefabId: prefabTarget.id });
      setPrefabTarget(null);
      return true;
    }
    if (prefabView) {
      if (managePrefabs && prefabView.kind === "list") {closeDialogAndCleanHistory(); return true;}
      setPrefabView(prefabView.kind === "edit" ? { kind: "list" } : null);
      return true;
    }
    if (wizardSearchQuery.trim()) {
      setWizardSearchQuery("");
      return true;
    }
    const order = ["catalog", "material", "size", "category", "part"] as const;
    const index = order.indexOf(wizardStage);
    if (index > 0) {
      returnToStage(order[index - 1]!);
      return true;
    }
    return false;
  };

  useHeaderBackOverride(open ? () => {
    if (!stepBack()) closeDialogAndCleanHistory();
  } : null, { priority: 20 });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      closeDialogAndCleanHistory();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const pickerPart = quantityPickerParts.find(part => part.id === quantityPickerPreview?.partId);
  const bulkUnit = pickerPart?.bulkUnit || "pack";
  const bulkPlural = ({box: "boxes", pack: "packs", roll: "rolls", coil: "coils", length: "lengths"} as Record<string, string>)[bulkUnit] || bulkUnit;
  const pickerContents = packContents(pickerPart?.piecesPerPack);

  return (
    <SupplierLabelContext.Provider value={{entries: priceBookSnapshot?.entries ?? [], pending: !!listHeader?.jobId && !isToolRequest && !priceBookSnapshot}}>
      {open && (
        <div
          role="region"
          aria-label={pageTitle}
          data-tutorial="add-part-dialog"
          data-tutorial-stage={showChosenParts ? "chosen" : wizardStage}
          data-tutorial-pending-count={pendingParts.length}
          data-landscape-scope
          className={`fixed inset-x-0 flex flex-col overflow-hidden bg-canvas ${keyboardViewport ? "z-[60]" : "app-below-header bottom-0 z-[45]"} ${quantityPickerPreview ? "touch-none" : ""}`}
          style={
            keyboardViewport
              ? { top: keyboardViewport.top, height: keyboardViewport.height }
              : undefined
          }
        >
          {showStepsBar && (
            // Raised like the app bar above it (which drops its own shadow
            // while this shows), so the steps read as part of the top bar.
            <LandscapeSubBar className="relative z-10 shrink-0 bg-card shadow-[0_2px_3px_rgba(0,0,0,0.35),0_6px_16px_rgba(0,0,0,0.6)]">
              <div className="mx-auto w-full max-w-6xl px-2 pt-1 pb-2 sm:px-4 sm:pb-3 md:px-6 [[data-landscape-subbar]_&]:p-0">
                <WizardHeader
                  currentStage={wizardStage}
                  selectedCatalog={selectedCatalogName}
                  selectedMaterial={selectedMaterialName}
                  selectedSize={selectedSizeName}
                  selectedCategory={selectedCategoryName}
                  onStageClick={handleStageClick}
                />
              </div>
            </LandscapeSubBar>
          )}
          <div className="relative mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
          {catalogueDownloading && (
          <div className="shrink-0 px-2 pt-2 sm:px-4 md:px-6">
              <p
                role="status"
                className="text-muted-foreground flex items-center gap-2 text-xs"
              >
                <span className="border-primary/30 border-t-primary inline-block size-3 animate-spin rounded-full border-2" />
                Saving the catalogue to this device for offline use. You can
                keep working meanwhile.
              </p>
          </div>
          )}

          {prefabTarget && (
            <div className="mx-2 mt-2 mb-2 flex shrink-0 items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-1.5 text-xs sm:mx-4 sm:text-sm md:mx-6">
              <span className="min-w-0 truncate">
                Picking parts for prefab <span className="font-semibold">{prefabTarget.name}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2"
                onClick={() => {
                  setPendingParts([]);
                  resetWizard();
                  setPrefabView({ kind: "edit", prefabId: prefabTarget.id });
                  setPrefabTarget(null);
                }}
              >
                Back to prefab
              </Button>
            </div>
          )}


          <ArcScrollerSurface onBack={wizardStage === "catalog" ? undefined : () => { stepBack(); }} usage={orderWheelUsage} enabled={!prefabView && !showChosenParts && !isWizardSearchActive && ["catalog", "material", "size", "category"].includes(wizardStage) && !quantityPickerPreview}
            data-tutorial={`wizard-${isWizardSearchActive ? "part" : wizardStage}`}
            className={`flex-1 space-y-2 overflow-y-auto overscroll-contain pt-2 pb-3 sm:space-y-4 sm:pt-4 sm:pb-4 ${showChosenParts ? "px-4 sm:px-6" : "px-2 sm:px-4 md:px-6"} ${quantityPickerPreview ? "touch-none overflow-hidden" : ""} @container ${centerOptionCards ? "flex flex-col [&_.wizard-option-grid]:my-auto [&>*:last-child]:flex [&>*:last-child]:flex-1 [&>*:last-child]:flex-col" : ""}`}
          >
            {!isOnline && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    Offline add uses the cached catalogue on this device.
                  </p>
                  <p>
                    Reconnect once if the part, supplier, or price you need is
                    missing.
                  </p>
                </div>
              </div>
            )}
            {prefabView ? (
              <PrefabsPanel
                priceBook={jobPriceBook}
                kind={isToolRequest ? "tools" : "materials"}
                onKindChange={kind => { setManagedPrefabKind(kind); setPrefabTarget(null); setPendingParts([]); resetWizard(); setPrefabView({kind:"list"}); }}
                materialListId={materialListId}
                listItems={managePrefabs ? [] : listItems}
                view={prefabView}
                managementOnly={managePrefabs}
                onViewChange={view => {if (!view && managePrefabs) closeDialogAndCleanHistory(); else setPrefabView(view);}}
                onAddParts={(prefab) => {
                  setPendingParts([]);
                  resetWizard();
                  setPrefabTarget(prefab);
                  setPrefabView(null);
                }}
                onAdded={closeDialogAndCleanHistory}
                isOnline={isOnline}
                addedBy={
                  currentUser
                    ? { id: currentUser.id, name: currentUser.name, email: currentUser.email, department: currentUser.department ?? null }
                    : null
                }
              />
            ) : (<>
            {!showChosenParts && <>{isWizardSearchActive ? (
              <PartStage
                partsForSelection={filteredPartsForSelection}
                pendingParts={pendingParts}
                onPartSelect={handlePartSelect}
                onPartQuantitySet={handlePartQuantitySet}
                onQuantityPickerPreviewChange={setQuantityPickerPreview}
                onEditPart={handleEditPart}




                title="Matching Parts"
                emptyMessage={
                  isOnline
                    ? undefined
                    : "No cached parts match this search/filter. Reconnect once to refresh the catalogue cache."
                }
              />
            ) : (
              wizardStage === "catalog" && (<>
                <CatalogStage
                  onPrefabsSelect={
                    !prefabTarget
                      ? () => setPrefabView({ kind: "list" })
                      : undefined
                  }
                  catalogs={catalogsWithCounts}
                  selectedCatalogId={selectedCatalogId}
                  allSelected={
                    hasCatalogSelection && selectedCatalogId === null
                  }
                  onCatalogSelect={handleCatalogSelect}
                  showCustomCatalogInput={showCustomCatalogInput}
                  onShowCustomCatalogInput={setShowCustomCatalogInput}
                  customCatalogName={customCatalogName}
                  onCustomCatalogNameChange={setCustomCatalogName}
                  onCreateCatalog={createCatalog}
                  isOnline={isOnline}
                />
              </>)
            )}
            {!isWizardSearchActive && wizardStage === "material" && (
              <MaterialStage
                materials={materialsWithCounts}
                selectedMaterialId={selectedMaterialId}
                allSelected={
                  hasMaterialSelection && selectedMaterialId === null
                }
                onMaterialSelect={handleMaterialSelect}
                showCustomMaterialInput={showCustomMaterialInput}
                onShowCustomMaterialInput={setShowCustomMaterialInput}
                customMaterialName={customMaterialName}
                onCustomMaterialNameChange={setCustomMaterialName}
                onCreateMaterial={createMaterial}
                isOnline={isOnline}
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
                isOnline={isOnline}
              />
            )}
            {!isWizardSearchActive && wizardStage === "category" && (
              <CategoryStage
                categories={categoriesWithCounts}
                selectedCategory={selectedCategory}
                allSelected={
                  hasCategorySelection && selectedCategory?.categoryId === null
                }
                onCategorySelect={handleCategorySelection}
                showCustomCategoryInput={showCustomCategoryInput}
                onShowCustomCategoryInput={setShowCustomCategoryInput}
                customCategoryName={customCategoryName}
                onCustomCategoryNameChange={setCustomCategoryName}
                onCustomCategorySubmit={handleCustomCategorySubmit}
                isOnline={isOnline}
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




                emptyMessage={
                  isOnline
                    ? undefined
                    : "No cached parts match this selection. Reconnect once to refresh the catalogue cache."
                }
              />
            )}
            </>}
            {showChosenParts && (
              <ChosenPartsView
                onQuantityPickerPreviewChange={setQuantityPickerPreview}
                pendingParts={pendingParts}
                supplierPartsData={supplierPartsData}
                onUpdateQuantity={handleUpdateQuantity}
                onSetQuantity={handleSetQuantity}
                onUpdateSupplier={handleUpdateSupplier}
                onCacheSupplierPart={handleCacheSupplierPart}
                onSupplierPartResolutionStart={
                  handleSupplierPartResolutionStart
                }
                onRemovePendingPart={handleRemovePendingPart}
                allPartsHaveSuppliers={allPartsHaveSuppliers}
                isToolRequest={isToolRequest}
              />
            )}
            </>)}
          </ArcScrollerSurface>

          {/* Bottom bar, laid out like the material list's */}
          <div data-bottom-menu className={`shrink-0 border-t bg-card px-4 pt-2 sm:px-6 ${keyboardViewport ? "pb-1.5" : "pb-[calc(0.5rem+env(safe-area-inset-bottom))]"}`}>
            <div>
              <PriorityActionBar
                tabAction={!prefabView ? (
                  <button type="button" data-action-bar-tab data-tutorial="wizard-chosen-toggle" className="whitespace-nowrap"
                    aria-pressed={showChosenParts}
                    disabled={isAddingParts}
                    onClick={() => setShowChosenParts(shown => !shown)}>
                    <ListChecksIcon aria-hidden />
                    {showChosenParts ? `Select ${isToolRequest ? "Tools" : "Parts"}` : `Basket (${pendingParts.length})`}
                  </button>
                ) : undefined}
                label={!prefabView && !isToolRequest ? (
                  <FinancialOnly><span className="text-muted-foreground">Basket Total</span><span className="font-bold tabular-nums">${chosenPartsTotal.toFixed(2)}</span></FinancialOnly>
                ) : undefined}
              >
                {prefabView || showChosenParts ? (
                  <Button variant="outline" className={barButton} onClick={closeDialogAndCleanHistory} disabled={isAddingParts}>
                    <XIcon className="mr-1 h-3.5 w-3.5 shrink-0" />Cancel
                  </Button>
                ) : <>
                    {canCreateParts && <Button
                      variant="outline"
                      className={barButton}
                      disabled={!isOnline}
                      onClick={() =>
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
                    >
                      <PackagePlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                      {isOnline ? "Create Part" : "Create (online)"}
                    </Button>}
                    <div className="relative min-w-0">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                      {/* A plain search field: no autofill, autocorrect or
                          suggestions, so phones skip their extra keyboard bars. */}
                      <Input
                        type="search"
                        inputMode="search"
                        enterKeyHint="search"
                        name="part-search"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        value={wizardSearchQuery}
                        onChange={(event) => setWizardSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        placeholder="Search"
                        aria-label="Search parts"
                        className="h-9 w-full rounded-lg pl-8 text-sm [&::-webkit-search-cancel-button]:appearance-none"
                      />
                    </div>
                </>}
                {!prefabView && <Button
                  className={barButton} onClick={handleAddToMaterialList}
                  data-tutorial="wizard-confirm"
                  disabled={pendingParts.length === 0 || isAddingParts}
                >
                  <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                  {isAddingParts ? "Adding..." : `Add ${pendingParts.length} ${isToolRequest ? "Tool" : "Part"}${pendingParts.length !== 1 ? "s" : ""}${prefabTarget ? " to Prefab" : ""}`}
                </Button>}
              </PriorityActionBar>
            </div>
          </div>

          {quantityPickerPreview && (
            <VerticalPickerOverlay<number>
              className="absolute"
              title="Quantity"
              description={pickerContents > 1 ? `${pickerContents.toLocaleString("en-CA")} ${pickerPart?.individualUnit ?? "pcs"} per ${bulkUnit}` : undefined}
              centerIndex={quantityPickerPreview.quantity}
              getItemFontSize={value => value === -1 ? "2rem" : undefined}
              getItem={(value) => (value < (pickerContents > 1 ? -1 : 0) ? null : value)}
              renderItem={(value) => {
                if (value === -1) return <ArrowLeftRight className="h-12 w-12" aria-label={`Switch to ${quantityPickerPreview.mode === "individual" ? bulkUnit : individualUnitLabel(pickerPart?.individualUnit)}`} />;
                if (quantityPickerPreview.mode === "individual") return `${value.toLocaleString("en-CA")} ${pickerPart?.individualUnit ?? "pcs"}`;
                return pickerContents > 1 ? `${value.toLocaleString("en-CA")} ${value === 1 ? bulkUnit : bulkPlural}` : value.toLocaleString("en-CA");
              }}
            />
          )}
          </div>
        </div>
      )}

      {isCreateCustomPartDialogOpen && (
        <CreateCustomPartDialog
          catalogKind={selectingTools ? "assets" : "materials"}
          open={isCreateCustomPartDialogOpen}
          onOpenChange={setIsCreateCustomPartDialogOpen}
          onPartCreated={handleCustomPartCreated}
          initialContext={customPartContext ?? undefined}
        />
      )}

      {editingPartId !== null && (
        <EditPartDialog
          catalogKind={selectingTools ? "assets" : "materials"}
          open={editingPartId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingPartId(null);
          }}
          partId={editingPartId}
        />
      )}
    </SupplierLabelContext.Provider>
  );
}
