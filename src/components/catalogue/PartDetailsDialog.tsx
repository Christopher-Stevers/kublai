"use client";

import { isPartSizeInput, normalizePartSize } from "~/lib/part-size-input";
import { confirmAction } from "~/components/ui/app-dialogs";
import { appendQuantityDescription } from "~/lib/pack-quantity";
import { notify } from "~/components/ui/app-dialogs";
import {
  FinancialOnly,
  useFinancialVisibility,
} from "~/components/permissions/FinancialVisibility";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  Search,
  Share2,
  Star,
  Upload,
  X,
} from "lucide-react";
import { api } from "~/trpc/react";
import {
  formatSize,
  formatSizeDecimal,
  formatSizeDimensions,
  generatePartDisplayName,
  parsePrimarySizeInput,
} from "~/lib/size-utils";
import { useOnlineStatus } from "~/hooks/use-online-status";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { isValidOrderMultiple } from "~/lib/purchase-quantity";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";
import { requestCatalogueReplicachePull } from "~/lib/replicache-catalogue";

function FieldHeader({
  label,
  onAdd,
  addLabel = "+ Add",
}: {
  label: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label>{label}</Label>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="text-primary text-xs font-medium hover:underline"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}

function QuantityUnitField({label, value, onChange, options, onAdd, disabled}: {
  label:string; value:string; onChange:(value:string)=>void; options:string[];
  onAdd:(name:string)=>Promise<void>; disabled:boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <div><FieldHeader label={label} onAdd={() => {setAdding(!adding); setError("");}} />
    {adding ? <div className="mt-1 flex min-w-0 gap-2"><Input aria-label={`New ${label.toLowerCase()}`} maxLength={32} value={name} onChange={e=>setName(e.target.value)} disabled={saving} /><Button type="button" variant="outline" disabled={disabled || saving || !name.trim()} onClick={async()=>{
      setSaving(true); setError("");
      try {await onAdd(name.trim()); onChange(name.trim().toLowerCase()); setName(""); setAdding(false);} catch {setError("Could not add unit. Try again.");} finally {setSaving(false);}
    }}>Add</Button></div> : <select aria-label={label} className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>
      <option value="">Select unit</option>{Array.from(new Set([...options, ...(value ? [value] : [])])).sort().map(unit=><option key={unit} value={unit}>{unit}</option>)}
    </select>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}

function normalizeCurrencyInput(value: string) {
  return value.replace(/[^0-9.-]/g, "").trim();
}

function formatCurrencyInput(value: string) {
  const normalized = normalizeCurrencyInput(value);
  if (!normalized) return "";
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
}


function buildPartName({
  description,
  materialName,
  sizeValue,
  sizeUnitCode,
}: {
  description: string;
  materialName?: string | null;
  sizeValue: string;
  sizeUnitCode?: string | null;
}) {
  return generatePartDisplayName({
    sizeNominal: sizeValue,
    sizeUnit: sizeUnitCode,
    material: materialName,
    description,
  });
}

function handleAddableLookup<T extends { id: string; name: string }>({
  name,
  items,
  select,
  reset,
  create,
}: {
  name: string;
  items: T[] | undefined;
  select: (id: string) => void;
  reset: () => void;
  create: (name: string) => void;
}) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  const existing = items?.find(
    (item) => item.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  );

  if (existing) {
    select(existing.id);
    reset();
    return;
  }

  reset();
  create(trimmedName);
}

async function uploadPartImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/catalogue/images", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(errorBody?.error ?? "Image upload failed");
  }

  const body = (await response.json()) as { url?: string };
  if (!body.url) {
    throw new Error("Image upload did not return a URL");
  }

  return body.url;
}

function normalizePartImageUrlInput(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("api/catalogue/images/")) {
    return `/${trimmed}`;
  }
  if (trimmed.startsWith("images/catalog/uploads/")) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function isStoredCatalogueImageUrl(value: string) {
  return (
    value.startsWith("/api/catalogue/images/") ||
    value.startsWith("/images/catalog/uploads/")
  );
}

interface PartDetailsDialogProps {
  mode: "create" | "edit";
  /** materials (default) or assets: which catalogs the picker offers. */
  catalogKind?: "materials" | "assets";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partId?: string | null;
  initialContext?: {
    catalogId?: string | null;
    materialId?: string | null;
    size?: { nominal: number; unit: string; sizeLabel?: string | null } | null;
    categoryId?: string | null;
    categoryName?: string | null;
  };
  onPartCreated?: (part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    supplierPartId?: string;
    piecesPerPack?: number | null;
    bulkUnit?: string | null;
    individualUnit?: string | null;
  }) => void;
}

