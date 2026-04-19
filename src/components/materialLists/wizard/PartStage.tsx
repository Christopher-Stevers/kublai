import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Pencil, AlertCircle } from "lucide-react";
import Image from "next/image";
import type { PendingPart } from "./types";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";
import { ViewToggle } from "~/components/ui/view-toggle";

function usePartSupplierSelection(partId: string) {
  const [selectedSupplierPartId, setSelectedSupplierPartId] = useState<string | null>(null);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [previousSupplierCount, setPreviousSupplierCount] = useState<number>(0);

  const { data: supplierParts, isLoading: isLoadingSuppliers } =
    api.supplier.getSupplierPartsByPart.useQuery(
      { partDefinitionId: partId },
      { enabled: !!partId },
    );

  const { data: supplierInfo } = api.catalogue.getPartsSupplierInfo.useQuery(
    { partIds: [partId] },
    { enabled: !!partId },
  );

  const utils = api.useUtils();

  useEffect(() => {
    if (supplierParts && supplierParts.length > 0) {
      const currentCount = supplierParts.length;
      const wasNewSupplierAdded =
        currentCount > previousSupplierCount && previousSupplierCount > 0;

      const preferred = supplierParts.find((sp) => sp.isPreferred);
      const supplierPartId = preferred?.id ?? supplierParts[0]?.id;

      if (
        !selectedSupplierPartId ||
        !supplierParts.find((sp) => sp.id === selectedSupplierPartId)
      ) {
        if (supplierPartId) {
          setSelectedSupplierPartId(supplierPartId);
          if (
            isSupplierDialogOpen &&
            (previousSupplierCount === 0 || wasNewSupplierAdded)
          ) {
            setIsSupplierDialogOpen(false);
          }
        }
      } else if (
        preferred &&
        preferred.id !== selectedSupplierPartId &&
        wasNewSupplierAdded
      ) {
        setSelectedSupplierPartId(preferred.id);
        if (isSupplierDialogOpen) {
          setIsSupplierDialogOpen(false);
        }
      }

      setPreviousSupplierCount(currentCount);
    } else {
      setPreviousSupplierCount(0);
    }
  }, [supplierParts, selectedSupplierPartId, isSupplierDialogOpen, previousSupplierCount]);

  return {
    selectedSupplierPartId,
    setSelectedSupplierPartId,
    isSupplierDialogOpen,
    setIsSupplierDialogOpen,
    supplierParts,
    isLoadingSuppliers,
    supplierInfo,
    utils,
  };
}

interface PartCardProps {
  part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  };
  isPending: boolean;
  onPartSelect: (
    part: {
      id: string;
      displayName: string;
      description: string | null;
      imageUrl: string | null;
      material: string | null;
      size: string | null;
    },
    supplierPartId: string,
  ) => void;
  onEditPart: (partId: string) => void;
}

