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
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  Check,
  ChevronUp,
  X,
} from "lucide-react";
import Image from "next/image";

interface AddPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
}

interface PartSelection {
  id: string;
  displayName: string;
  imageUrl: string | null;
  material: string | null;
  quantity: number;
  supplierPartId: string | undefined;
}

export function AddPartDialog({
  open,
  onOpenChange,
  materialListId,
}: AddPartDialogProps) {
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [selectedParts, setSelectedParts] = useState<
    Map<string, PartSelection>
  >(new Map());
  const [expandedSelection, setExpandedSelection] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch data
   
  const { data: categoryTree } = api.catalogue.getCategoryTree.useQuery();
   
  const { data: materials } = api.catalogue.getMaterials.useQuery();
   
  const { data: partsByCategory } = api.catalogue.getPartsByCategory.useQuery(
    { categoryId: selectedCategoryId ?? null },
    { enabled: mode === "browse" },
  );
   
  const { data: searchResults } = api.catalogue.searchParts.useQuery(
    {
      query: debouncedSearchQuery ?? undefined,
      material: selectedMaterial ?? undefined,
    },
    { enabled: mode === "search" && !!debouncedSearchQuery },
  );

   
  const parts = useMemo(() => {
    if (mode === "search") {
       
      return searchResults ?? [];
    }
     
    return partsByCategory ?? [];
  }, [mode, searchResults, partsByCategory]);

  const utils = api.useUtils();
   
  const addItem = api.materialList.addItemToMaterialList.useMutation();

  // Store supplier parts data in state instead of using dynamic hooks
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

  // Track which parts we're currently fetching to avoid duplicate requests
  const [fetchingParts, setFetchingParts] = useState<Set<string>>(new Set());
  const supplierPartsDataRef = useRef(supplierPartsData);
  const fetchingPartsRef = useRef(fetchingParts);

  // Keep refs in sync with state
  useEffect(() => {
    supplierPartsDataRef.current = supplierPartsData;
  }, [supplierPartsData]);

  useEffect(() => {
    fetchingPartsRef.current = fetchingParts;
  }, [fetchingParts]);

  // Fetch supplier parts for selected parts on-demand
  useEffect(() => {
    const selectedPartIds = Array.from(selectedParts.keys());

    selectedPartIds.forEach((partId) => {
      // Only fetch if we don't already have the data and aren't currently fetching
      if (
        supplierPartsDataRef.current.has(partId) ||
        fetchingPartsRef.current.has(partId)
      ) {
        return; // Already have data or currently fetching
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

    // Clean up supplier parts data for parts that are no longer selected
    const currentPartIds = new Set(selectedPartIds);
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
     
  }, [selectedParts, utils.supplier.getSupplierPartsByPart]);

  // Auto-select preferred supplier when part is first selected
  useEffect(() => {
    const selectedPartIds = Array.from(selectedParts.keys());

    selectedPartIds.forEach((partId) => {
      const selection = selectedParts.get(partId);
      if (!selection || selection.supplierPartId) return;

      const partsData = supplierPartsData.get(partId);
      if (partsData && partsData.length > 0) {
        const preferred = partsData.find((sp) => sp.isPreferred);
        const supplierPartId = preferred?.id ?? partsData[0]?.id;
        if (supplierPartId) {
          setSelectedParts((prev) => {
            const next = new Map(prev);
            const current = next.get(partId);
            if (current) {
              next.set(partId, { ...current, supplierPartId });
            }
            return next;
          });
        }
      }
    });
  }, [selectedParts, supplierPartsData]);

  const handleTogglePart = (part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
  }) => {
    setSelectedParts((prev) => {
      const next = new Map(prev);
      if (next.has(part.id)) {
        next.delete(part.id);
      } else {
        next.set(part.id, {
          id: part.id,
          displayName: part.displayName,
          imageUrl: part.imageUrl,
          material: part.material,
          quantity: 1,
          supplierPartId: undefined,
        });
      }
      return next;
    });
  };

  const handleUpdateQuantity = (partId: string, quantity: number) => {
    setSelectedParts((prev) => {
      const next = new Map(prev);
      const current = next.get(partId);
      if (current) {
        next.set(partId, { ...current, quantity: Math.max(1, quantity) });
      }
      return next;
    });
  };

  const handleUpdateSupplier = (partId: string, supplierPartId: string) => {
    setSelectedParts((prev) => {
      const next = new Map(prev);
      const current = next.get(partId);
      if (current) {
        next.set(partId, { ...current, supplierPartId });
      }
      return next;
    });
  };

  const handleRemovePart = (partId: string) => {
    setSelectedParts((prev) => {
      const next = new Map(prev);
      next.delete(partId);
      return next;
    });
  };

  const handleAddParts = async () => {
    if (selectedParts.size === 0) return;

    const partsToAdd = Array.from(selectedParts.values());
    try {
      await Promise.all(
        partsToAdd.map((part) =>
           
          addItem.mutateAsync({
            materialListId,
            partDefinitionId: part.id,
            quantity: part.quantity,
            supplierPartId: part.supplierPartId,
          }),
        ),
      );
       
      void utils.materialList.getMaterialList.invalidate({ materialListId });
      setSelectedParts(new Map());
      setExpandedSelection(false);
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding parts:", error);
    }
  };

  const selectedCount = selectedParts.size;

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedParts(new Map());
      setExpandedSelection(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Add Parts</DialogTitle>
          <DialogDescription>
            Browse categories or search for parts to add
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-4">
          {/* Mode Tabs */}
          <div className="flex gap-2 border-b">
            <button
              onClick={() => setMode("browse")}
              className={`px-4 py-2 font-medium ${
                mode === "browse"
                  ? "border-primary text-primary border-b-2"
                  : "text-gray-600"
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setMode("search")}
              className={`px-4 py-2 font-medium ${
                mode === "search"
                  ? "border-primary text-primary border-b-2"
                  : "text-gray-600"
              }`}
            >
              Search
            </button>
          </div>

          {mode === "browse" && (
            <div className="flex gap-4">
              {/* Category Tree */}
              <div className="w-64 border-r pr-4">
                <h3 className="mb-2 font-semibold">Categories</h3>
                <CategoryTree
                   
                  categories={categoryTree ?? []}
                  selectedCategoryId={selectedCategoryId}
                  onSelectCategory={setSelectedCategoryId}
                />
              </div>

              {/* Parts Grid */}
              <div className="flex-1">
                <h3 className="mb-2 font-semibold">Parts</h3>
                { }
                {parts.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center">
                    {selectedCategoryId
                      ? "No parts in this category"
                      : "Select a category to view parts"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    { }
                    {parts.map(
                      (part: {
                        id: string;
                        displayName: string;
                        imageUrl: string | null;
                        material: string | null;
                      }) => {
                        const isSelected = selectedParts.has(part.id);
                        return (
                          <Card
                            key={part.id}
                            className={`cursor-pointer transition-all hover:shadow-md ${
                              isSelected
                                ? "border-primary border-2 shadow-md"
                                : ""
                            }`}
                            onClick={() => handleTogglePart(part)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center gap-4">
                                <div
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                    isSelected
                                      ? "border-primary bg-primary"
                                      : "border-gray-300"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTogglePart(part);
                                  }}
                                >
                                  {isSelected && (
                                    <Check className="h-3 w-3 text-white" />
                                  )}
                                </div>
                                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                                  {part.imageUrl ? (
                                    <Image
                                      src={part.imageUrl}
                                      alt={part.displayName}
                                      fill
                                      className="object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-gray-400">
                                      <svg
                                        className="h-6 w-6"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                        />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-sm font-medium">
                                    {part.displayName}
                                  </h4>
                                  {part.material && (
                                    <Badge
                                      variant="outline"
                                      className="mt-1 text-xs"
                                    >
                                      {part.material}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      },
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === "search" && (
            <div className="space-y-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by name, synonym, size, or material..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Material Filter */}
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full sm:w-auto">
                      <Filter className="mr-2 h-4 w-4" />
                      Material: {selectedMaterial ?? "All"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setSelectedMaterial(null)}>
                      All Materials
                    </DropdownMenuItem>
                    { }
                    {materials?.map((material: string) => (
                      <DropdownMenuItem
                        key={material}
                        onClick={() => setSelectedMaterial(material)}
                      >
                        {material}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Search Results */}
              <div>
                { }
                {parts.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center">
                    {debouncedSearchQuery
                      ? "No parts found"
                      : "Enter a search query"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    { }
                    {parts.map(
                      (part: {
                        id: string;
                        displayName: string;
                        imageUrl: string | null;
                        material: string | null;
                      }) => {
                        const isSelected = selectedParts.has(part.id);
                        return (
                          <Card
                            key={part.id}
                            className={`cursor-pointer transition-all hover:shadow-md ${
                              isSelected
                                ? "border-primary border-2 shadow-md"
                                : ""
                            }`}
                            onClick={() => handleTogglePart(part)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center gap-4">
                                <div
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                    isSelected
                                      ? "border-primary bg-primary"
                                      : "border-gray-300"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTogglePart(part);
                                  }}
                                >
                                  {isSelected && (
                                    <Check className="h-3 w-3 text-white" />
                                  )}
                                </div>
                                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                                  {part.imageUrl ? (
                                    <Image
                                      src={part.imageUrl}
                                      alt={part.displayName}
                                      fill
                                      className="object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-gray-400">
                                      <svg
                                        className="h-6 w-6"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                        />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-sm font-medium">
                                    {part.displayName}
                                  </h4>
                                  {part.material && (
                                    <Badge
                                      variant="outline"
                                      className="mt-1 text-xs"
                                    >
                                      {part.material}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      },
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="shrink-0 border-t bg-white">
          {selectedCount > 0 && (
            <div className="border-b px-6 py-3">
              <button
                onClick={() => setExpandedSelection(!expandedSelection)}
                className="flex w-full items-center justify-between text-sm font-medium"
                aria-label={
                  expandedSelection
                    ? "Collapse selected parts"
                    : "Expand selected parts"
                }
              >
                <span>
                  {selectedCount} part{selectedCount !== 1 ? "s" : ""} selected
                </span>
                {expandedSelection ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>
          )}
          {expandedSelection && selectedCount > 0 && (
            <div className="max-h-64 space-y-4 overflow-y-auto border-b px-6 py-4">
              {Array.from(selectedParts.values()).map((selection) => {
                const partsData: Array<{
                  id: string;
                  supplierId: string;
                  supplierSku: string | null;
                  lastKnownUnitCost: string | null;
                  isPreferred: boolean;
                  supplier: {
                    id: string;
                    name: string;
                  };
                }> = supplierPartsData.get(selection.id) ?? [];
                return (
                  <div
                    key={selection.id}
                    className="flex items-start gap-4 rounded-lg border p-3"
                  >
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gray-100">
                      {selection.imageUrl ? (
                        <Image
                          src={selection.imageUrl}
                          alt={selection.displayName}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-gray-400">
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {selection.displayName}
                          </p>
                          {selection.material && (
                            <Badge variant="outline" className="mt-1 text-xs">
                              {selection.material}
                            </Badge>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemovePart(selection.id)}
                          className="ml-2 text-gray-400 hover:text-gray-600"
                          aria-label={`Remove ${selection.displayName}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-gray-600">
                            Quantity
                          </label>
                          <Input
                            type="number"
                            min="1"
                            value={selection.quantity}
                            onChange={(e) =>
                              handleUpdateQuantity(
                                selection.id,
                                parseInt(e.target.value) || 1,
                              )
                            }
                            className="mt-1 h-8"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        {partsData.length > 0 && (
                          <div className="flex-1">
                            <label className="text-xs text-gray-600">
                              Supplier
                            </label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="mt-1 h-8 w-full justify-start text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {partsData.find(
                                    (sp) => sp.id === selection.supplierPartId,
                                  )?.supplier.name ?? "Select supplier"}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {partsData.map((sp) => (
                                  <DropdownMenuItem
                                    key={sp.id}
                                    onClick={() =>
                                      handleUpdateSupplier(selection.id, sp.id)
                                    }
                                  >
                                    {sp.supplier.name}
                                    {sp.supplierSku
                                      ? ` (${sp.supplierSku})`
                                      : ""}
                                    {sp.isPreferred && " ⭐"}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter className="px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddParts}
               
              disabled={selectedCount === 0 || addItem.isPending}
            >
              { }
              {addItem.isPending
                ? "Adding..."
                : `Add ${selectedCount} Part${selectedCount !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Category Tree Component
function CategoryTree({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: {
  categories: Array<{
    id: string;
    name: string;
    children: Array<unknown>;
    partCount?: number;
  }>;
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderCategory = (category: (typeof categories)[0]) => {
    const isExpanded = expanded.has(category.id);
    const isSelected = selectedCategoryId === category.id;
    const hasChildren = category.children.length > 0;

    return (
      <div key={category.id} className="mb-1">
        <div className="flex items-center gap-1">
          {hasChildren && (
            <button
              onClick={() => toggleExpanded(category.id)}
              className="p-0.5"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            onClick={() => onSelectCategory(category.id)}
            className={`flex-1 text-left text-sm ${
              isSelected ? "text-primary font-semibold" : "text-gray-700"
            }`}
          >
            {category.name}
            {category.partCount !== undefined && (
              <span className="text-muted-foreground ml-1">
                ({category.partCount})
              </span>
            )}
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div className="mt-1 ml-6">
            {category.children.map((child) =>
              renderCategory(child as (typeof categories)[0]),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <button
        onClick={() => onSelectCategory(null)}
        className={`mb-2 text-sm ${
          selectedCategoryId === null
            ? "text-primary font-semibold"
            : "text-gray-700"
        }`}
      >
        All Categories
      </button>
      {categories.map(renderCategory)}
    </div>
  );
}
