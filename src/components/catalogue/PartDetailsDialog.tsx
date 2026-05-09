"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Package, Star, Upload } from "lucide-react";
import { api } from "~/trpc/react";
import {
  formatSize,
  formatSizeDecimal,
  formatSizeDimensions,
  generatePartDisplayName,
  parseSizeInput,
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
import { Textarea } from "~/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SupplierFormDialog } from "~/components/suppliers/SupplierFormDialog";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";

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

type PartSummary = {
  id: string;
  displayName: string;
  description: string | null;
  imageUrl: string | null;
  catalogId: string;
  categoryId: string | null;
  material: string | null;
  sizeNominal: string | null;
  sizeLabel?: string | null;
  sizeUnitId: string | null;
  isActive: boolean;
  aliases?: { id: string; synonym: string }[];
  sizeUnit: {
    id: string;
    code: string | null;
    displayName: string | null;
  } | null;
  isOrgSpecific: boolean;
};

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
  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: partId ? [partId] : [] },
    { enabled: isOnline && open && isEditMode && !!partId },
  );
  const { data: partSupplierParts } =
    api.supplier.getSupplierPartsByPart.useQuery(
      { partDefinitionId: partId! },
      { enabled: isOnline && open && isEditMode && !!partId },
    );
  const { data: duplicateCandidates } =
    api.catalogue.findDuplicateCandidates.useQuery(
      { partId: partId!, limit: 6 },
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

  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      setSubmitError(null);
    }
  }, [open]);

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
      onOpenChange(false);
    },
    onError: (error) => {
      setSubmitError(
        error.message || "Could not create part. Please try again.",
      );
    },
  });

  const updatePart = api.catalogue.updatePart.useMutation({
    onSuccess: () => {
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPart.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      setSubmitError(error.message || "Could not save part. Please try again.");
    },
  });

  const mergeDuplicatePart = api.catalogue.mergeDuplicatePart.useMutation({
    onSuccess: () => {
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPart.invalidate();
      void utils.catalogue.findDuplicateCandidates.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      setSubmitError(
        error.message || "Could not merge duplicate part. Please try again.",
      );
    },
  });

  const handleSupplierCreated = (newSupplierId: string) => {
    handleSupplierSelect(newSupplierId);
    setIsSupplierDialogOpen(false);
  };

  const createCatalog = api.catalogue.createCatalog.useMutation({
    onSuccess: (newCatalog) => {
      if (!newCatalog) return;
      utils.catalogue.getCatalogs.setData(undefined, (old) => {
        const next = [...(old ?? []), newCatalog];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      setCatalogId(newCatalog.id);
      setNewCatalogName("");
      setShowNewCatalogInput(false);
      void utils.catalogue.getCatalogs.invalidate();
    },
  });

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      if (!newCategory) return;
      utils.catalogue.getCategoryTree.setData(undefined, (old) => {
        const next = [...(old ?? []), newCategory];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      void utils.catalogue.getCategoryTree.invalidate();
      setCategoryId(newCategory.id);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
    },
  });

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (!newMaterial) return;
      utils.catalogue.getMaterials.setData(undefined, (old) => {
        const next = [...(old ?? []), newMaterial];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
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
    ? parseSizeInput(sizeValue.trim())
    : null;
  const isLoading =
    createPart.isPending || updatePart.isPending || isProcessingImage;
  const selectedCatalog = catalogs?.find((catalog) => catalog.id === catalogId);
  const selectedCategory = categoryTree?.find(
    (category) => category.id === categoryId,
  );
  const selectedMaterial = materials?.find(
    (material) => material.id === materialId,
  );
  const selectedSizeUnit = sizeUnits.find((unit) => unit.id === sizeUnitId);
  const hasSuppliers =
    !!partId && !!supplierInfo?.[partId]?.availableSuppliers?.length;

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

  const handleSubmit = () => {
    setSubmitError(null);

    if (!displayName.trim() || !catalogId) {
      return;
    }

    const payload = {
      displayName: displayName.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      catalogId,
      categoryId,
      materialId,
      sizeNominal: parsedSizeNominal,
      sizeLabel:
        formatSizeDimensions(
          sizeValue.trim(),
          selectedSizeUnit?.code ?? null,
        ) || null,
      sizeUnitId: parsedSizeNominal ? sizeUnitId : null,
      isActive,
      aliases: aliasesText
        .split(/[\n;,]/)
        .map((alias) => alias.trim())
        .filter(Boolean),
    };

    if (isEditMode) {
      if (!partId) return;
      updatePart.mutate({ partId, ...payload });
      return;
    }

    createPart.mutate({
      ...payload,
      supplierId: supplierId ?? undefined,
      supplierSku: supplierSku.trim() || undefined,
      lastKnownUnitCost: normalizeCurrencyInput(lastKnownUnitCost) || undefined,
      supplierIsPreferred: !!supplierId && preferredSupplierId === supplierId,
      currency: "CAD",
    });
  };

  if (isEditMode && open && isLoadingPart) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
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
              {isEditMode
                ? "Update every editable part field in one place."
                : "Create a part and fill in all available part fields."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4 py-4">
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
                <Input
                  value={sizeValue}
                  onChange={(e) => setSizeValue(e.target.value)}
                  placeholder="1/2 or 0.5"
                  className="mt-1"
                  disabled={isLoading}
                />
              </div>
              {sizeValue.trim() && (
                <div>
                  <Label>Size Unit</Label>
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
                <>
                  <p className="mt-1 text-xs text-gray-500">
                    Auto-generated from size, material, and description. You can
                    still override it.
                  </p>
                  <div className="mt-3">
                    <Label title="Add aliases separated by comma">Aliases</Label>
                    <Input
                      value={aliasesText}
                      onChange={(e) => setAliasesText(e.target.value)}
                      placeholder="copper 90, 90 elbow"
                      className="mt-1"
                      disabled={isLoading}
                      title="Add aliases separated by comma"
                    />
                  </div>
                </>
              )}
            </div>

            {!isEditMode && (
              <div className="rounded-lg border bg-gray-50/50 p-3">
                <FieldHeader
                  label="Suppliers"
                  onAdd={() => setIsSupplierDialogOpen(true)}
                />
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
                    <DropdownMenuItem onClick={() => handleSupplierSelect(null)}>
                      None
                    </DropdownMenuItem>
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
            )}

            <div>
              <Label>Part Image</Label>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isLoading}
                className="mt-1 flex w-full min-w-0 items-center gap-3 rounded-lg border bg-gray-50 p-3 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 sm:gap-4"
              >
                <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white sm:h-24 sm:w-24">
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt="Part preview"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <Package className="h-8 w-8 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-900">
                    <Upload className="h-4 w-4 shrink-0" />
                    {imageUrl ? "Change image" : "Upload image"}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Click to choose an image. It will be resized, saved as WebP,
                    and stored as a short app URL.
                  </p>
                </div>
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageFileChange}
              />
            </div>

            <div>
              <Label>Image URL</Label>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                type="url"
                className="mt-1"
                disabled={isLoading}
              />
            </div>

            {isEditMode && (
              <div>
                <Label>Aliases / Search Terms</Label>
                <Textarea
                  value={aliasesText}
                  onChange={(e) => setAliasesText(e.target.value)}
                  placeholder="One alias per line, e.g. copper 90, 90 elbow"
                  className="mt-1"
                  disabled={isLoading}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Aliases are used by catalogue search and XLSX round-trips.
                </p>
              </div>
            )}

            {isEditMode &&
              duplicateCandidates &&
              duplicateCandidates.length > 0 && (
                <div className="rounded-lg border bg-amber-50 p-3">
                  <Label>Possible duplicates</Label>
                  <div className="mt-2 space-y-2">
                    {duplicateCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="flex min-w-0 flex-col gap-3 rounded-md bg-white p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {candidate.displayName}
                          </p>
                          <p className="truncate text-xs text-gray-600">
                            {[
                              candidate.material,
                              candidate.size,
                              ...candidate.reasons,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={
                            isLoading || mergeDuplicatePart.isPending || !partId
                          }
                          onClick={() => {
                            if (!partId) return;
                            mergeDuplicatePart.mutate({
                              sourcePartId: candidate.id,
                              targetPartId: partId,
                            });
                          }}
                        >
                          Merge into this
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    Merging moves old quote/order/supplier links to this part,
                    keeps the old name as an alias, and hides the duplicate.
                  </p>
                </div>
              )}

            <div className="flex items-center gap-2">
              <input
                id="isActive"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
                disabled={isLoading}
              />
              <Label htmlFor="isActive">Active (visible in catalogue)</Label>
            </div>

            {isEditMode && partId && (
              <div className="rounded-lg border bg-gray-50/50 p-3">
                <FieldHeader label="Suppliers" />
                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                  <PartSuppliersDropdown
                    partDefinitionId={partId}
                    currentPreferredSupplierId={
                      supplierInfo?.[partId]?.preferredSupplier?.id ?? null
                    }
                    availableSuppliers={
                      supplierInfo?.[partId]?.availableSuppliers ?? []
                    }
                  />
                </div>
                {partSupplierParts && partSupplierParts.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {partSupplierParts.map((supplierPart) => (
                      <div
                        key={supplierPart.id}
                        className="rounded-md border bg-white p-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {supplierPart.supplier.name}
                          </span>
                          {supplierPart.isPreferred && (
                            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                              Preferred
                            </span>
                          )}
                        </div>
                        <div className="mt-1 grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
                          <span>SKU: {supplierPart.supplierSku || "—"}</span>
                          <span>
                            Cost: {supplierPart.lastKnownUnitCost ?? "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">
                    This part does not have any suppliers yet.
                  </p>
                )}
              </div>
            )}
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
                  ? "Save Changes"
                  : "Create Part"}
            </Button>
          </DialogFooter>
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