function PartCard({ part, isPending, onPartSelect, onEditPart }: PartCardProps) {
  const {
    selectedSupplierPartId,
    setSelectedSupplierPartId,
    isSupplierDialogOpen,
    setIsSupplierDialogOpen,
    supplierParts,
    isLoadingSuppliers,
    supplierInfo,
    utils,
  } = usePartSupplierSelection(part.id);

  const hasSupplier = !!selectedSupplierPartId;
  const hasAvailableSuppliers = (supplierParts?.length ?? 0) > 0;
  const truncatedDescription = part.description
    ? part.description.length > 100
      ? `${part.description.substring(0, 100)}...`
      : part.description
    : null;

  const handleCardClick = () => {
    if (hasSupplier && selectedSupplierPartId) {
      onPartSelect(part, selectedSupplierPartId);
    }
  };

  return (
    <Card
      className={`relative transition-all hover:shadow-md ${
        isPending ? "border-primary border-2" : ""
      } ${hasSupplier ? "cursor-pointer" : ""}`}
      onClick={hasSupplier ? handleCardClick : undefined}
    >
      <CardContent className="p-2 sm:p-4">
        <div className="flex flex-col gap-2">
          <div className="relative h-16 w-full overflow-hidden rounded-md bg-gray-100 sm:h-32">
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
                  className="h-6 w-6 sm:h-8 sm:w-8"
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
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <h4 className="line-clamp-2 text-[11px] font-medium leading-tight sm:text-sm">
                {part.displayName}
              </h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 shrink-0 p-0 sm:h-6 sm:w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditPart(part.id);
                }}
                title="Edit part"
              >
                <Pencil className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" />
              </Button>
            </div>
            {truncatedDescription && (
              <p className="line-clamp-2 text-[10px] text-gray-600 sm:text-xs">
                {truncatedDescription}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-gray-700">
                Supplier:{" "}
                {!hasSupplier && hasAvailableSuppliers && (
                  <span className="text-amber-600">*Required</span>
                )}
              </label>
              {isLoadingSuppliers ? (
                <div className="mt-1 text-xs text-gray-500">
                  Loading suppliers...
                </div>
              ) : hasAvailableSuppliers ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className={`mt-1 h-6 w-full justify-start px-2 text-[10px] sm:h-8 sm:text-xs ${
                        !hasSupplier
                          ? "border-amber-300 text-amber-700"
                          : ""
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="truncate">
                        {supplierParts?.find(
                          (sp) => sp.id === selectedSupplierPartId,
                        )?.supplier.name ?? "Select supplier"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                    {supplierParts?.map((sp) => (
                      <DropdownMenuItem
                        key={sp.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSupplierPartId(sp.id);
                        }}
                      >
                        {sp.supplier.name}
                        {sp.supplierSku ? ` (${sp.supplierSku})` : ""}
                        {sp.isPreferred && " ⭐"}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSupplierDialogOpen(true);
                  }}
                  className="mt-1 w-full cursor-pointer rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100 sm:px-3 sm:py-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                    <span className="flex-1">
                      No suppliers available. Click to add suppliers.
                    </span>
                  </div>
                </button>
              )}
            </div>
            <Button
              size="sm"
              className="h-7 w-full px-2 text-[10px] sm:h-9 sm:text-sm"
              onClick={(e) => {
                e.stopPropagation();
                if (hasSupplier && selectedSupplierPartId) {
                  onPartSelect(part, selectedSupplierPartId);
                }
              }}
              disabled={!hasSupplier}
            >
              Add to List
            </Button>
          </div>
        </div>
      </CardContent>
      {/* Supplier Management Dialog */}
      <Dialog 
        open={isSupplierDialogOpen} 
        onOpenChange={(open) => {
          setIsSupplierDialogOpen(open);
          if (!open) {
            // Refetch supplier parts when dialog closes and auto-select if a supplier was added
            void utils.supplier.getSupplierPartsByPart.invalidate({
              partDefinitionId: part.id,
            });
            void utils.catalogue.getPartsSupplierInfo.invalidate();
            // The useEffect will handle auto-selecting the supplier when data refreshes
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Manage Suppliers</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Connect existing suppliers or create a new one for this part.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 sm:py-4">
            <div>
              <label className="text-xs font-medium sm:text-sm">
                Suppliers
              </label>
              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <PartSuppliersDropdown
                  partDefinitionId={part.id}
                  currentPreferredSupplierId={
                    supplierInfo?.[part.id]?.preferredSupplier?.id || null
                  }
                  availableSuppliers={
                    supplierInfo?.[part.id]?.availableSuppliers ?? []
                  }
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Select suppliers that provide this part and set a preferred supplier.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PartListRow({ part, isPending, onPartSelect, onEditPart }: PartCardProps) {
  const {
    selectedSupplierPartId,
    setSelectedSupplierPartId,
    isSupplierDialogOpen,
    setIsSupplierDialogOpen,
    supplierParts,
    isLoadingSuppliers,
    supplierInfo,
    utils,
  } = usePartSupplierSelection(part.id);

  const hasSupplier = !!selectedSupplierPartId;
  const hasAvailableSuppliers = (supplierParts?.length ?? 0) > 0;

  return (
    <div
      className={`rounded-lg border bg-white p-3 transition-all ${
        isPending ? "border-primary border-2 shadow-sm" : "hover:shadow-sm"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
            {part.imageUrl ? (
              <Image src={part.imageUrl} alt={part.displayName} fill className="object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <AlertCircle className="h-4 w-4" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-medium">{part.displayName}</h4>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                  {part.material && <span>{part.material}</span>}
                  {part.size && <span>{part.size}</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0"
                onClick={() => onEditPart(part.id)}
                title="Edit part"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            {part.description && (
              <p className="mt-1 line-clamp-2 text-xs text-gray-600">{part.description}</p>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 lg:w-64">
          {isLoadingSuppliers ? (
            <div className="text-xs text-gray-500">Loading suppliers...</div>
          ) : hasAvailableSuppliers ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="justify-start text-xs">
                  <span className="truncate">
                    {supplierParts?.find((sp) => sp.id === selectedSupplierPartId)?.supplier.name ?? "Select supplier"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {supplierParts?.map((sp) => (
                  <DropdownMenuItem key={sp.id} onClick={() => setSelectedSupplierPartId(sp.id)}>
                    {sp.supplier.name}
                    {sp.supplierSku ? ` (${sp.supplierSku})` : ""}
                    {sp.isPreferred && " ⭐"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              onClick={() => setIsSupplierDialogOpen(true)}
              className="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800"
            >
              No suppliers available. Click to add suppliers.
            </button>
          )}

          <Button
            size="sm"
            onClick={() => {
              if (hasSupplier && selectedSupplierPartId) {
                onPartSelect(part, selectedSupplierPartId);
              }
            }}
            disabled={!hasSupplier}
          >
            Add to List
          </Button>
        </div>
      </div>

      <Dialog
        open={isSupplierDialogOpen}
        onOpenChange={(open) => {
          setIsSupplierDialogOpen(open);
          if (!open) {
            void utils.supplier.getSupplierPartsByPart.invalidate({
              partDefinitionId: part.id,
            });
            void utils.catalogue.getPartsSupplierInfo.invalidate();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Manage Suppliers</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Connect existing suppliers or create a new one for this part.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 sm:py-4">
            <div>
              <label className="text-xs font-medium sm:text-sm">Suppliers</label>
              <div className="mt-1">
                <PartSuppliersDropdown
                  partDefinitionId={part.id}
                  currentPreferredSupplierId={
                    supplierInfo?.[part.id]?.preferredSupplier?.id || null
                  }
                  availableSuppliers={supplierInfo?.[part.id]?.availableSuppliers ?? []}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface PartStageProps {
  partsForSelection: Array<{
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  }>;
  pendingParts: PendingPart[];
  onPartSelect: (part: {
    id: string;
    displayName: string;
    description: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  }, supplierPartId: string) => void;
  onEditPart: (partId: string) => void;
  selectedMaterialId: string | null;
  selectedSize: { nominal: number; unit: string } | null;
  selectedPartTypeCategory: {
    categoryId: string | null;
    name: string;
  } | null;
  onContinueToReview: () => void;
}

export function PartStage({
  partsForSelection,
  pendingParts,
  onPartSelect,
  onEditPart,
  selectedMaterialId,
  selectedSize,
  selectedPartTypeCategory,
  onContinueToReview,
}: PartStageProps) {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const pagination = useClientPagination(partsForSelection);

  if (partsForSelection.length === 0) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base font-semibold sm:text-lg">No Parts Found</h3>
        <p className="text-xs text-gray-500 sm:text-sm">
          No parts found for the selected material, size, and category.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold sm:text-lg">Select Parts</h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ViewToggle view={viewMode} onViewChange={setViewMode} showOnMobile />
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onContinueToReview}
            className="w-full text-xs sm:w-auto sm:text-sm"
          >
            Review ({pendingParts.length})
          </Button>
        </div>
      </div>
      {viewMode === "grid" ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 md:grid-cols-3">
          {pagination.paginatedItems.map((part) => {
            const isPending = pendingParts.some((p) => p.partId === part.id);
            return (
              <PartCard
                key={part.id}
                part={part}
                isPending={isPending}
                onPartSelect={onPartSelect}
                onEditPart={onEditPart}
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {pagination.paginatedItems.map((part) => {
            const isPending = pendingParts.some((p) => p.partId === part.id);
            return (
              <PartListRow
                key={part.id}
                part={part}
                isPending={isPending}
                onPartSelect={onPartSelect}
                onEditPart={onEditPart}
              />
            );
          })}
        </div>
      )}
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="parts"
        onPageChange={pagination.setPage}
      />
      <div className="flex justify-end">
        <Button
          onClick={onContinueToReview}
          disabled={pendingParts.length === 0}
          className="w-full text-xs sm:w-auto sm:text-sm"
        >
          Continue to Review ({pendingParts.length})
        </Button>
      </div>
    </div>
  );
}
