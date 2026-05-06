"use client";

import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import { CheckCircle2Icon, Clock3Icon, Loader2Icon, TrashIcon } from "lucide-react";
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
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-900">
        <Loader2Icon className="h-3 w-3 animate-spin" />
        Syncing
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-900">
        <Clock3Icon className="h-3 w-3" />
        Pending sync
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
      <CheckCircle2Icon className="h-3 w-3" />
      Synced
    </span>
  );
}

export function MaterialListItem({ item, materialListId, syncStatus = "synced" }: MaterialListItemProps) {
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
      void utils.materialList.getMaterialList.invalidate({ materialListId });
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

        const updatedItems = old.items.filter((candidate) => candidate.id !== item.id);
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
      void utils.materialList.getMaterialList.invalidate({ materialListId });
      return;
    }

    removeItem.mutate({ itemId: item.id });
  };

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_2.5rem] gap-1.5 sm:grid-cols-[4rem_minmax(0,1fr)_9.5rem_13rem_2.75rem] sm:items-center sm:gap-4">
          <div className="col-span-3 min-w-0 sm:contents">
            <div className="flex min-w-0 items-start gap-3 sm:contents">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-gray-100 sm:h-16 sm:w-16">
                {item.partDefinition?.imageUrl ? (
                  <Image
                    src={item.partDefinition.imageUrl}
                    alt={item.partDefinition.displayName}
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

              <div className="min-w-0 flex-1 sm:block">
                <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 sm:truncate sm:text-base">
                  {item.partDefinition?.displayName ||
                    item.descriptionSnapshot ||
                    "Unknown Part"}
                </h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                  <span>
                    Total: <span className="font-semibold text-gray-900">${lineTotal.toFixed(2)}</span>
                  </span>
                  <ItemSyncBadge status={syncStatus} />
                </div>
                {item.addedBy && (
                  <p className="mt-0.5 hidden truncate text-xs text-gray-500 sm:block">
                    Added by {item.addedBy.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex h-10 min-w-0 items-center justify-center sm:h-11">
            <QuantityControls
              itemId={item.id}
              quantity={quantity}
              materialListId={materialListId}
            />
          </div>

          <div className="flex h-10 min-w-0 items-center sm:h-11">
            <SupplierSelector
              itemId={item.id}
              partDefinitionId={item.partDefinition?.id ?? ""}
              currentSupplierPartId={item.supplierPart?.id}
              materialListId={materialListId}
            />
          </div>

          <div className="flex h-10 items-center justify-center sm:h-11">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0"
              onClick={handleRemove}
              disabled={removeItem.isPending}
              aria-label="Remove item"
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
