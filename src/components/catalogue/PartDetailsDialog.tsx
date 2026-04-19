"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "~/trpc/react";
import { parseSizeInput } from "~/lib/size-utils";
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
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";

function FieldHeader({
  label,
  onAdd,
  addLabel = "+ Add",
}: {
  label: string;
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
          className="text-xs font-medium text-primary hover:underline"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
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
  return [sizeValue && sizeUnitCode ? `${sizeValue} ${sizeUnitCode}` : sizeValue, materialName, description]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .join(" ");
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
  sizeUnitId: string | null;
  defaultUomId: string | null;
  isActive: boolean;
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
    size?: { nominal: number; unit: string } | null;
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
  const isEditMode = mode === "edit";

  const { data: part, isLoading: isLoadingPart } = api.catalogue.getPart.useQuery(
    { partId: partId! },
    { enabled: open && isEditMode && !!partId },
  );

  const { data: catalogs } = api.catalogue.getCatalogs.useQuery(undefined, {
    enabled: open,
  });
  const { data: materials } = api.catalogue.getMaterials.useQuery(undefined, {
    enabled: open,
  });
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery(undefined, {
    enabled: open,
  });
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery(undefined, {
    enabled: open,
  });
  const { data: suppliers } = api.supplier.list.useQuery(undefined, {
    enabled: open,
  });
  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: partId ? [partId] : [] },
    { enabled: open && isEditMode && !!partId },
  );

  const [displayName, setDisplayName] = useState("");
  const [hasManuallyEditedDisplayName, setHasManuallyEditedDisplayName] = useState(false);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnitId, setSizeUnitId] = useState<string | null>(null);
  const [defaultUomId, setDefaultUomId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSku, setSupplierSku] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [lastKnownUnitCost, setLastKnownUnitCost] = useState("");
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [showNewCatalogInput, setShowNewCatalogInput] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState("");
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewMaterialInput, setShowNewMaterialInput] = useState(false);
  const [newMaterialName, setNewMaterialName] = useState("");

  const sizeUnits = useMemo(
    () => (allUnits?.filter((u) => u.kind === "length") ?? []),
    [allUnits],
  );
  const defaultUoms = useMemo(
    () => (allUnits?.filter((u) => u.kind === "count") ?? []),
    [allUnits],
  );

  useEffect(() => {
    if (!open) return;

    if (isEditMode && part) {
      setDisplayName(part.displayName ?? "");
      setDescription(part.description ?? "");
      setImageUrl(part.imageUrl ?? "");
      setCatalogId(part.catalogId ?? null);
      setCategoryId(part.categoryId ?? null);
      const matchedMaterial = materials?.find((material) => material.name === part.material);
      setMaterialId(matchedMaterial?.id ?? null);
      setSizeValue(part.sizeNominal?.toString() ?? "");
      setSizeUnitId(part.sizeUnitId ?? null);
      setDefaultUomId(part.defaultUomId ?? null);
      setIsActive(part.isActive ?? true);
      setSupplierId(null);
      setSupplierSku("");
      setSupplierName("");
      setLastKnownUnitCost("");
      setHasManuallyEditedDisplayName(true);
      return;
    }

    if (!isEditMode) {
      setDisplayName("");
      setDescription("");
      setImageUrl("");
      setCatalogId(initialContext?.catalogId ?? null);
      setCategoryId(initialContext?.categoryId ?? null);
      setMaterialId(initialContext?.materialId ?? null);
      setSizeValue(initialContext?.size?.nominal?.toString() ?? "");
      setDefaultUomId(null);
      setIsActive(true);
      setSupplierId(null);
      setSupplierSku("");
      setSupplierName("");
      setLastKnownUnitCost("");
      setHasManuallyEditedDisplayName(false);

      if (initialContext?.size?.unit && allUnits) {
        const matchedUnit = allUnits.find((unit) => unit.code === initialContext.size?.unit);
        setSizeUnitId(matchedUnit?.id ?? null);
      } else {
        setSizeUnitId(null);
      }
    }
  }, [open, isEditMode, part, materials, initialContext, allUnits]);

  useEffect(() => {
    if (!open || isEditMode || hasManuallyEditedDisplayName) {
      return;
    }

    setDisplayName(
      buildPartName({
        description,
        materialName: materials?.find((material) => material.id === materialId)?.name,
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

  const createPart = api.catalogue.createPart.useMutation({
    onSuccess: async (newPart) => {
      let supplierPartId: string | undefined;
      if (supplierId) {
        try {
          const supplierParts = await utils.supplier.getSupplierPartsByPart.fetch({
            partDefinitionId: newPart.id,
          });
          supplierPartId = supplierParts.find((sp) => sp.supplierId === supplierId)?.id;
        } catch (error) {
          console.error("Error fetching supplier part", error);
        }
      }

      onPartCreated?.({
        id: newPart.id,
        displayName: newPart.displayName,
        imageUrl: newPart.imageUrl,
        material: newPart.material,
        size: newPart.sizeUnit
          ? `${newPart.sizeNominal ?? ""} ${newPart.sizeUnit.code}`.trim()
          : null,
        supplierPartId,
      });

      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPart.invalidate();
      onOpenChange(false);
    },
  });

  const updatePart = api.catalogue.updatePart.useMutation({
    onSuccess: () => {
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPart.invalidate();
      onOpenChange(false);
    },
  });

  const handleSupplierCreated = (newSupplierId: string) => {
    setSupplierId(newSupplierId);
    setIsSupplierDialogOpen(false);
  };

  const createCatalog = api.catalogue.createCatalog.useMutation({
    onSuccess: (newCatalog) => {
      if (!newCatalog) return;
      void utils.catalogue.getCatalogs.invalidate();
      setCatalogId(newCatalog.id);
      setNewCatalogName("");
      setShowNewCatalogInput(false);
    },
  });

  const createCategory = api.catalogue.createCategoryType.useMutation({
    onSuccess: (newCategory) => {
      void utils.catalogue.getCategoryTree.invalidate();
      setCategoryId(newCategory.id);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
    },
  });

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (!newMaterial) return;
      void utils.catalogue.getMaterials.invalidate();
      setMaterialId(newMaterial.id);
      setNewMaterialName("");
      setShowNewMaterialInput(false);
    },
  });

  const createSize = api.catalogue.createSize.useMutation({
    onSuccess: () => {
      void utils.catalogue.getAvailableSizes.invalidate();
    },
  });

  const parsedSizeNominal = sizeValue.trim() ? parseSizeInput(sizeValue.trim()) : null;
  const isLoading = createPart.isPending || updatePart.isPending;
  const selectedCatalog = catalogs?.find((catalog) => catalog.id === catalogId);
  const selectedCategory = categoryTree?.find((category) => category.id === categoryId);
  const selectedMaterial = materials?.find((material) => material.id === materialId);
  const selectedSizeUnit = sizeUnits.find((unit) => unit.id === sizeUnitId);
  const selectedDefaultUom = defaultUoms.find((unit) => unit.id === defaultUomId);
  const hasSuppliers =
    !!partId && !!supplierInfo?.[partId]?.availableSuppliers?.length;

  const handleSubmit = () => {
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
      sizeUnitId: parsedSizeNominal ? sizeUnitId : null,
      defaultUomId,
      isActive,
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
      supplierName: supplierName.trim() || undefined,
      lastKnownUnitCost: lastKnownUnitCost.trim() || undefined,
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
          <div className="py-8 text-center text-muted-foreground">Loading part details...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit Part" : "Create Part"}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Update every editable part field in one place."
                : "Create a part and fill in all available part fields."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <FieldHeader
                label="Catalog *"
                onAdd={() => setShowNewCatalogInput((value) => !value)}
              />
              {showNewCatalogInput ? (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={newCatalogName}
                    onChange={(e) => setNewCatalogName(e.target.value)}
                    placeholder="New catalog name"
                    disabled={isLoading || createCatalog.isPending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => createCatalog.mutate({ name: newCatalogName.trim() })}
                    disabled={!newCatalogName.trim() || isLoading || createCatalog.isPending}
                  >
                    Add
                  </Button>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="mt-1 w-full justify-between" disabled={isLoading}>
                      {selectedCatalog?.name ?? "Select catalog"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto">
                    {catalogs?.map((catalog) => (
                      <DropdownMenuItem key={catalog.id} onClick={() => setCatalogId(catalog.id)}>
                        {catalog.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div>
                <Label>Size</Label>
                <Input
                  value={sizeValue}
                  onChange={(e) => setSizeValue(e.target.value)}
                  placeholder="1/2 or 0.5"
                  className="mt-1"
                  disabled={isLoading}
                />
              </div>
              <div>
                <FieldHeader
                  label="Size Unit"
                  onAdd={() => {
                    if (parsedSizeNominal !== null && sizeUnitId) {
                      createSize.mutate({ nominal: parsedSizeNominal, unitId: sizeUnitId });
                    }
                  }}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="mt-1 w-full justify-between" disabled={isLoading}>
                      {selectedSizeUnit?.code ?? "Unit"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto">
                    <DropdownMenuItem onClick={() => setSizeUnitId(null)}>None</DropdownMenuItem>
                    {sizeUnits.map((unit) => (
                      <DropdownMenuItem key={unit.id} onClick={() => setSizeUnitId(unit.id)}>
                        {unit.displayName ?? unit.code} ({unit.code})
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="mt-1 text-xs text-gray-500">
                  Pick a size and unit, then click + Add to save it as a reusable size.
                </p>
              </div>
            </div>

            <div>
              <FieldHeader label="Material" onAdd={() => setShowNewMaterialInput((value) => !value)} />
              {showNewMaterialInput ? (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={newMaterialName}
                    onChange={(e) => setNewMaterialName(e.target.value)}
                    placeholder="New material name"
                    disabled={isLoading || createMaterial.isPending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => createMaterial.mutate({ name: newMaterialName.trim() })}
                    disabled={!newMaterialName.trim() || isLoading || createMaterial.isPending}
                  >
                    Add
                  </Button>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="mt-1 w-full justify-between" disabled={isLoading}>
                      {selectedMaterial?.name ?? "Select material"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto">
                    <DropdownMenuItem onClick={() => setMaterialId(null)}>None</DropdownMenuItem>
                    {materials?.map((material) => (
                      <DropdownMenuItem key={material.id} onClick={() => setMaterialId(material.id)}>
                        {material.name}
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
              <FieldHeader label="Category" onAdd={() => setShowNewCategoryInput((value) => !value)} />
              {showNewCategoryInput ? (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="New category name"
                    disabled={isLoading || createCategory.isPending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => createCategory.mutate({ name: newCategoryName.trim() })}
                    disabled={!newCategoryName.trim() || isLoading || createCategory.isPending}
                  >
                    Add
                  </Button>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="mt-1 w-full justify-between" disabled={isLoading}>
                      {selectedCategory?.name ?? "Select category"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto">
                    <DropdownMenuItem onClick={() => setCategoryId(null)}>None</DropdownMenuItem>
                    {categoryTree?.map((category) => (
                      <DropdownMenuItem key={category.id} onClick={() => setCategoryId(category.id)}>
                        {category.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
                  Auto-generated from size, material, and description. You can still override it.
                </p>
              )}
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

            <div>
              <Label>Default Unit of Measure</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="mt-1 w-full justify-between" disabled={isLoading}>
                    {selectedDefaultUom
                      ? `${selectedDefaultUom.displayName ?? selectedDefaultUom.code} (${selectedDefaultUom.code})`
                      : "Select unit"}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-60 overflow-y-auto">
                  <DropdownMenuItem onClick={() => setDefaultUomId(null)}>None</DropdownMenuItem>
                  {defaultUoms.map((unit) => (
                    <DropdownMenuItem key={unit.id} onClick={() => setDefaultUomId(unit.id)}>
                      {unit.displayName ?? unit.code} ({unit.code})
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {!isEditMode && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Supplier</Label>
                  <div className="mt-1 flex gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="flex-1 justify-between" disabled={isLoading}>
                          {supplierId
                            ? suppliers?.find((supplier) => supplier.id === supplierId)?.name ?? "Select supplier"
                            : "Select supplier"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto">
                        <DropdownMenuItem onClick={() => setSupplierId(null)}>None</DropdownMenuItem>
                        {suppliers?.map((supplier) => (
                          <DropdownMenuItem key={supplier.id} onClick={() => setSupplierId(supplier.id)}>
                            {supplier.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsSupplierDialogOpen(true)} disabled={isLoading}>
                      New
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Supplier SKU</Label>
                  <Input
                    value={supplierSku}
                    onChange={(e) => setSupplierSku(e.target.value)}
                    placeholder="Supplier SKU"
                    className="mt-1"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <Label>Supplier Name</Label>
                  <Input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="Supplier item name"
                    className="mt-1"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <Label>Unit Cost</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={lastKnownUnitCost}
                    onChange={(e) => setLastKnownUnitCost(e.target.value)}
                    placeholder="0.00"
                    className="mt-1"
                    disabled={isLoading}
                  />
                </div>
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
              <div>
                <Label>Suppliers</Label>
                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                  <PartSuppliersDropdown
                    partDefinitionId={partId}
                    currentPreferredSupplierId={supplierInfo?.[partId]?.preferredSupplier?.id ?? null}
                    availableSuppliers={supplierInfo?.[partId]?.availableSuppliers ?? []}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {hasSuppliers
                    ? "Manage suppliers for this part and set the preferred one."
                    : "This part does not have any suppliers yet."}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                isLoading ||
                !displayName.trim() ||
                !catalogId ||
                (sizeValue.trim() !== "" && (parsedSizeNominal === null || !sizeUnitId))
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
