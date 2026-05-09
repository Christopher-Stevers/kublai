"use client";

import { memo } from "react";
import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  TrashIcon,
} from "lucide-react";
import Image from "next/image";
import {
  applyOfflineRemoveItem,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";
import type { MaterialListSyncStatus } from "~/hooks/use-offline-material-list";

interface MaterialListItemProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    syncVersion?: string | null;
    partDefinition: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
    selectedSupplierId?: string | null;
    supplierPart: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
    uom: {
      id: string;
      code: string;
      displayName: string | null;
    } | null;
    addedBy?: {
      id: string;
      name: string;
      email: string | null;
    } | null;
  };
  materialListId: string;
  syncStatus?: MaterialListSyncStatus;
}

function ItemSyncBadge({ status }: { status: MaterialListSyncStatus }) {
  if (status === "syncing") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200"
        title="Syncing"
        aria-label="Syncing"
      >
        <Loader2Icon className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200"
        title="Pending sync"
        aria-label="Pending sync"
      >
        <Clock3Icon className="h-3 w-3" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
      title="Synced"
      aria-label="Synced"
    >
      <CheckCircle2Icon className="h-3 w-3" />
    </span>
  );
}

function MaterialListItemComponent({
  item,
  materialListId,
  syncStatus = "synced",
}: MaterialListItemProps) {
  const utils = api.useUtils();
  const removeItem = api.materialList.removeMaterialListItem.useMutation({
    onMutate: async (variables) => {
      await utils.materialList.getMaterialList.cancel({ materialListId });

      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });

      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = old.items.filter(
          (item) => item.id !== variables.itemId,
        );

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
    onError: (_err, _variables, context) => {
      if (context?.previousMaterialList) {
        utils.materialList.getMaterialList.setData(
          { materialListId },
          context.previousMaterialList,
        );
      }
    },
    onSettled: () => {
      // Keep the optimistic cache as the immediate source of truth. SSE/background
      // refresh will reconcile later without forcing a post-click spinner/refetch.
    },
  });

  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.extendedPrice
    ? parseFloat(item.extendedPrice)
    : quantity * unitCost;

  const handleRemove = async () => {
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = old.items.filter(
          (candidate) => candidate.id !== item.id,
        );
        const materialTotal = updatedItems.reduce((sum, candidate) => {
          const price = candidate.extendedPrice
            ? parseFloat(candidate.extendedPrice.toString())
            : 0;
          return sum + price;
        }, 0);

        return {
          ...old,
          items: updatedItems,
          materialTotal,
        };
      });
      await applyOfflineRemoveItem(materialListId, item.id);
      await enqueueOfflineMutation({
        type: "removeItem",
        materialListId,
        itemId: item.id,
        queuedAt: new Date().toISOString(),
      });
      return;
    }

    removeItem.mutate({ itemId: item.id });
  };

  const partName =
    item.partDefinition?.displayName ||
    item.descriptionSnapshot ||
    "Unknown Part";
  const subtitleParts = [
    item.partDefinition?.material ?? null,
    item.uom?.code ?? null,
  ].filter((value): value is string => Boolean(value));
  const subtitle = subtitleParts.join(" · ");

  return (
    <Card className="group relative overflow-hidden rounded-2xl border-gray-200 bg-gradient-to-br from-white to-gray-50/60 shadow-sm transition-all [content-visibility:auto] [contain-intrinsic-size:9rem] hover:border-gray-300 hover:shadow-md">
      <CardContent className="relative p-3 sm:p-4">
        <div className="absolute top-2 right-2 z-10 sm:top-2.5 sm:right-2.5">
          <ItemSyncBadge status={syncStatus} />
        </div>
        <div className="grid h-[7.25rem] grid-cols-[7.25rem_minmax(0,1fr)_2rem] gap-3 sm:h-32 sm:grid-cols-[8rem_minmax(0,1fr)_2rem] sm:gap-4">
          {/* Image — anchors card height */}
          <div className="relative h-[7.25rem] w-[7.25rem] overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 shadow-sm ring-1 ring-gray-200 ring-inset sm:h-32 sm:w-32">
            {item.partDefinition?.imageUrl ? (
              <Image
                src={item.partDefinition.imageUrl}
                alt={item.partDefinition.displayName}
                fill
                className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-300">
                <svg
                  className="h-7 w-7 sm:h-9 sm:w-9"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Content column — evenly spaced rows pinned to image height */}
          <div className="grid min-w-0 grid-rows-[1fr_2rem_2rem] gap-2">
            <div className="flex min-w-0 flex-col justify-center">
              <h3 className="line-clamp-1 text-sm leading-tight font-semibold tracking-tight text-gray-900 sm:text-base">
                {partName}
              </h3>
              {subtitle && (
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {subtitle}
                </p>
              )}
            </div>

            <div className="flex h-8 items-center rounded-xl bg-white/70">
              <QuantityControls
                itemId={item.id}
                quantity={quantity}
                materialListId={materialListId}
                compact
              />
            </div>

            <div className="flex h-8 min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <SupplierSelector
                  itemId={item.id}
                  partDefinitionId={item.partDefinition?.id ?? ""}
                  currentSupplierPartId={item.supplierPart?.id}
                  currentSupplierId={item.selectedSupplierId}
                  materialListId={materialListId}
                  compact
                />
              </div>
              <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-white/70 px-2 ring-1 ring-gray-100">
                <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
                  Total
                </span>
                <span className="min-w-[3.5rem] text-right text-sm font-semibold text-gray-900 tabular-nums sm:text-base">
                  ${lineTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Action rail — same rows as content, so icons line up */}
          <div className="grid h-[7.25rem] w-8 grid-rows-[1fr_2rem_2rem] gap-2 sm:h-32">
            <div />
            <div className="flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                onClick={handleRemove}
                disabled={removeItem.isPending}
                aria-label="Remove item"
              >
                <TrashIcon className="h-4 w-4" />
              </Button>
            </div>
            <div />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const MaterialListItem = memo(MaterialListItemComponent);