export function PartDetailsDialog({
  mode,
  open,
  onOpenChange,
  partId,
  initialContext,
  onPartCreated,
  catalogKind = "materials",
}: PartDetailsDialogProps) {
  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const isEditMode = mode === "edit";

  const { data: part, isLoading: isLoadingPart } =
    api.catalogue.getPart.useQuery(
      { partId: partId! },
      { enabled: isOnline && open && isEditMode && !!partId },
    );

  const { data: catalogs } = api.catalogue.getCatalogs.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const { data: materials } = api.catalogue.getMaterials.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery(
    undefined,
    {
      enabled: isOnline && open,
    },
  );
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const { data: suppliers } = api.supplier.list.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const { data: partSupplierParts } =
    api.supplier.getSupplierPartsByPart.useQuery(
      { partDefinitionId: partId! },
      { enabled: isOnline && open && isEditMode && !!partId },
    );
  const [displayName, setDisplayName] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const quantityUnits = api.catalogue.getQuantityUnits.useQuery(undefined, {enabled:open});
  const createQuantityUnit = api.catalogue.createQuantityUnit.useMutation();
  const [bulkUnit, setBulkUnit] = useState("");
  const [individualUnit, setIndividualUnit] = useState("");
  const [hasManuallyEditedDisplayName, setHasManuallyEditedDisplayName] =
    useState(false);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [catalogId, setCatalogId] = useState<string | null>(null);
  /** Tool types: each unit tagged (serialized) or counted (quantity). */
  const [assetTracking, setAssetTracking] = useState<"serialized" | "quantity">(
    "serialized",
  );
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnitId, setSizeUnitId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSku, setSupplierSku] = useState("");
  const [lastKnownUnitCost, setLastKnownUnitCost] = useState("");
  const [packSize, setPackSize] = useState("1");
  const [preferredSupplierId, setPreferredSupplierId] = useState<string | null>(
    null,
  );
  const [supplierFieldDrafts, setSupplierFieldDrafts] = useState<
    Record<
      string,
      { supplierSku: string; lastKnownUnitCost: string; packSize: string }
    >
  >({});
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [showNewCatalogInput, setShowNewCatalogInput] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState("");
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewMaterialInput, setShowNewMaterialInput] = useState(false);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isGoogleImagePickerOpen, setIsGoogleImagePickerOpen] = useState(false);
  const [isFamilyImageSuggestionsOpen, setIsFamilyImageSuggestionsOpen] =
    useState(false);
  const [dismissedFamilySuggestionIds, setDismissedFamilySuggestionIds] =
    useState<Set<string>>(() => new Set());
  const [copiedPartUuid, setCopiedPartUuid] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  useEffect(() => {
    if (open) setShowMoreDetails(false);
  }, [open]);
  const [isSubmittingInBackground, setIsSubmittingInBackground] =
    useState(false);
  const [showInvalidSizeInputFlash, setShowInvalidSizeInputFlash] =
    useState(false);

  const { data: selectedSupplierDetails } = api.supplier.getById.useQuery(
    { id: supplierId! },
    { enabled: isOnline && open && !isEditMode && !!supplierId },
  );

  const sizeUnits = useMemo(
    () => allUnits?.filter((u) => u.kind === "length") ?? [],
    [allUnits],
  );
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const initializedForOpenRef = useRef(false);
  const sizeInputFlashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      setSubmitError(null);
      setIsFamilyImageSuggestionsOpen(false);
      setDismissedFamilySuggestionIds(new Set());
      setCopiedPartUuid(false);
      setIsSubmittingInBackground(false);
      setShowInvalidSizeInputFlash(false);
      if (sizeInputFlashTimeoutRef.current) {
        clearTimeout(sizeInputFlashTimeoutRef.current);
        sizeInputFlashTimeoutRef.current = null;
      }
    }
  }, [open]);

  const flashInvalidSizeInput = () => {
    if (sizeInputFlashTimeoutRef.current) {
      clearTimeout(sizeInputFlashTimeoutRef.current);
    }
    setShowInvalidSizeInputFlash(false);
    window.setTimeout(() => {
      setShowInvalidSizeInputFlash(true);
      sizeInputFlashTimeoutRef.current = window.setTimeout(() => {
        setShowInvalidSizeInputFlash(false);
        sizeInputFlashTimeoutRef.current = null;
      }, 450);
    }, 0);
  };

  const handleSizeValueChange = (nextValue: string) => {
    if (!isPartSizeInput(nextValue)) {
      flashInvalidSizeInput();
      return;
    }

    setSizeValue(nextValue.replace(/X/g, "x"));
  };

  useEffect(() => {
    if (!open || initializedForOpenRef.current) return;

    if (isEditMode && part) {
      setDisplayName(part.displayName ?? "");
      setPiecesPerPack(part.piecesPerPack ? String(part.piecesPerPack) : "");
      setBulkUnit(part.bulkUnit ?? "");
      setIndividualUnit(part.individualUnit ?? "");
      setDescription(part.description ?? "");
      setImageUrl(part.imageUrl ?? "");
      setAliasesText(
        part.aliases?.map((alias) => alias.synonym).join("\n") ?? "",
      );
      setCatalogId(part.catalogId ?? null);
      setAssetTracking(
        part.assetTracking === "quantity" ? "quantity" : "serialized",
      );
      setCategoryId(part.categoryId ?? null);
      setMaterialId(part.materialId ?? null);
      setSizeValue(part.sizeLabel ?? formatSizeDecimal(part.sizeNominal));
      setSizeUnitId(part.sizeUnitId ?? null);
      setIsActive(part.isActive ?? true);
      setSupplierId(null);
      setSupplierSku("");
      setPackSize("1");
      setLastKnownUnitCost("");
      setPreferredSupplierId(null);
      setSupplierFieldDrafts({});
      setHasManuallyEditedDisplayName(true);
      initializedForOpenRef.current = true;
      return;
    }

    if (!isEditMode) {
      if (initialContext?.size?.unit && !allUnits) {
        return;
      }

      setDisplayName("");
      setPiecesPerPack("");
      setBulkUnit("");
      setIndividualUnit("");
      setDescription("");
      setImageUrl("");
      setAliasesText("");
      setCatalogId(initialContext?.catalogId ?? null);
      setAssetTracking("serialized");
      setCategoryId(initialContext?.categoryId ?? null);
      setMaterialId(initialContext?.materialId ?? null);
      setSizeValue(
        initialContext?.size?.sizeLabel ??
          formatSizeDecimal(initialContext?.size?.nominal ?? null),
      );
      setIsActive(true);
      setSupplierId(null);
      setSupplierSku("");
      setPackSize("1");
      setLastKnownUnitCost("");
      setPreferredSupplierId(null);
      setSupplierFieldDrafts({});
      setHasManuallyEditedDisplayName(false);

      if (initialContext?.size?.unit && allUnits) {
        const matchedUnit = allUnits.find(
          (unit) => unit.code === initialContext.size?.unit,
        );
        setSizeUnitId(matchedUnit?.id ?? null);
      } else {
        setSizeUnitId(null);
      }
      initializedForOpenRef.current = true;
    }
  }, [open, isEditMode, part, initialContext, allUnits]);

  useEffect(() => {
    if (!open || isEditMode || hasManuallyEditedDisplayName) {
      return;
    }

    setDisplayName(
      buildPartName({
        description: appendQuantityDescription(description, Number(piecesPerPack), individualUnit, bulkUnit),
        materialName: materials?.find((material) => material.id === materialId)
          ?.name,
        sizeValue,
        sizeUnitCode: sizeUnits.find((unit) => unit.id === sizeUnitId)?.code,
      }),
    );
  }, [
    open,
    isEditMode,
    hasManuallyEditedDisplayName,
    description,
    piecesPerPack,
    individualUnit,
    bulkUnit,
    materials,
    materialId,
    sizeValue,
    sizeUnits,
    sizeUnitId,
  ]);

  const matchingSelectedSupplierPart = useMemo(() => {
    const normalizedName = displayName.trim().toLowerCase();
    if (!normalizedName || !selectedSupplierDetails?.supplierParts) return null;
    return (
      selectedSupplierDetails.supplierParts.find(
        (supplierPart) =>
          supplierPart.partDefinition?.displayName.trim().toLowerCase() ===
          normalizedName,
      ) ?? null
    );
  }, [displayName, selectedSupplierDetails]);

  const selectedSupplierDraft = supplierId
    ? supplierFieldDrafts[supplierId]
    : undefined;

  useEffect(() => {
    if (!supplierId) return;

    if (selectedSupplierDraft) {
      setSupplierSku(selectedSupplierDraft.supplierSku);
      setLastKnownUnitCost(selectedSupplierDraft.lastKnownUnitCost);
      setPackSize(selectedSupplierDraft.packSize);
      return;
    }

    const selected = isEditMode
      ? partSupplierParts?.find((sp) => sp.supplierId === supplierId)
      : matchingSelectedSupplierPart;
    setPackSize(selected?.packSize ?? "1");
    setSupplierSku(selected?.supplierSku ?? "");
    setLastKnownUnitCost(selected?.lastKnownUnitCost?.toString() ?? "");
  }, [
    isEditMode,
    matchingSelectedSupplierPart,
    partSupplierParts,
    selectedSupplierDraft,
    supplierId,
  ]);

  useEffect(() => {
    if (!open || !isEditMode || !partSupplierParts?.length || supplierId)
      return;

    const initialSupplierPart =
      partSupplierParts.find((supplierPart) => supplierPart.isPreferred) ??
      partSupplierParts[0];
    if (!initialSupplierPart) return;

    setSupplierId(initialSupplierPart.supplierId);
    setSupplierSku(initialSupplierPart.supplierSku ?? "");
    setPackSize(initialSupplierPart.packSize ?? "1");
    setLastKnownUnitCost(
      formatCurrencyInput(
        initialSupplierPart.lastKnownUnitCost?.toString() ?? "",
      ),
    );
    if (initialSupplierPart.isPreferred) {
      setPreferredSupplierId(initialSupplierPart.supplierId);
    }
  }, [isEditMode, open, partSupplierParts, supplierId]);

  const saveSupplierFieldDraft = (draftSupplierId: string) => {
    setSupplierFieldDrafts((current) => ({
      ...current,
      [draftSupplierId]: { supplierSku, lastKnownUnitCost, packSize },
    }));
  };

  const handleSupplierSelect = (nextSupplierId: string | null) => {
    if (supplierId) {
      saveSupplierFieldDraft(supplierId);
    }

    setSupplierId(nextSupplierId);
    if (nextSupplierId && !preferredSupplierId) {
      setPreferredSupplierId(nextSupplierId);
    }
    if (!nextSupplierId) {
      setSupplierSku("");
      setPackSize("1");
      setLastKnownUnitCost("");
    }
  };

  const handleSupplierSkuChange = (value: string) => {
    setSupplierSku(value);
    if (!supplierId) return;
    setSupplierFieldDrafts((current) => ({
      ...current,
      [supplierId]: {
        supplierSku: value,
        lastKnownUnitCost,
        packSize,
      },
    }));
  };

  const handleLastKnownUnitCostChange = (value: string) => {
    setLastKnownUnitCost(value);
    if (!supplierId) return;
    setSupplierFieldDrafts((current) => ({
      ...current,
      [supplierId]: {
        supplierSku,
        lastKnownUnitCost: value,
        packSize,
      },
    }));
  };

  const createPart = api.catalogue.createPart.useMutation({
    onSuccess: async (newPart) => {
      let supplierPartId: string | undefined;
      if (supplierId) {
        try {
          const supplierParts =
            await utils.supplier.getSupplierPartsByPart.fetch({
              partDefinitionId: newPart.id,
            });
          supplierPartId = supplierParts.find(
            (sp) => sp.supplierId === supplierId,
          )?.id;
        } catch (error) {
          console.error("Error fetching supplier part", error);
        }
      }

      onPartCreated?.({
        id: newPart.id,
        displayName: newPart.displayName,
        piecesPerPack: newPart.piecesPerPack,
        bulkUnit: newPart.bulkUnit,
        individualUnit: newPart.individualUnit,
        imageUrl: newPart.imageUrl,
        material: newPart.material,
        size:
          newPart.sizeLabel ??
          (newPart.sizeUnit
            ? formatSize(newPart.sizeNominal, newPart.sizeUnit.code)
            : null),
        supplierPartId,
      });

      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPartWizardSummary.invalidate();
      void utils.catalogue.getPart.invalidate();
    },
    onError: (error) => {
      console.error("Could not create part", error);
      setSubmitError(
        error.message || "Could not create part. Please try again.",
      );
      setIsSubmittingInBackground(false);
    },
  });

  const [checkingDelete, setCheckingDelete] = useState(false);
  const deletePart = api.catalogue.deletePart.useMutation();
  const handlePermanentDelete = async () => {
    if (!partId || !isOnline) return;
    setCheckingDelete(true);
    setSubmitError(null);
    try {
      const usage = await utils.catalogue.getPartDeletionUsage.fetch({partId});
      if (!usage.canDelete) {
        setSubmitError(`Cannot delete: this part is used in ${[...new Set(usage.usages.map(item => item.label))].join(", ")}. Turn off “Show in catalogue” to hide it while keeping existing records.`);
        return;
      }
      const confirmed = await confirmAction({title: "Permanently delete this part?", description: `“${usage.name}” is unused. This permanently removes the part and its supplier listings. This cannot be undone.`, confirmLabel: "Delete permanently", destructive: true});
      if (!confirmed) return;
      await deletePart.mutateAsync({partId});
      await utils.catalogue.invalidate();
      requestCatalogueReplicachePull(0);
      onOpenChange(false);
    } catch (error) { setSubmitError(error instanceof Error ? error.message : "Could not delete this part."); }
    finally {setCheckingDelete(false);}
  };
  const updatePart = api.catalogue.updatePart.useMutation({
    onSuccess: () => {
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPartWizardSummary.invalidate();
      void utils.catalogue.getPart.invalidate();
    },
    onError: (error) => {
      console.error("Could not save part", error);
      setSubmitError(error.message || "Could not save part. Please try again.");
      setIsSubmittingInBackground(false);
    },
  });

  const applyGooglePartImage = api.catalogue.applyGooglePartImage.useMutation({
    onSuccess: (result) => {
      setImageUrl(result.imageUrl);
      setIsGoogleImagePickerOpen(false);
      setSubmitError(null);
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPartWizardSummary.invalidate();
      void utils.catalogue.getPart.invalidate();
    },
    onError: (error) => {
      setSubmitError(error.message || "Could not add selected Google image.");
    },
  });

  const selectedCategory = categoryTree?.find(
    (category) => category.id === categoryId,
  );
  const selectedMaterial = materials?.find(
    (material) => material.id === materialId,
  );
  const previewImageUrl = normalizePartImageUrlInput(imageUrl);
  // With an image, offer it to similar parts; without one, borrow theirs.
  const familyImageMode: "share" | "get" = previewImageUrl ? "share" : "get";
  const familyImageSuggestionInput = isEditMode
    ? { partId: partId!, mode: familyImageMode }
    : {
        mode: familyImageMode,
        draft: {
          displayName: isEditMode ? displayName.trim() : appendQuantityDescription(displayName, Number(piecesPerPack), individualUnit, bulkUnit),
      piecesPerPack: piecesPerPack.trim() ? Number(piecesPerPack) : null,
      bulkUnit: bulkUnit.trim() || null,
      individualUnit: individualUnit.trim() || null,
          description: appendQuantityDescription(description, Number(piecesPerPack), individualUnit, bulkUnit) || null,
          categoryName: selectedCategory?.name ?? null,
          materialId,
          materialName: selectedMaterial?.name ?? null,
        },
      };

  const {
    data: familyImageSuggestions,
    isFetching: isLoadingFamilySuggestions,
  } = api.catalogue.getPartImageFamilySuggestions.useQuery(
    familyImageSuggestionInput,
    {
      enabled:
        isOnline &&
        isFamilyImageSuggestionsOpen &&
        (isEditMode ? !!partId : !!displayName.trim()),
    },
  );

  const applyFamilyPartImage =
    api.catalogue.applyPartImageToFamilyCandidate.useMutation({
      onSuccess: () => {
        void utils.catalogue.searchParts.invalidate();
        void utils.catalogue.getPartWizardSummary.invalidate();
        void utils.catalogue.getPart.invalidate();
      },
      onError: (error) => {
        setSubmitError(error.message || "Could not apply image to this part.");
      },
    });

  const applyRemoteGoogleImageUrl = async (remoteImageUrl: string) => {
    const trimmedUrl = normalizePartImageUrlInput(remoteImageUrl);
    if (!trimmedUrl) return;

    if (!isEditMode || !partId) {
      setImageUrl(trimmedUrl);
      setIsGoogleImagePickerOpen(false);
      return;
    }

    if (isStoredCatalogueImageUrl(trimmedUrl)) {
      setImageUrl(trimmedUrl);
      await updatePart.mutateAsync({ partId, imageUrl: trimmedUrl });
      setIsGoogleImagePickerOpen(false);
      return;
    }

    applyGooglePartImage.mutate({
      partId,
      imageUrl: trimmedUrl,
      sourceUrl: trimmedUrl,
      sourceTitle: "Google Images manual selection",
    });
  };

  const attachUploadedImageToPart = async (file: File) => {
    const uploadedUrl = await uploadPartImage(file);
    setImageUrl(uploadedUrl);

    if (isEditMode && partId) {
      await updatePart.mutateAsync({ partId, imageUrl: uploadedUrl });
    }

    setIsGoogleImagePickerOpen(false);
  };

  const handleGoogleClipboardPaste = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setSubmitError("Clipboard access is not available in this browser.");
      return;
    }

    setSubmitError(null);

    try {
      setIsProcessingImage(true);

      if ("read" in navigator.clipboard) {
        const clipboardItems = await navigator.clipboard.read().catch(() => []);
        for (const item of clipboardItems) {
          const imageType = item.types.find((type) =>
            type.toLowerCase().startsWith("image/"),
          );
          if (!imageType) continue;

          const blob = await item.getType(imageType);
          const extension = imageType.split("/")[1] || "png";
          await attachUploadedImageToPart(
            new File([blob], `google-image.${extension}`, { type: imageType }),
          );
          return;
        }
      }

      const pastedText = (await navigator.clipboard.readText()).trim();
      if (!pastedText) {
        setSubmitError("Clipboard does not contain an image or image URL.");
        return;
      }

      await applyRemoteGoogleImageUrl(pastedText);
    } catch (error) {
      console.error("Failed to read image from clipboard", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to read image from clipboard",
      );
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleGoogleImagePaste = async (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    const pastedImage = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();

    if (!pastedImage) return;

    event.preventDefault();
    setSubmitError(null);

    try {
      setIsProcessingImage(true);
      await attachUploadedImageToPart(pastedImage);
    } catch (error) {
      console.error("Failed to process pasted image", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to process pasted image",
      );
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSupplierCreated = (newSupplierId: string) => {
    handleSupplierSelect(newSupplierId);
    setIsSupplierDialogOpen(false);
  };

  const createCatalog = api.catalogue.createCatalog.useMutation({
    onSuccess: (newCatalog) => {
      if (!newCatalog) return;
      setCatalogId(newCatalog.id);
      setNewCatalogName("");
      setShowNewCatalogInput(false);
      requestCatalogueReplicachePull(0);
      void utils.catalogue.getCatalogs.invalidate();
    },
  });

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      if (!newCategory) return;
      void utils.catalogue.getCategoryTree.invalidate();
      setCategoryId(newCategory.id);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
      requestCatalogueReplicachePull(0);
    },
  });

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (!newMaterial) return;
      setMaterialId(newMaterial.id);
      setNewMaterialName("");
      setShowNewMaterialInput(false);
      requestCatalogueReplicachePull(0);
      void utils.catalogue.getMaterials.invalidate();
    },
  });

  const createSize = api.catalogue.createSize.useMutation({
    onSuccess: () => {
      void utils.catalogue.getAvailableSizes.invalidate();
    },
  });

  const parsedSizeNominal = sizeValue.trim()
    ? parsePrimarySizeInput(sizeValue.trim())
    : null;
  const isLoading =
    checkingDelete || deletePart.isPending ||
    createPart.isPending ||
    updatePart.isPending ||
    isProcessingImage ||
    isSubmittingInBackground;
  const isReviewingPhoto = applyGooglePartImage.isPending;
  const hasFamilyImageSuggestionSource = isEditMode
    ? !!partId
    : !!displayName.trim();
  const selectedCatalog = catalogs?.find((catalog) => catalog.id === catalogId);
  const isToolType = selectedCatalog?.kind === "assets";
  // Only offer catalogs of this screen's kind (plus the part's own catalog).
  const pickerCatalogs = (catalogs ?? []).filter(
    (catalog) =>
      (catalog.kind === "assets" ? "assets" : "materials") === catalogKind ||
      catalog.id === catalogId,
  );
  const selectedSizeUnit = sizeUnits.find((unit) => unit.id === sizeUnitId);
  const googleImageSearchQuery = displayName.trim();
  const googleImageSearchUrl =
    "https://www.google.com/search?tbm=isch&q=" +
    encodeURIComponent(googleImageSearchQuery || displayName);
  // "Get" mode: one row per distinct image, listing the parts that use it.
  const familyImageChoices = useMemo(() => {
    const byImage = new Map<string, string[]>();
    for (const suggestion of familyImageSuggestions?.suggestions ?? []) {
      if (!suggestion.imageUrl) continue;
      byImage.set(suggestion.imageUrl, [
        ...(byImage.get(suggestion.imageUrl) ?? []),
        suggestion.displayName,
      ]);
    }
    return [...byImage.entries()]
      .map(([imageUrl, partNames]) => ({ imageUrl, partNames }))
      .sort((a, b) => b.partNames.length - a.partNames.length);
  }, [familyImageSuggestions]);

  const useFamilyImage = async (imageUrl: string) => {
    setSubmitError(null);
    await applyRemoteGoogleImageUrl(imageUrl);
    setIsFamilyImageSuggestionsOpen(false);
  };

  const visibleFamilyImageSuggestions = useMemo(
    () =>
      familyImageSuggestions?.suggestions.filter(
        (suggestion) => !dismissedFamilySuggestionIds.has(suggestion.id),
      ) ?? [],
    [familyImageSuggestions, dismissedFamilySuggestionIds],
  );

  const openGoogleImageSearch = () => {
    window.open(googleImageSearchUrl, "_blank", "noopener,noreferrer");
    setIsGoogleImagePickerOpen(true);
  };

  const openFamilyImageSuggestions = () => {
    setDismissedFamilySuggestionIds(new Set());
    setIsFamilyImageSuggestionsOpen(true);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (
      !nextOpen &&
      (isGoogleImagePickerOpen ||
        isFamilyImageSuggestionsOpen ||
        isSupplierDialogOpen)
    ) {
      return;
    }

    onOpenChange(nextOpen);
  };

  const dismissFamilyImageSuggestion = (suggestionId: string) => {
    setDismissedFamilySuggestionIds((current) => {
      const next = new Set(current);
      next.add(suggestionId);
      return next;
    });

    if (visibleFamilyImageSuggestions.length <= 1) {
      setIsFamilyImageSuggestionsOpen(false);
    }
  };

  const approveFamilyImageSuggestion = async (suggestionId: string) => {
    const approvedImageUrl = normalizePartImageUrlInput(imageUrl);
    if (!approvedImageUrl) return;

    setSubmitError(null);

    try {
      await applyFamilyPartImage.mutateAsync({
        partId: suggestionId,
        imageUrl: approvedImageUrl,
      });
      dismissFamilyImageSuggestion(suggestionId);
    } catch {
      // The mutation onError handler owns the visible error message.
    }
  };

  const handleCatalogAdd = () =>
    handleAddableLookup({
      name: newCatalogName,
      items: catalogs,
      select: setCatalogId,
      reset: () => {
        setNewCatalogName("");
        setShowNewCatalogInput(false);
      },
      create: (name) => createCatalog.mutate({ name, kind: catalogKind }),
    });

  const handleMaterialAdd = () =>
    handleAddableLookup({
      name: newMaterialName,
      items: materials,
      select: setMaterialId,
      reset: () => {
        setNewMaterialName("");
        setShowNewMaterialInput(false);
      },
      create: (name) => createMaterial.mutate({ name }),
    });

  const handleCategoryAdd = () =>
    handleAddableLookup({
      name: newCategoryName,
      items: categoryTree,
      select: setCategoryId,
      reset: () => {
        setNewCategoryName("");
        setShowNewCategoryInput(false);
      },
      create: (name) => createCategory.mutate({ name }),
    });

  const handleImageFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingImage(true);
      const uploadedUrl = await uploadPartImage(file);
      setImageUrl(uploadedUrl);
    } catch (error) {
      console.error("Failed to process image", error);
      setSubmitError(
        error instanceof Error ? error.message : "Failed to process image",
      );
    } finally {
      setIsProcessingImage(false);
      event.target.value = "";
    }
  };

  const handlePartUuidCopy = async () => {
    const uuid = partId ?? part?.id;
    if (!uuid || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(uuid);
    setCopiedPartUuid(true);
    window.setTimeout(() => setCopiedPartUuid(false), 1500);
  };

  const showMoney = useFinancialVisibility();
  const handleSubmit = async () => {
    setSubmitError(null);

    if (!displayName.trim() || !catalogId) {
      return;
    }

    if (piecesPerPack.trim() && (!Number.isInteger(Number(piecesPerPack)) || Number(piecesPerPack) < 2 || Number(piecesPerPack) > 999999)) {
      notify("Pieces per pack must be a whole number between 2 and 999999.", "error");
      return;
    }
    const normalizedSize = normalizePartSize(sizeValue);
    if (normalizedSize === null) {
      flashInvalidSizeInput();
      notify("Enter numbers separated by x. Choose the unit separately.", "error");
      return;
    }
    const normalizedImageUrl = normalizePartImageUrlInput(imageUrl) || null;
    const imageUrlToSave = normalizedImageUrl;

    const payload = {
      displayName: isEditMode ? displayName.trim() : appendQuantityDescription(displayName, Number(piecesPerPack), individualUnit, bulkUnit),
      piecesPerPack: piecesPerPack.trim() ? Number(piecesPerPack) : null,
      bulkUnit: bulkUnit.trim() || null,
      individualUnit: individualUnit.trim() || null,
      description: appendQuantityDescription(description, Number(piecesPerPack), individualUnit, bulkUnit) || null,
      imageUrl: imageUrlToSave,
      catalogId,
      assetTracking: isToolType ? assetTracking : null,
      categoryId,
      materialId,
      sizeNominal: parsedSizeNominal,
      sizeLabel: normalizedSize || null,
      sizeUnitId: parsedSizeNominal !== null ? sizeUnitId : null,
      isActive,
      aliases: aliasesText
        .split(/[\n;,]/)
        .map((alias) => alias.trim())
        .filter(Boolean),
    };

    const supplierPayload = supplierId
      ? {
          supplierId,
          supplierSku: supplierSku.trim() || undefined,
          packSize: packSize.trim() || "1",
          lastKnownUnitCost: showMoney
            ? normalizeCurrencyInput(lastKnownUnitCost) || undefined
            : undefined,
          supplierIsPreferred: preferredSupplierId === supplierId,
          currency: "CAD",
        }
      : {};

    if (supplierId && !isValidOrderMultiple(packSize)) {
      setSubmitError(
        "Enter a positive supplier order multiple (for example, 25).",
      );
      return;
    }
    setIsSubmittingInBackground(true);

    if (isEditMode) {
      if (!partId) return;
      try {
        await updatePart.mutateAsync({
          partId,
          ...payload,
          ...supplierPayload,
        });
        requestCatalogueReplicachePull(0);
        setIsSubmittingInBackground(false);
        onOpenChange(false);
      } catch {
        // The mutation error handler leaves the editor open with the error.
      }
      return;
    }

    try {
      // Keep the form (and its pending-list callback) mounted until creation
      // succeeds. Closing optimistically can hide a failed save.
      await createPart.mutateAsync({ ...payload, ...supplierPayload });
      requestCatalogueReplicachePull(0);
      setIsSubmittingInBackground(false);
      onOpenChange(false);
    } catch {
      // onError keeps the entered values visible with the failure message.
    }
  };

  if (isEditMode && open && isLoadingPart) {
    return (
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Part</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground py-8 text-center">
            Loading part details...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const sectionCard = "space-y-4 rounded-xl border bg-card p-4 shadow-sm";
  const sectionTitle =
    "text-xs font-semibold tracking-wide text-muted-foreground uppercase";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[90vh]"
        >
          <DialogHeader className="shrink-0 flex-row items-center justify-between gap-3 border-b px-4 py-3 text-left sm:text-left">
            <div className="min-w-0">
              <DialogTitle className="text-lg">
                {isEditMode ? "Edit Part" : "New Part"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isEditMode
                  ? "Changes apply everywhere this part is used."
                  : "Adds it to the catalogue for everyone."}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              <X className="h-5 w-5" />
            </Button>
          </DialogHeader>

          <div className="bg-muted/40 min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-4">
            {/* Photo and name: what people recognise the part by. */}
            <section className={sectionCard}>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isLoading || isProcessingImage}
                  aria-label={previewImageUrl ? "Change photo" : "Add photo"}
                  className="bg-muted/50 hover:bg-muted relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border transition-colors"
                >
                  {previewImageUrl ? (
                    <Image
                      src={previewImageUrl}
                      alt="Part preview"
                      fill
                      className="object-contain p-1.5"
                      unoptimized
                    />
                  ) : (
                    <span className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1">
                      <Camera className="h-6 w-6" />
                      <span className="text-[11px] font-medium">Add photo</span>
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <Label htmlFor="displayName">
                    Part name <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => {
                      setHasManuallyEditedDisplayName(true);
                      setDisplayName(e.target.value);
                    }}
                    placeholder="e.g., 90° Copper Elbow"
                    className="mt-1 h-10 text-base font-medium"
                    disabled={isLoading}
                  />
                  {!isEditMode && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Fills in from size, material and description.
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Search For Image"
                  className="h-9"
                  onClick={openGoogleImageSearch}
                  disabled={isLoading || isReviewingPhoto}
                >
                  <Search className="h-4 w-4 shrink-0" />
                  Search
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Get Image / Share Image"
                  className="h-9"
                  onClick={openFamilyImageSuggestions}
                  disabled={
                    isLoading ||
                    isReviewingPhoto ||
                    applyFamilyPartImage.isPending ||
                    !hasFamilyImageSuggestionSource
                  }
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                  Similar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Upload From File"
                  className="h-9"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isLoading || isProcessingImage}
                >
                  <Upload className="h-4 w-4 shrink-0" />
                  Upload
                </Button>
              </div>
            </section>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />

            <section className={sectionCard}>
              <h3 className={sectionTitle}>Where it goes</h3>
              {!isToolType && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <QuantityUnitField label="Bulk unit" value={bulkUnit} onChange={setBulkUnit} disabled={isLoading} options={["box","roll","coil","length","pack",...(quantityUnits.data ?? []).filter(u=>u.kind === "bulk").map(u=>u.name)]} onAdd={async name=>{await createQuantityUnit.mutateAsync({kind:"bulk",name}); await quantityUnits.refetch();}} />
                  <QuantityUnitField label="Individual unit" value={individualUnit} onChange={setIndividualUnit} disabled={isLoading} options={["pcs","ft","inch","mm","m",...(quantityUnits.data ?? []).filter(u=>u.kind === "individual").map(u=>u.name)]} onAdd={async name=>{await createQuantityUnit.mutateAsync({kind:"individual",name}); await quantityUnits.refetch();}} />
                </div>
                <div><Label htmlFor="piecesPerPack">Individual units per bulk unit</Label><Input id="piecesPerPack" type="number" min="2" max="999999" step="1" value={piecesPerPack} onChange={e=>setPiecesPerPack(e.target.value)} placeholder="e.g. 100" disabled={isLoading} /></div>
              </div>}

              <div>
                <FieldHeader
                  label={
                    <>
                      Catalog <span className="text-red-600">*</span>
                    </>
                  }
                  onAdd={() => setShowNewCatalogInput((value) => !value)}
                />
                {showNewCatalogInput ? (
                  <div className="mt-2 flex min-w-0 gap-2">
                    <Input
                      value={newCatalogName}
                      onChange={(e) => setNewCatalogName(e.target.value)}
                      placeholder="New catalog name"
                      className="min-w-0 flex-1"
                      disabled={isLoading || createCatalog.isPending}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCatalogAdd}
                      disabled={
                        !newCatalogName.trim() ||
                        isLoading ||
                        createCatalog.isPending
                      }
                    >
                      Add
                    </Button>
                  </div>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="mt-1 h-10 w-full justify-between font-normal"
                        disabled={isLoading}
                      >
                        {selectedCatalog?.name ?? "Select catalog"}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-60 overflow-y-auto">
                      {pickerCatalogs.map((catalog) => (
                        <DropdownMenuItem
                          key={catalog.id}
                          onClick={() => setCatalogId(catalog.id)}
                        >
                          {catalog.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {isToolType && (
                <div>
                  <Label>Tracking</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {(
                      [
                        ["serialized", "Each tool", "Own tag & serial number"],
                        ["quantity", "By quantity", "Counted, not tagged"],
                      ] as const
                    ).map(([value, title, hint]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAssetTracking(value)}
                        disabled={isLoading}
                        aria-pressed={assetTracking === value}
                        className={cn(
                          "rounded-md border px-3 py-2 text-left text-sm",
                          assetTracking === value
                            ? "border-primary bg-primary/10"
                            : "hover:bg-accent",
                        )}
                      >
                        <span className="block font-medium">{title}</span>
                        <span className="text-muted-foreground block text-xs">
                          {hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldHeader
                    label="Material"
                    onAdd={() => setShowNewMaterialInput((value) => !value)}
                  />
                  {showNewMaterialInput ? (
                    <div className="mt-2 flex min-w-0 gap-2">
                      <Input
                        value={newMaterialName}
                        onChange={(e) => setNewMaterialName(e.target.value)}
                        placeholder="New material name"
                        className="min-w-0 flex-1"
                        disabled={isLoading || createMaterial.isPending}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleMaterialAdd}
                        disabled={
                          !newMaterialName.trim() ||
                          isLoading ||
                          createMaterial.isPending
                        }
                      >
                        Add
                      </Button>
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="mt-1 h-10 w-full justify-between font-normal"
                          disabled={isLoading}
                        >
                          {selectedMaterial?.name ?? "Select material"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto">
                        <DropdownMenuItem onClick={() => setMaterialId(null)}>
                          None
                        </DropdownMenuItem>
                        {materials?.map((material) => (
                          <DropdownMenuItem
                            key={material.id}
                            onClick={() => setMaterialId(material.id)}
                          >
                            {material.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <div>
                  <FieldHeader
                    label="Category"
                    onAdd={() => setShowNewCategoryInput((value) => !value)}
                  />
                  {showNewCategoryInput ? (
                    <div className="mt-2 flex min-w-0 gap-2">
                      <Input
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="New category name"
                        className="min-w-0 flex-1"
                        disabled={isLoading || createCategory.isPending}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCategoryAdd}
                        disabled={
                          !newCategoryName.trim() ||
                          isLoading ||
                          createCategory.isPending
                        }
                      >
                        Add
                      </Button>
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="mt-1 h-10 w-full justify-between font-normal"
                          disabled={isLoading}
                        >
                          {selectedCategory?.name ?? "Select category"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto">
                        <DropdownMenuItem onClick={() => setCategoryId(null)}>
                          None
                        </DropdownMenuItem>
                        {categoryTree?.map((category) => (
                          <DropdownMenuItem
                            key={category.id}
                            onClick={() => setCategoryId(category.id)}
                          >
                            {category.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
              <div
                className={`grid gap-3 ${sizeValue.trim() ? "grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_140px]" : "grid-cols-1"}`}
              >
                <div>
                  <FieldHeader
                    label="Size"
                    onAdd={() => {
                      if (parsedSizeNominal !== null && sizeUnitId) {
                        createSize.mutate({
                          nominal: parsedSizeNominal,
                          unitId: sizeUnitId,
                        });
                      }
                    }}
                  />
                  <div className="relative">
                    <Input
                      value={sizeValue}
                      onChange={(e) => handleSizeValueChange(e.target.value)}
                      placeholder="1/2, 1.5, 3 x 3 x 3, or 3x2x2"
                      className="mt-1"
                      disabled={isLoading}
                    />
                    {showInvalidSizeInputFlash && (
                      <div
                        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-red-600"
                        role="alert"
                        aria-label="Invalid size input"
                      >
                        <X className="h-5 w-5 animate-ping" />
                      </div>
                    )}
                  </div>
                </div>
                {sizeValue.trim() && (
                  <div>
                    <FieldHeader label="Size Unit" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="mt-1 h-10 w-full justify-between font-normal"
                          disabled={isLoading}
                        >
                          {selectedSizeUnit?.code ?? "Unit"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto">
                        <DropdownMenuItem onClick={() => setSizeUnitId(null)}>
                          None
                        </DropdownMenuItem>
                        {sizeUnits.map((unit) => (
                          <DropdownMenuItem
                            key={unit.id}
                            onClick={() => setSizeUnitId(unit.id)}
                          >
                            {unit.displayName ?? unit.code} ({unit.code})
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Long sweep, DWV"
                  className="mt-1"
                  disabled={isLoading}
                />
              </div>
            </section>

            <section className={sectionCard}>
              <div className="flex items-center justify-between gap-2">
                <h3 className={sectionTitle}>Supplier</h3>
                <button
                  type="button"
                  onClick={() => setIsSupplierDialogOpen(true)}
                  className="text-primary text-xs font-medium hover:underline"
                >
                  + Add
                </button>
              </div>
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-10 w-full justify-between font-normal"
                      disabled={isLoading}
                      aria-label="Supplier"
                    >
                      {supplierId
                        ? (suppliers?.find(
                            (supplier) => supplier.id === supplierId,
                          )?.name ?? "Select supplier")
                        : "Select supplier"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto">
                    {suppliers?.map((supplier) => (
                      <DropdownMenuItem
                        key={supplier.id}
                        onClick={() => handleSupplierSelect(supplier.id)}
                      >
                        {supplier.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {supplierId ? (
                <div className="mt-3 grid grid-cols-2 items-end gap-3">
                  <div className="min-w-0">
                    <Label>Supplier SKU</Label>
                    <Input
                      value={supplierSku}
                      onChange={(e) => handleSupplierSkuChange(e.target.value)}
                      placeholder="Supplier SKU"
                      className="bg-card mt-1"
                      disabled={isLoading}
                    />
                  </div>

                  <div className="min-w-0">
                    <Label htmlFor="supplier-order-multiple">
                      Minimum / order multiple
                    </Label>
                    <Input
                      id="supplier-order-multiple"
                      type="text"
                      inputMode="decimal"
                      value={packSize}
                      onChange={(event) => {
                        const value = event.target.value;
                        setPackSize(value);
                        if (supplierId)
                          setSupplierFieldDrafts((current) => ({
                            ...current,
                            [supplierId]: {
                              supplierSku,
                              lastKnownUnitCost,
                              packSize: value,
                            },
                          }));
                      }}
                      className="bg-card mt-1"
                      disabled={isLoading}
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      25 orders 25, 50, 75… Use 1 for individual units.
                    </p>
                  </div>
                  <FinancialOnly>
                    <div className="min-w-0">
                      <Label>Cost per unit</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={lastKnownUnitCost}
                        onChange={(e) =>
                          handleLastKnownUnitCostChange(e.target.value)
                        }
                        onBlur={() =>
                          handleLastKnownUnitCostChange(
                            formatCurrencyInput(lastKnownUnitCost),
                          )
                        }
                        placeholder="$0.00"
                        className="bg-card mt-1"
                        disabled={isLoading}
                      />
                    </div>
                  </FinancialOnly>

                  <div>
                    <Label>Preferred</Label>
                    <button
                      type="button"
                      onClick={() => {
                        if (supplierId) setPreferredSupplierId(supplierId);
                      }}
                      className="bg-card hover:bg-accent mt-1 flex h-9 w-9 items-center justify-center rounded-md border transition-colors"
                      disabled={isLoading}
                      aria-pressed={preferredSupplierId === supplierId}
                      aria-label="Preferred supplier"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          preferredSupplierId === supplierId
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground/70"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground mt-2 text-xs">
                  Choose a supplier to enter its SKU and cost for this part.
                </p>
              )}
            </section>

            <section className="bg-card rounded-xl border shadow-sm">
              <button
                type="button"
                onClick={() => setShowMoreDetails((value) => !value)}
                aria-expanded={showMoreDetails}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span className={sectionTitle}>More details</span>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground h-4 w-4 transition-transform",
                    showMoreDetails && "rotate-180",
                  )}
                />
              </button>
              {showMoreDetails && (
                <div className="space-y-4 border-t px-4 pt-3 pb-4">
                  <div>
                    <Label htmlFor="partAliases">Other names</Label>
                    <Input
                      id="partAliases"
                      value={aliasesText}
                      onChange={(e) => setAliasesText(e.target.value)}
                      placeholder="copper 90, 90 elbow"
                      className="mt-1"
                      disabled={isLoading}
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      Separate with commas. Search finds the part by these too.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor="isActive">Show in catalogue</Label>
                      <p className="text-muted-foreground text-xs">
                        Hidden parts stay on existing lists.
                      </p>
                    </div>
                    <button
                      id="isActive"
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      onClick={() => setIsActive((value) => !value)}
                      disabled={isLoading}
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          isActive && "translate-x-5",
                        )}
                      />
                    </button>
                  </div>

                  <div>
                    <Label htmlFor="partImageUrl">Image link</Label>
                    <Input
                      id="partImageUrl"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://..."
                      type="url"
                      className="mt-1"
                      disabled={isLoading}
                    />
                  </div>

                  {(partId || part?.id) && (
                    <div>
                      <Label>Part ID</Label>
                      <button
                        type="button"
                        onClick={handlePartUuidCopy}
                        className="bg-muted/50 text-foreground/80 hover:bg-accent mt-1 w-full rounded-md border px-3 py-2 text-left font-mono text-xs break-all transition-colors"
                        title="Click to copy UUID"
                      >
                        {partId ?? part?.id}
                        <span className="text-muted-foreground ml-2 font-sans text-xs">
                          {copiedPartUuid ? "Copied" : "Tap to copy"}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {isEditMode && <Button type="button" variant="destructive" disabled={isLoading || !isOnline} onClick={() => void handlePermanentDelete()}>
              {checkingDelete ? "Checking usage…" : "Delete permanently"}
            </Button>}
            {submitError && (
              <p className="px-1 text-sm text-red-600" role="alert">
                {submitError}
              </p>
            )}
          </div>

          <div className="bg-card grid shrink-0 grid-cols-2 gap-2 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-3">
            <Button
              variant="outline"
              className="h-10"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              className="h-10"
              onClick={handleSubmit}
              disabled={
                isLoading ||
                !displayName.trim() ||
                !catalogId ||
                (sizeValue.trim() !== "" &&
                  (normalizePartSize(sizeValue) === null || parsedSizeNominal === null || !sizeUnitId))
              }
            >
              {isLoading
                ? isEditMode
                  ? "Saving..."
                  : "Creating..."
                : isEditMode
                  ? "Save"
                  : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isGoogleImagePickerOpen}
        onOpenChange={setIsGoogleImagePickerOpen}
      >
        <DialogContent className="relative flex max-h-[90vh] max-w-2xl flex-col">
          <DialogHeader className="pr-10">
            <DialogTitle>Find Part Image with Google</DialogTitle>
            <DialogDescription>
              Google Images opened in a new tab for:{" "}
              {googleImageSearchQuery || displayName}. Copy the image address or
              copy the image itself, then press Paste to store it as this
              part&apos;s image.
            </DialogDescription>
          </DialogHeader>

          <div
            className="bg-muted/50 space-y-3 rounded-lg border p-3 text-sm"
            onPaste={handleGoogleImagePaste}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground min-w-0 truncate">
                Search: {googleImageSearchQuery || displayName}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={openGoogleImageSearch}
              >
                <ExternalLink className="h-4 w-4" />
                Reopen Google
              </Button>
            </div>
            <div
              className="focus:border-primary bg-card text-muted-foreground space-y-3 rounded-md border border-dashed p-4 text-center text-sm outline-none"
              tabIndex={0}
            >
              <div>
                Copy an image from Google, or copy its image address. ForemenHQ
                will convert copied images to WebP and attach them to this part.
              </div>
              <Button
                type="button"
                onClick={() => void handleGoogleClipboardPaste()}
                disabled={applyGooglePartImage.isPending || isProcessingImage}
              >
                {applyGooglePartImage.isPending || isProcessingImage
                  ? "Pasting..."
                  : "Paste"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isFamilyImageSuggestionsOpen}
        onOpenChange={setIsFamilyImageSuggestionsOpen}
      >
        <DialogContent className="relative flex max-h-[90vh] max-w-3xl flex-col">
          <DialogHeader className="pr-10">
            <DialogTitle>
              {familyImageMode === "get"
                ? "Get Image From Similar Parts"
                : "Apply Image to Matching Parts"}
            </DialogTitle>
            <DialogDescription>
              {familyImageMode === "get"
                ? `Images used by matching ${familyImageSuggestions?.familyLabel ?? "family"} parts with the same material. Choose one to use for this part.`
                : `Review matching ${familyImageSuggestions?.familyLabel ?? "family"} parts with the same material. Approved parts will use this exact image URL.`}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {isLoadingFamilySuggestions ? (
              <div className="bg-muted/50 text-muted-foreground rounded-md border p-4 text-sm">
                Finding matching parts...
              </div>
            ) : familyImageMode === "get" ? (
              familyImageChoices.length > 0 ? (
                familyImageChoices.map((choice) => (
                  <div
                    key={choice.imageUrl}
                    className="bg-card flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className="bg-muted/50 relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md">
                      <Image
                        src={choice.imageUrl}
                        alt=""
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="text-foreground font-medium">
                        Used by {choice.partNames.length} similar{" "}
                        {choice.partNames.length === 1 ? "part" : "parts"}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs break-words">
                        {choice.partNames.slice(0, 3).join(", ")}
                        {choice.partNames.length > 3
                          ? ` and ${choice.partNames.length - 3} more`
                          : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void useFamilyImage(choice.imageUrl)}
                      disabled={isLoading || isReviewingPhoto}
                    >
                      <Check className="h-4 w-4" />
                      Use Image
                    </Button>
                  </div>
                ))
              ) : (
                <div className="bg-muted/50 text-muted-foreground rounded-md border p-4 text-sm">
                  No similar parts have an image yet.
                </div>
              )
            ) : visibleFamilyImageSuggestions.length > 0 ? (
              visibleFamilyImageSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="bg-card flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="bg-muted/50 relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md">
                    <Image
                      src={previewImageUrl}
                      alt=""
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-foreground text-sm font-medium break-words">
                      {suggestion.displayName}
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {suggestion.size && <span>{suggestion.size}</span>}
                      {suggestion.material && (
                        <span>{suggestion.material}</span>
                      )}
                      {suggestion.description && (
                        <span className="text-muted-foreground basis-full break-words">
                          {suggestion.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        dismissFamilyImageSuggestion(suggestion.id)
                      }
                      disabled={applyFamilyPartImage.isPending}
                      aria-label={`Decline ${suggestion.displayName}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        void approveFamilyImageSuggestion(suggestion.id)
                      }
                      disabled={applyFamilyPartImage.isPending}
                      aria-label={`Approve ${suggestion.displayName}`}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-muted/50 text-muted-foreground rounded-md border p-4 text-sm">
                No matching parts need this image.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SupplierFormDialog
        open={isSupplierDialogOpen}
        onOpenChange={setIsSupplierDialogOpen}
        onSupplierCreated={handleSupplierCreated}
      />
    </>
  );
}
