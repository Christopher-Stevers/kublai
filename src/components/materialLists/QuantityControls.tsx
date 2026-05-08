"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { MinusIcon, PlusIcon } from "lucide-react";
import {
  applyOfflineQuantityUpdate,
  enqueueOfflineMutation,
  setActiveItemSyncStatus,
} from "~/lib/offline-material-list-mutations";
import { markUserAction } from "~/lib/performance-marks";

interface QuantityControlsProps {
  itemId: string;
  quantity: number;
  materialListId: string;
  compact?: boolean;
  orientation?: "horizontal" | "vertical";
}

export function QuantityControls({
  itemId,
  quantity,
  materialListId,
  compact = false,
  orientation = "horizontal",
}: QuantityControlsProps) {
  const utils = api.useUtils();
  const [displayedQuantity, setDisplayedQuantity] = useState(quantity);
  const [inputValue, setInputValue] = useState(quantity.toString());
  const displayedQuantityRef = useRef(quantity);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateItem = api.materialList.updateMaterialListItem.useMutation({
    onMutate: () => {
      void setActiveItemSyncStatus(materialListId, itemId, "syncing");
    },
    onSuccess: (updatedItem, variables) => {
      if (updatedItem?.updatedAt) {
        utils.materialList.getMaterialList.setData(
          { materialListId },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      updatedAt: updatedItem.updatedAt,
                      syncVersion:
                        updatedItem.updatedAt instanceof Date
                          ? updatedItem.updatedAt.toISOString()
                          : String(updatedItem.updatedAt),
                    }
                  : item,
              ),
            };
          },
        );
      }

      if (variables.quantity === displayedQuantityRef.current) {
        void setActiveItemSyncStatus(materialListId, itemId, "synced");
      }
    },
    onError: () => {
      void setActiveItemSyncStatus(materialListId, itemId, "pending");
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
  });

  useEffect(() => {
    displayedQuantityRef.current = quantity;
    setDisplayedQuantity(quantity);
    setInputValue(quantity.toString());
  }, [quantity]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const updateCachedQuantity = (nextQuantity: number) => {
    utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
      if (!old) return old;

      const updatedItems = old.items.map((item) => {
        if (item.id !== itemId) return item;

        const unitCost = item.unitCost
          ? parseFloat(item.unitCost.toString())
          : 0;
        const extendedPrice = nextQuantity * unitCost;

        return {
          ...item,
          quantity: nextQuantity.toString(),
          extendedPrice: extendedPrice.toString(),
        };
      });

      const materialTotal = updatedItems.reduce((sum, item) => {
        const price = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + price;
      }, 0);

      return {
        ...old,
        items: updatedItems,
        materialTotal,
      };
    });
  };

  const queueOfflineQuantityChange = (nextQuantity: number) => {
    void applyOfflineQuantityUpdate(materialListId, itemId, nextQuantity);
    void enqueueOfflineMutation({
      type: "updateItemQuantity",
      materialListId,
      itemId,
      quantity: nextQuantity,
      queuedAt: new Date().toISOString(),
    });
  };

  const saveQuantity = (nextQuantity: number) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void setActiveItemSyncStatus(materialListId, itemId, "syncing");
      updateItem.mutate({
        itemId,
        quantity: nextQuantity,
      });
    }, 200);
  };

  const setQuantityImmediately = (nextQuantity: number) => {
    if (nextQuantity < 1) return;

    markUserAction("quantity-change", { itemId, materialListId, quantity: nextQuantity });
    displayedQuantityRef.current = nextQuantity;
    setDisplayedQuantity(nextQuantity);
    setInputValue(nextQuantity.toString());
    updateCachedQuantity(nextQuantity);

    if (typeof window !== "undefined" && !window.navigator.onLine) {
      queueOfflineQuantityChange(nextQuantity);
      return;
    }

    void setActiveItemSyncStatus(materialListId, itemId, "pending");
    saveQuantity(nextQuantity);
  };

  const commitInputQuantity = (rawValue: string) => {
    const parsedQuantity = Number.parseInt(rawValue, 10);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
      setInputValue(displayedQuantity.toString());
      return;
    }

    setQuantityImmediately(parsedQuantity);
  };

  const handleInputChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "");
    setInputValue(numericValue);

    const parsedQuantity = Number.parseInt(numericValue, 10);
    if (Number.isFinite(parsedQuantity) && parsedQuantity >= 1) {
      displayedQuantityRef.current = parsedQuantity;
      setDisplayedQuantity(parsedQuantity);
      updateCachedQuantity(parsedQuantity);

      if (typeof window !== "undefined" && !window.navigator.onLine) {
        queueOfflineQuantityChange(parsedQuantity);
        return;
      }

      void setActiveItemSyncStatus(materialListId, itemId, "pending");
      saveQuantity(parsedQuantity);
    }
  };

  const handleDecrease = () => {
    setQuantityImmediately(displayedQuantity - 1);
  };

  const handleIncrease = () => {
    setQuantityImmediately(displayedQuantity + 1);
  };

  const buttonClassName = compact
    ? "h-8 w-8 p-0"
    : "h-10 w-10 p-0 sm:h-11 sm:w-11";
  const inputClassName = compact
    ? "h-8 w-11 [appearance:textfield] px-1 text-center text-sm font-medium [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    : "h-10 w-12 [appearance:textfield] px-1 text-center font-medium sm:h-11 sm:w-14 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

  if (orientation === "vertical") {
    return (
      <div className="flex flex-col items-center justify-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={handleIncrease}
          className={buttonClassName}
          aria-label="Increase quantity"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={(event) => commitInputQuantity(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          className={inputClassName}
          aria-label="Quantity"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleDecrease}
          disabled={displayedQuantity <= 1}
          className={buttonClassName}
          aria-label="Decrease quantity"
        >
          <MinusIcon className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDecrease}
        disabled={displayedQuantity <= 1}
        className={buttonClassName}
        aria-label="Decrease quantity"
      >
        <MinusIcon className="h-4 w-4" />
      </Button>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        onChange={(event) => handleInputChange(event.target.value)}
        onBlur={(event) => commitInputQuantity(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className={inputClassName}
        aria-label="Quantity"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={handleIncrease}
        className={buttonClassName}
        aria-label="Increase quantity"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
