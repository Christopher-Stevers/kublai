"use client";

import { useEffect, useRef, useState } from "react";
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
  const [displayedQuantity, setDisplayedQuantity] = useState(quantity);
  const [inputValue, setInputValue] = useState(quantity.toString());
  const displayedQuantityRef = useRef(quantity);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputQuantityRef = useRef<number | null>(null);
  const lastQueuedQuantityRef = useRef<{ quantity: number; at: number } | null>(null);

  useEffect(() => {
    const locallyQueuedQuantity = lastQueuedQuantityRef.current;
    const localQuantityStillSettling =
      locallyQueuedQuantity !== null && Date.now() - locallyQueuedQuantity.at < 15_000;

    // A parent render can briefly hand this control an older quantity while
    // Dexie/outbox hydration is catching up. Do not let that stale prop snap
    // the button/input back after the user already picked a newer local value.
    // After a short grace window, accept the prop again so a real server/error
    // correction does not freeze the control forever.
    if (
      localQuantityStillSettling &&
      locallyQueuedQuantity !== null &&
      quantity !== locallyQueuedQuantity.quantity
    ) {
      return;
    }

    if (
      locallyQueuedQuantity !== null &&
      !localQuantityStillSettling &&
      quantity === locallyQueuedQuantity.quantity
    ) {
      lastQueuedQuantityRef.current = null;
    }

    displayedQuantityRef.current = quantity;
    setDisplayedQuantity(quantity);
    setInputValue(quantity.toString());
  }, [quantity]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      pendingInputQuantityRef.current = null;
    };
  }, []);

  const enqueueQuantityChange = (nextQuantity: number) => {
    if (lastQueuedQuantityRef.current?.quantity === nextQuantity) return;
    lastQueuedQuantityRef.current = { quantity: nextQuantity, at: Date.now() };
    void enqueueOfflineMutation({
      type: "updateItemQuantity",
      materialListId,
      itemId,
      quantity: nextQuantity,
      queuedAt: new Date().toISOString(),
    });
  };

  const queueOfflineQuantityChange = (nextQuantity: number) => {
    void setActiveItemSyncStatus(materialListId, itemId, "pending");
    enqueueQuantityChange(nextQuantity);
    void applyOfflineQuantityUpdate(materialListId, itemId, nextQuantity);
  };

  const scheduleInputQuantityChange = (nextQuantity: number) => {
    pendingInputQuantityRef.current = nextQuantity;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const quantityToQueue = pendingInputQuantityRef.current;
      pendingInputQuantityRef.current = null;
      saveTimerRef.current = null;
      if (quantityToQueue !== null) enqueueQuantityChange(quantityToQueue);
    }, 650);
  };

  const flushInputQuantityChange = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const quantityToQueue = pendingInputQuantityRef.current;
    pendingInputQuantityRef.current = null;
    if (quantityToQueue !== null) enqueueQuantityChange(quantityToQueue);
  };

  const setQuantityImmediately = (nextQuantity: number) => {
    if (nextQuantity < 1) return;

    markUserAction("quantity-change", { itemId, materialListId, quantity: nextQuantity });
    displayedQuantityRef.current = nextQuantity;
    setDisplayedQuantity(nextQuantity);
    setInputValue(nextQuantity.toString());
    queueOfflineQuantityChange(nextQuantity);
  };

  const commitInputQuantity = (rawValue: string) => {
    const parsedQuantity = Number.parseInt(rawValue, 10);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
      setInputValue(displayedQuantity.toString());
      return;
    }

    displayedQuantityRef.current = parsedQuantity;
    setDisplayedQuantity(parsedQuantity);
    setInputValue(parsedQuantity.toString());
    void applyOfflineQuantityUpdate(materialListId, itemId, parsedQuantity);
    void setActiveItemSyncStatus(materialListId, itemId, "pending");
    flushInputQuantityChange();
  };

  const handleInputChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "");
    setInputValue(numericValue);

    const parsedQuantity = Number.parseInt(numericValue, 10);
    if (Number.isFinite(parsedQuantity) && parsedQuantity >= 1) {
      displayedQuantityRef.current = parsedQuantity;
      setDisplayedQuantity(parsedQuantity);
      void applyOfflineQuantityUpdate(materialListId, itemId, parsedQuantity);
      void setActiveItemSyncStatus(materialListId, itemId, "pending");
      scheduleInputQuantityChange(parsedQuantity);
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
    ? "h-8 w-8 [appearance:textfield] px-1 text-center text-sm font-medium [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
