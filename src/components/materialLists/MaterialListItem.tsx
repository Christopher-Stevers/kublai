"use client";

import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import { TrashIcon } from "lucide-react";
import Image from "next/image";
import {
  applyOfflineRemoveItem,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";

interface MaterialListItemProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
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
  };
  materialListId: string;
}

export function MaterialListItem({ item, materialListId }: MaterialListItemProps) {
  const utils = api.useUtils();
  const removeItem = api.materialList.removeMaterialListItem.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.materialList.getMaterialList.cancel({ materialListId });

      // Snapshot previous value
      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });

      // Optimistically remove item and recalculate totals
      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = old.items.filter(
          (item) => item.id !== variables.itemId,
        );

        // Recalculate material total
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
    onError: (err, variables, context) => {
      // Rollback on error
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

  const handleRemove = () => {
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      applyOfflineRemoveItem(materialListId, item.id);
      enqueueOfflineMutation({
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex items-start gap-3 sm:flex-1">
            {/* Part Image */}
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

            {/* Part Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 sm:text-base">
                    {item.partDefinition?.displayName ||
                      item.descriptionSnapshot ||
                      "Unknown Part"}
                  </h3>
                  {item.partDefinition?.material && (
                    <p className="mt-0.5 text-xs text-gray-600 sm:text-sm">
                      {item.partDefinition.material}
                    </p>
                  )}
                </div>
                {/* Mobile: Line Total and Delete Button */}
                <div className="flex items-center gap-2 sm:hidden">
                  <div className="text-right">
                    <p className="text-xs text-gray-600">Total</p>
                    <p className="text-base font-semibold">
                      ${lineTotal.toFixed(2)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0"
                    onClick={handleRemove}
                    disabled={removeItem.isPending}
                    aria-label="Remove item"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* Quantity Controls */}
              <div className="mt-2">
                <QuantityControls
                  itemId={item.id}
                  quantity={quantity}
                  materialListId={materialListId}
                />
              </div>

              {/* Supplier Selector */}
              <div className="mt-2">
                <SupplierSelector
                  itemId={item.id}
                  partDefinitionId={item.partDefinition?.id ?? ""}
                  currentSupplierPartId={item.supplierPart?.id}
                  materialListId={materialListId}
                />
              </div>
            </div>
          </div>

          {/* Desktop: Line Total and Actions */}
          <div className="hidden flex-col items-end gap-2 sm:flex">
            <div className="text-right">
              <p className="text-sm text-gray-600">Line Total</p>
              <p className="text-lg font-semibold">
                ${lineTotal.toFixed(2)}
              </p>
            </div>
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


