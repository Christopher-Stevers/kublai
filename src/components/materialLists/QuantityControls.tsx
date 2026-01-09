"use client";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { MinusIcon, PlusIcon } from "lucide-react";

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
    onSuccess: () => {
      void utils.materialList.getMaterialList.invalidate({
        materialListId,
      });
    },
  });

  const handleDecrease = () => {
    if (quantity > 1) {
      updateItem.mutate({
        itemId,
        quantity: quantity - 1,
      });
    }
  };

  const handleIncrease = () => {
    updateItem.mutate({
      itemId,
      quantity: quantity + 1,
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDecrease}
        disabled={quantity <= 1 || updateItem.isPending}
        className="h-8 w-8 p-0"
      >
        <MinusIcon className="h-4 w-4" />
      </Button>
      <span className="min-w-[3rem] text-center font-medium">{quantity}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleIncrease}
        disabled={updateItem.isPending}
        className="h-8 w-8 p-0"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

