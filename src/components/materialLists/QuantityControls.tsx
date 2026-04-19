"use client";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { MinusIcon, PlusIcon } from "lucide-react";
import {
  applyOfflineQuantityUpdate,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";

interface QuantityControlsProps {
  itemId: string;
  quantity: number;
  materialListId: string;
}

export function QuantityControls({
  itemId,
  quantity,
  materialListId,
}: QuantityControlsProps) {
  const utils = api.useUtils();
  const updateItem = api.materialList.updateMaterialListItem.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.materialList.getMaterialList.cancel({ materialListId });

      // Snapshot previous value
      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });

      // Optimistically update item quantity and recalculate totals
      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = old.items.map((item) => {
          if (item.id === variables.itemId) {
            const newQuantity =
              variables.quantity !== undefined
                ? variables.quantity.toString()
                : item.quantity;
            const unitCost = item.unitCost
              ? parseFloat(item.unitCost.toString())
              : 0;
            const newExtendedPrice = parseFloat(newQuantity) * unitCost;

            return {
              ...item,
              quantity: newQuantity,
              extendedPrice: newExtendedPrice.toString(),
            };
          }
          return item;
        });

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

  const queueOfflineQuantityChange = (nextQuantity: number) => {
    applyOfflineQuantityUpdate(materialListId, itemId, nextQuantity);
    enqueueOfflineMutation({
      type: "updateItemQuantity",
      materialListId,
      itemId,
      quantity: nextQuantity,
      queuedAt: new Date().toISOString(),
    });
    void utils.materialList.getMaterialList.invalidate({ materialListId });
  };

  const handleDecrease = () => {
    if (quantity > 1) {
      const nextQuantity = quantity - 1;
      if (typeof window !== "undefined" && !window.navigator.onLine) {
        queueOfflineQuantityChange(nextQuantity);
        return;
      }

      updateItem.mutate({
        itemId,
        quantity: nextQuantity,
      });
    }
  };

  const handleIncrease = () => {
    const nextQuantity = quantity + 1;
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      queueOfflineQuantityChange(nextQuantity);
      return;
    }

    updateItem.mutate({
      itemId,
      quantity: nextQuantity,
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDecrease}
        disabled={quantity <= 1 || updateItem.isPending}
        className="h-11 w-11 p-0"
        aria-label="Decrease quantity"
      >
        <MinusIcon className="h-5 w-5" />
      </Button>
      <span className="min-w-[3rem] text-center font-medium">{quantity}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleIncrease}
        disabled={updateItem.isPending}
        className="h-11 w-11 p-0"
        aria-label="Increase quantity"
      >
        <PlusIcon className="h-5 w-5" />
      </Button>
    </div>
  );
}


