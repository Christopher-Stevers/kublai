"use client";

import { useState, useEffect } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { PartSuppliersDropdown } from "./PartSuppliersDropdown";

interface EditPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partId: string | null;
}

export function EditPartDialog({
  open,
  onOpenChange,
  partId,
}: EditPartDialogProps) {
  const utils = api.useUtils();

  // Fetch part data
  const { data: part, isLoading } = api.catalogue.getPart.useQuery(
    { partId: partId! },
    { enabled: open && !!partId },
  );

  // Fetch categories and units
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery();
  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();

  // Fetch supplier info for this part
  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: partId ? [partId] : [] },
    { enabled: open && !!partId },
  );

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [material, setMaterial] = useState("");
  const [sizeNominal, setSizeNominal] = useState("");
  const [sizeUnitId, setSizeUnitId] = useState<string | null>(null);
  const [defaultUomId, setDefaultUomId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  // Update form when part data loads
  useEffect(() => {
    if (part) {
      setDisplayName(part.displayName ?? "");
      setDescription(part.description ?? "");
      setImageUrl(part.imageUrl ?? "");
      setCategoryId(part.categoryId);
      setMaterial(part.material ?? "");
      setSizeNominal(part.sizeNominal?.toString() ?? "");
      setSizeUnitId(part.sizeUnitId);
      setDefaultUomId(part.defaultUomId);
      setIsActive(part.isActive ?? true);
    }
  }, [part]);

  const updatePart = api.catalogue.updatePart.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.catalogue.getPart.cancel({ partId: partId! });
      await utils.catalogue.searchParts.cancel();

      // Snapshot previous values
      const previousPart = utils.catalogue.getPart.getData({ partId: partId! });
      const previousSearchResults = utils.catalogue.searchParts.getData();

      // Optimistically update part detail
      utils.catalogue.getPart.setData({ partId: partId! }, (old) => {
        if (!old) return old;
        return {
          ...old,
          displayName: variables.displayName ?? old.displayName,
          description: variables.description ?? old.description,
          imageUrl: variables.imageUrl ?? old.imageUrl,
          categoryId: variables.categoryId ?? old.categoryId,
          material: old.material, // material is derived from materialId, not directly updated
          sizeNominal: variables.sizeNominal ? String(variables.sizeNominal) : old.sizeNominal,
          sizeUnitId: variables.sizeUnitId ?? old.sizeUnitId,
          defaultUomId: variables.defaultUomId ?? old.defaultUomId,
          isActive: variables.isActive ?? old.isActive,
        };
      });

      // Invalidate search results to refetch with updated data
      void utils.catalogue.searchParts.invalidate();

      return { previousPart, previousSearchResults };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousPart) {
        utils.catalogue.getPart.setData({ partId: partId! }, context.previousPart);
      }
      if (context?.previousSearchResults !== undefined) {
        // Can't rollback search results without query params, just invalidate
        void utils.catalogue.searchParts.invalidate();
      }
    },
    onSettled: () => {
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPart.invalidate();
    },
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  // Categories are now flat (no children), so just map them
  const categories = (categoryTree ?? []).map((cat) => ({
    id: cat.id,
    name: cat.name,
  }));
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const selectedSizeUnit = allUnits?.find((u) => u.id === sizeUnitId);
  const selectedDefaultUom = allUnits?.find((u) => u.id === defaultUomId);
  const sizeUnits = allUnits?.filter((u) => u.kind === "length") ?? [];
  const defaultUoms = allUnits?.filter((u) => u.kind === "count") ?? [];

  const hasSuppliers =
    partId && supplierInfo?.[partId]?.availableSuppliers
      ? (supplierInfo[partId]?.availableSuppliers?.length ?? 0) > 0
      : false;

  const handleSave = () => {
    if (!partId || !displayName.trim()) return;

    // Parse size nominal
    let parsedSizeNominal: number | null = null;
    if (sizeNominal.trim()) {
      const parsed = parseFloat(sizeNominal.trim());
      if (!isNaN(parsed)) {
        parsedSizeNominal = parsed;
      }
    }

    // Use the selected size unit ID
    const parsedSizeUnitId = sizeUnitId;

    updatePart.mutate({
      partId,
      displayName: displayName.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      categoryId: categoryId ?? null,
      materialId: undefined, // TODO: Look up materialId from material name or update form to use IDs
      sizeNominal: parsedSizeNominal,
      sizeUnitId: parsedSizeUnitId,
      defaultUomId: defaultUomId ?? null,
      isActive,
    });
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Part</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-muted-foreground">
            Loading part details...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!part) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Part</DialogTitle>
          <DialogDescription>
            Update part information. {part.isOrgSpecific ? "" : "This will create an organization-specific copy."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label htmlFor="displayName" className="text-sm font-medium">
              Part Name *
            </label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., 90° Copper Elbow"
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Part description"
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor="imageUrl" className="text-sm font-medium">
              Image URL
            </label>
            <Input
              id="imageUrl"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              type="url"
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor="category" className="text-sm font-medium">
              Category
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="mt-1 w-full justify-between"
                >
                  {selectedCategory
                    ? selectedCategory.name
                    : "Select category"}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-60 overflow-y-auto">
                <DropdownMenuItem onClick={() => setCategoryId(null)}>
                  None
                </DropdownMenuItem>
                {categories.map((cat) => (
                  <DropdownMenuItem
                    key={cat.id}
                    onClick={() => setCategoryId(cat.id)}
                  >
                    {cat.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="material" className="text-sm font-medium">
                Material
              </label>
              <Input
                id="material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="e.g., Copper, PVC, PEX"
                className="mt-1"
              />
            </div>

            <div>
              <label htmlFor="size" className="text-sm font-medium">
                Size
              </label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="size"
                  value={sizeNominal}
                  onChange={(e) => setSizeNominal(e.target.value)}
                  placeholder="1/2 or 0.5"
                  className="flex-1"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-24">
                      {selectedSizeUnit?.code ?? "Unit"}
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
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
            </div>
          </div>

          <div>
            <label htmlFor="defaultUom" className="text-sm font-medium">
              Default Unit of Measure
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between mt-1"
                >
                  {selectedDefaultUom
                    ? `${selectedDefaultUom.displayName ?? selectedDefaultUom.code} (${selectedDefaultUom.code})`
                    : "Select unit"}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-60 overflow-y-auto">
                <DropdownMenuItem onClick={() => setDefaultUomId(null)}>
                  None
                </DropdownMenuItem>
                {defaultUoms.map((unit) => (
                  <DropdownMenuItem
                    key={unit.id}
                    onClick={() => setDefaultUomId(unit.id)}
                  >
                    {unit.displayName ?? unit.code} ({unit.code})
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isActive" className="text-sm font-medium cursor-pointer">
              Active (visible in catalogue)
            </label>
          </div>

          {partId && (
            <div>
              <label className="text-sm font-medium">
                Suppliers
              </label>
              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <PartSuppliersDropdown
                  partDefinitionId={partId}
                  currentPreferredSupplierId={
                    supplierInfo?.[partId]?.preferredSupplier?.id || null
                  }
                  availableSuppliers={
                    supplierInfo?.[partId]?.availableSuppliers ?? []
                  }
                />
              </div>
              {!hasSuppliers ? (
                <p className="mt-1 text-xs text-gray-500">
                  This part does not have any suppliers yet
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  Manage which suppliers provide this part and set a preferred supplier
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!displayName.trim() || updatePart.isPending}
          >
            {updatePart.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
