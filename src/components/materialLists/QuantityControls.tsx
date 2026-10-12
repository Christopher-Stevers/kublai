"use client";

import { PackQuantityControls } from "./PackQuantityControls";
import { packContents, packsFromPieces } from "~/lib/pack-quantity";

import { purchaseQuantity } from "~/lib/purchase-quantity";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { markUserAction } from "~/lib/performance-marks";

interface QuantityControlsProps {
  itemId: string;
  quantity: number;
  orderMultiple?: string | null;
  piecesPerPack?: number | null;
  materialListId: string;
  pendingSync?: boolean;
  compact?: boolean;
  orientation?: "horizontal" | "vertical";
}

export function QuantityControls({
  itemId,
  quantity,
  orderMultiple,
  piecesPerPack,
  materialListId,
  pendingSync = false,
  compact = false,
  orientation = "horizontal",
}: QuantityControlsProps) {
  const { saveQuantity: saveQuantityDurably } = useWorkspaceMutations();
  const [displayedQuantity, setDisplayedQuantity] = useState(quantity);
  const [inputValue, setInputValue] = useState(quantity.toString());
  const displayedQuantityRef = useRef(quantity);
  const [saveError, setSaveError] = useState(false);
  const lastQueuedQuantityRef = useRef<{ quantity: number; at: number } | null>(
    null,
  );

  useEffect(() => {
    const locallyQueuedQuantity = lastQueuedQuantityRef.current;

    if (!pendingSync) {
      lastQueuedQuantityRef.current = null;
      displayedQuantityRef.current = quantity;
      setDisplayedQuantity(quantity);
      setInputValue(quantity.toString());
      return;
    }

    const localQuantityStillSettling =
      locallyQueuedQuantity !== null &&
      Date.now() - locallyQueuedQuantity.at < 15_000;

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
  }, [pendingSync, quantity]);

  const commitQuantity = (nextQuantity: number) => {
    if (lastQueuedQuantityRef.current?.quantity === nextQuantity) return;
    lastQueuedQuantityRef.current = { quantity: nextQuantity, at: Date.now() };
    // Persist locally before any debounce or navigation; only network work waits.
    void saveQuantityDurably({
      materialListId,
      itemId,
      quantity: nextQuantity,
    })
      .then(() => {
        if (lastQueuedQuantityRef.current?.quantity === nextQuantity)
          setSaveError(false);
      })
      .catch(() => {
        if (lastQueuedQuantityRef.current?.quantity === nextQuantity) {
          lastQueuedQuantityRef.current = null;
          setSaveError(true);
        }
      });
  };

  const setQuantityImmediately = (nextQuantity: number) => {
    if (nextQuantity < packsFromPieces(1, piecesPerPack)) return;
    markUserAction("quantity-change", {
      itemId,
      materialListId,
      quantity: nextQuantity,
    });
    displayedQuantityRef.current = nextQuantity;
    setDisplayedQuantity(nextQuantity);
    setInputValue(nextQuantity.toString());
    commitQuantity(nextQuantity);
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
    commitQuantity(parsedQuantity);
  };

  const handleInputChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "");
    setInputValue(numericValue);
    const parsedQuantity = Number.parseInt(numericValue, 10);
    if (Number.isFinite(parsedQuantity) && parsedQuantity >= 1) {
      displayedQuantityRef.current = parsedQuantity;
      setDisplayedQuantity(parsedQuantity);
      commitQuantity(parsedQuantity);
    }
  };

  const orderedQuantity = purchaseQuantity(displayedQuantity, orderMultiple);
  const purchaseSuffix =
    orderedQuantity !== displayedQuantity ? (
      <span
        className="text-muted-foreground shrink-0 pr-1 text-xs tabular-nums"
        aria-label={`Order quantity: ${orderedQuantity}`}
        title={`Orders in multiples of ${orderMultiple}`}
      >
        ({orderedQuantity.toLocaleString("en-CA", { maximumFractionDigits: 6 })}
        )
      </span>
    ) : null;

  if (packContents(piecesPerPack) > 1) {
    return <div className="min-w-0 flex-1">
      <PackQuantityControls orderMultiple={orderMultiple} quantity={displayedQuantity} piecesPerPack={piecesPerPack!} minimum={packsFromPieces(1, piecesPerPack)} onChange={setQuantityImmediately} />
      {saveError && <Button variant="outline" size="sm" onClick={() => commitQuantity(displayedQuantityRef.current)}>Retry quantity save</Button>}
    </div>;
  }

  // Wider than tall so +/- are easy to hit with a thumb.
  const buttonClassName = compact
    ? "h-8 w-11 shrink-0 p-0"
    : "h-10 w-12 p-0 sm:h-11 sm:w-14";
  const inputClassName = compact
    ? "h-8 min-w-0 flex-1 [appearance:textfield] px-1 text-center text-sm font-medium [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    : "h-10 w-12 [appearance:textfield] px-1 text-center font-medium sm:h-11 sm:w-14 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

  if (orientation === "vertical") {
    return (
      <div
        className={
          compact
            ? "flex w-full flex-col items-center justify-center gap-1"
            : "flex flex-col items-center justify-center gap-1"
        }
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setQuantityImmediately(displayedQuantity + 1)}
          className={buttonClassName}
          aria-label="Increase quantity"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
        <div className="border-input focus-within:ring-ring/50 flex w-full min-w-0 items-center rounded-md border focus-within:ring-2">
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={inputValue}
            onChange={(event) => handleInputChange(event.target.value)}
            onBlur={(event) => commitInputQuantity(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className={`${inputClassName} border-0 shadow-none focus-visible:ring-0`}
            aria-label="Quantity"
            aria-invalid={saveError}
            title={
              saveError
                ? "Quantity could not be saved. Press Enter to retry."
                : undefined
            }
          />
          {purchaseSuffix}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setQuantityImmediately(displayedQuantity - 1)}
          disabled={displayedQuantity <= 1}
          className={buttonClassName}
          aria-label="Decrease quantity"
        >
          <MinusIcon className="h-4 w-4" />
        </Button>
        {saveError ? (
          <Button
            variant="outline"
            size="sm"
            aria-label="Retry quantity save"
            onClick={() => commitQuantity(displayedQuantityRef.current)}
          >
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "flex w-full items-center justify-center gap-1"
          : "flex items-center justify-center gap-1"
      }
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => setQuantityImmediately(displayedQuantity - 1)}
        disabled={displayedQuantity <= 1}
        className={buttonClassName}
        aria-label="Decrease quantity"
      >
        <MinusIcon className="h-4 w-4" />
      </Button>
      <div className="border-input focus-within:ring-ring/50 flex min-w-0 flex-1 items-center rounded-md border focus-within:ring-2">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={(event) => commitInputQuantity(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className={`${inputClassName} border-0 shadow-none focus-visible:ring-0`}
          aria-label="Quantity"
          aria-invalid={saveError}
          title={
            saveError
              ? "Quantity could not be saved. Press Enter to retry."
              : undefined
          }
        />
        {purchaseSuffix}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setQuantityImmediately(displayedQuantity + 1)}
        className={buttonClassName}
        aria-label="Increase quantity"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>
      {saveError ? (
        <Button
          variant="outline"
          size="sm"
          aria-label="Retry quantity save"
          onClick={() => commitQuantity(displayedQuantityRef.current)}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
