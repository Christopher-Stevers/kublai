"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Package,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";
import {
  addOfflineCatalogueCatalog,
  addOfflineCatalogueCategory,
  addOfflineCatalogueMaterial,
} from "~/lib/offline-catalogue";

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

function isValidSizeInput(value: string) {
  if (!/^[0-9xX./\s]*$/.test(value)) return false;

  const normalizedValue = value.toLowerCase();
  if (/^\s*x/.test(normalizedValue) || /x\s*x/.test(normalizedValue)) {
    return false;
  }

  return normalizedValue.split("x").every((segment) => {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) return true;
    return /^(?:\d*(?:\.\d*)?|\d+\/?\d*|\d+\s+\d+\/?\d*)$/.test(trimmedSegment);
  });
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
  }) => void;
}

export function PartDetailsDialog({
  mode,
  open,
  onOpenChange,
  partId,
  initialContext,
  onPartCreated,
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
  const [hasManuallyEditedDisplayName, setHasManuallyEditedDisplayName] =
    useState(false);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnitId, setSizeUnitId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSku, setSupplierSku] = useState("");
  const [lastKnownUnitCost, setLastKnownUnitCost] = useState("");
  const [preferredSupplierId, setPreferredSupplierId] = useState<string | null>(
    null,
  );
  const [supplierFieldDrafts, setSupplierFieldDrafts] = useState<
    Record<string, { supplierSku: string; lastKnownUnitCost: string }>
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
    if (!isValidSizeInput(nextValue)) {
      flashInvalidSizeInput();
      return;
    }

    setSizeValue(nextValue.replace(/X/g, "x"));
  };

  useEffect(() => {
    if (!open || initializedForOpenRef.current) return;

    if (isEditMode && part) {
      setDisplayName(part.displayName ?? "");
      setDescription(part.description ?? "");
      setImageUrl(part.imageUrl ?? "");
      setAliasesText(
        part.aliases?.map((alias) => alias.synonym).join("\n") ?? "",
      );
      setCatalogId(part.catalogId ?? null);
      setCategoryId(part.categoryId ?? null);
      const matchedMaterial = materials?.find(
        (material) => material.name === part.material,
      );
      setMaterialId(matchedMaterial?.id ?? null);
      setSizeValue(part.sizeLabel ?? formatSizeDecimal(part.sizeNominal));
      setSizeUnitId(part.sizeUnitId ?? null);
      setIsActive(part.isActive ?? true);
      setSupplierId(null);
      setSupplierSku("");
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
      setDescription("");
      setImageUrl("");
      setAliasesText("");
      setCatalogId(initialContext?.catalogId ?? null);
      setCategoryId(initialContext?.categoryId ?? null);
      setMaterialId(initialContext?.materialId ?? null);
      setSizeValue(
        initialContext?.size?.sizeLabel ??
          formatSizeDecimal(initialContext?.size?.nominal ?? null),
      );
      setIsActive(true);
      setSupplierId(null);
      setSupplierSku("");
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
        description,
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
    if (isEditMode || !supplierId) return;

    if (selectedSupplierDraft) {
      setSupplierSku(selectedSupplierDraft.supplierSku);
      setLastKnownUnitCost(selectedSupplierDraft.lastKnownUnitCost);
      return;
    }

    setSupplierSku(matchingSelectedSupplierPart?.supplierSku ?? "");
    setLastKnownUnitCost(
      matchingSelectedSupplierPart?.lastKnownUnitCost?.toString() ?? "",
    );
  }, [
    isEditMode,
    matchingSelectedSupplierPart,
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
      [draftSupplierId]: { supplierSku, lastKnownUnitCost },
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

  const updatePart = api.catalogue.updatePart.useMutation({
    onSuccess: () => {
      void utils.catalogue.searchParts.invalidate();
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
  const familyImageSuggestionInput = isEditMode
    ? { partId: partId! }
    : {
        draft: {
          displayName: displayName.trim(),
          description: description.trim() || null,
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
        !!previewImageUrl &&
        (isEditMode ? !!partId : !!displayName.trim()),
    },
  );

  const applyFamilyPartImage =
    api.catalogue.applyPartImageToFamilyCandidate.useMutation({
      onSuccess: () => {
        void utils.catalogue.searchParts.invalidate();
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
      addOfflineCatalogueCatalog(newCatalog);
      setCatalogId(newCatalog.id);
      setNewCatalogName("");
      setShowNewCatalogInput(false);
      void utils.catalogue.getCatalogs.invalidate();
    },
  });

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      if (!newCategory) return;
      addOfflineCatalogueCategory(newCategory);
      void utils.catalogue.getCategoryTree.invalidate();
      setCategoryId(newCategory.id);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
    },
  });

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (!newMaterial) return;
      addOfflineCatalogueMaterial(newMaterial);
      setMaterialId(newMaterial.id);
      setNewMaterialName("");
      setShowNewMaterialInput(false);
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
    createPart.isPending ||
    updatePart.isPending ||
    isProcessingImage ||
    isSubmittingInBackground;
  const isReviewingPhoto = applyGooglePartImage.isPending;
  const hasFamilyImageSuggestionSource = isEditMode
    ? !!partId
    : !!displayName.trim();
  const selectedCatalog = catalogs?.find((catalog) => catalog.id === catalogId);
  const selectedSizeUnit = sizeUnits.find((unit) => unit.id === sizeUnitId);
  const googleImageSearchQuery = displayName.trim();
  const googleImageSearchUrl =
    "https://www.google.com/search?tbm=isch&q=" +
    encodeURIComponent(googleImageSearchQuery || displayName);
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
      create: (name) => createCatalog.mutate({ name }),
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

  const handleSubmit = () => {
    setSubmitError(null);

    if (!displayName.trim() || !catalogId) {
      return;
    }

    const normalizedImageUrl = normalizePartImageUrlInput(imageUrl) || null;
    const imageUrlToSave = normalizedImageUrl;

    const payload = {
      displayName: displayName.trim(),
      description: description.trim() || null,
      imageUrl: imageUrlToSave,
      catalogId,
      categoryId,
      materialId,
      sizeNominal: parsedSizeNominal,
      sizeLabel: formatSizeDimensions(sizeValue.trim(), null) || null,
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
          lastKnownUnitCost:
            normalizeCurrencyInput(lastKnownUnitCost) || undefined,
          supplierIsPreferred: preferredSupplierId === supplierId,
          currency: "CAD",
        }
      : {};

    setIsSubmittingInBackground(true);

    if (isEditMode) {
      if (!partId) return;
      updatePart.mutate({ partId, ...payload, ...supplierPayload });
      window.setTimeout(() => onOpenChange(false), 0);
      return;
    }

    createPart.mutate({
      ...payload,
      ...supplierPayload,
    });
    window.setTimeout(() => onOpenChange(false), 0);
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-2xl overflow-x-hidden overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? "Edit Part" : "Create Part"}
            </DialogTitle>
            <DialogDescription>
              Fill in all available part fields.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4 py-4">
            <div className="rounded-lg border bg-gray-50/50 p-3">
              <Label className="text-sm font-semibold text-gray-900">
                Part Information
              </Label>
              <div className="mt-3 space-y-4">
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
                          className="mt-1 w-full justify-between"
                          disabled={isLoading}
                        >
                          {selectedCatalog?.name ?? "Select catalog"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto">
                        {catalogs?.map((catalog) => (
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
                          className="mt-1 w-full justify-between"
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

                <div
                  className={`grid gap-3 ${sizeValue.trim() ? "grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_140px]" : "grid-cols-1"}`}
                >
                  <div>
                    <FieldHeader
                      label="Size"
                      addLabel="+Add"
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
                            className="mt-1 w-full justify-between"
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
                          className="mt-1 w-full justify-between"
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

                <div>
                  <Label>Description</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Part description"
                    className="mt-1"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <Label htmlFor="displayName">
                    Part Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => {
                      setHasManuallyEditedDisplayName(true);
                      setDisplayName(e.target.value);
                    }}
                    placeholder="e.g., 90° Copper Elbow"
                    className="mt-1"
                    disabled={isLoading}
                  />
                  {!isEditMode && (
                    <p className="mt-1 text-xs text-gray-500">
                      Auto-generated from size, material, and description. You
                      can still override it.
                    </p>
                  )}
                  <div className="mt-3">
                    <Label title="Add aliases separated by comma">
                      Aliases
                    </Label>
                    <Input
                      value={aliasesText}
                      onChange={(e) => setAliasesText(e.target.value)}
                      placeholder="copper 90, 90 elbow"
                      className="mt-1"
                      disabled={isLoading}
                      title="Add aliases separated by comma"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="isActive"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4"
                    disabled={isLoading}
                  />
                  <Label htmlFor="isActive">
                    Active (visible in catalogue)
                  </Label>
                </div>

                <div>
                  <Label>UUID</Label>
                  {partId || part?.id ? (
                    <button
                      type="button"
                      onClick={handlePartUuidCopy}
                      className="mt-1 w-full rounded-md border bg-gray-50 px-3 py-2 text-left font-mono text-xs break-all text-gray-700 transition-colors hover:bg-gray-100"
                      title="Click to copy UUID"
                    >
                      {partId ?? part?.id}
                      <span className="ml-2 font-sans text-xs text-gray-500">
                        {copiedPartUuid ? "Copied" : "Click to copy"}
                      </span>
                    </button>
                  ) : (
                    <div className="mt-1 rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      Generated when the part is saved
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-gray-50/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-semibold text-gray-900">
                  Supplier Information
                </Label>
                <button
                  type="button"
                  onClick={() => setIsSupplierDialogOpen(true)}
                  className="text-primary text-xs font-medium hover:underline"
                >
                  + Add
                </button>
              </div>
              <div className="mt-3">
                <Label>Supplier</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="mt-1 w-full justify-between bg-white"
                      disabled={isLoading}
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
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
                  <div className="min-w-0">
                    <Label>Supplier SKU</Label>
                    <Input
                      value={supplierSku}
                      onChange={(e) => handleSupplierSkuChange(e.target.value)}
                      placeholder="Supplier SKU"
                      className="mt-1 bg-white"
                      disabled={isLoading}
                    />
                  </div>

                  <div className="min-w-0">
                    <Label>Unit Cost</Label>
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
                      className="mt-1 bg-white"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <Label>Preferred</Label>
                    <button
                      type="button"
                      onClick={() => {
                        if (supplierId) setPreferredSupplierId(supplierId);
                      }}
                      className="mt-1 flex h-9 w-9 items-center justify-center rounded-md border bg-white transition-colors hover:bg-gray-50"
                      disabled={isLoading}
                      aria-pressed={preferredSupplierId === supplierId}
                      aria-label="Preferred supplier"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          preferredSupplierId === supplierId
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-gray-400"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  Choose a supplier to enter its SKU and cost for this part.
                </p>
              )}
            </div>

            <div className="rounded-lg border bg-gray-50/50 p-3">
              <Label className="text-sm font-semibold text-gray-900">
                Image
              </Label>
              <div className="mt-3 space-y-4">
                <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-gray-50">
                    {previewImageUrl ? (
                      <Image
                        src={previewImageUrl}
                        alt="Part preview"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <Package className="h-8 w-8 text-gray-400" />
                    )}
                  </div>
                  <div className="grid content-start gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 justify-start bg-white text-left whitespace-normal"
                      onClick={openGoogleImageSearch}
                      disabled={isLoading || isReviewingPhoto}
                    >
                      <Search className="h-4 w-4 shrink-0" />
                      Search For Image
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 justify-start bg-white text-left whitespace-normal"
                      onClick={openFamilyImageSuggestions}
                      disabled={
                        isLoading ||
                        isReviewingPhoto ||
                        applyFamilyPartImage.isPending ||
                        !previewImageUrl ||
                        !hasFamilyImageSuggestionSource
                      }
                    >
                      <Share2 className="h-4 w-4 shrink-0" />
                      Share Image With Similar Parts
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 justify-start bg-white text-left whitespace-normal"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isLoading || isProcessingImage}
                    >
                      <Upload className="h-4 w-4 shrink-0" />
                      Upload From File
                    </Button>
                  </div>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageFileChange}
                />

                <div>
                  <Label>Image URL</Label>
                  <Input
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                    }}
                    placeholder="https://..."
                    type="url"
                    className="mt-1 bg-white"
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-red-600" role="alert">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                isLoading ||
                !displayName.trim() ||
                !catalogId ||
                (sizeValue.trim() !== "" &&
                  (parsedSizeNominal === null || !sizeUnitId))
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
          </DialogFooter>
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
            className="space-y-3 rounded-lg border bg-gray-50 p-3 text-sm"
            onPaste={handleGoogleImagePaste}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-gray-600">
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
              className="focus:border-primary space-y-3 rounded-md border border-dashed bg-white p-4 text-center text-sm text-gray-600 outline-none"
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
            <DialogTitle>Apply Image to Matching Parts</DialogTitle>
            <DialogDescription>
              Review matching {familyImageSuggestions?.familyLabel ?? "family"}{" "}
              parts with the same material. Approved parts will use this exact
              image URL.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {isLoadingFamilySuggestions ? (
              <div className="rounded-md border bg-gray-50 p-4 text-sm text-gray-600">
                Finding matching parts...
              </div>
            ) : visibleFamilyImageSuggestions.length > 0 ? (
              visibleFamilyImageSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-start gap-3 rounded-lg border bg-white p-3"
                >
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50">
                    <Image
                      src={previewImageUrl}
                      alt=""
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium break-words text-gray-900">
                      {suggestion.displayName}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                      {suggestion.size && <span>{suggestion.size}</span>}
                      {suggestion.material && (
                        <span>{suggestion.material}</span>
                      )}
                      {suggestion.description && (
                        <span className="basis-full break-words text-gray-600">
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
              <div className="rounded-md border bg-gray-50 p-4 text-sm text-gray-600">
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
