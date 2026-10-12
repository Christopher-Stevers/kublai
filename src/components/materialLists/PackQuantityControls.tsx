"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { purchaseQuantity } from "~/lib/purchase-quantity";
import { packContents, packsFromPieces, pieceCount } from "~/lib/pack-quantity";

/** Values leaving this control are always selling packs, including fractional packs. */
export function PackQuantityControls({
  quantity,
  piecesPerPack,
  onChange,
  minimum = 0,
  disabled = false,
  orderMultiple,
}: {
  quantity: number;
  piecesPerPack: number;
  onChange: (packs: number) => void;
  minimum?: number;
  disabled?: boolean;
  orderMultiple?: string | null;
}) {
  const contents = packContents(piecesPerPack);
  const ordered = purchaseQuantity(quantity, orderMultiple, contents);
  const [piecesMode, setPiecesMode] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const toggleMode = () => {
    setDraft(null);
    setPiecesMode((value) => !value);
  };
  const save = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value))
      return;
    const packs = piecesMode
      ? packsFromPieces(Math.round(value), contents)
      : packsFromPieces(pieceCount(value, contents), contents);
    if (Number.isFinite(packs) && packs >= minimum && packs <= 999999.999999) {
      setDraft(null);
      onChange(packs);
    }
  };
  const step = (delta: number) => {
    const value = piecesMode
      ? pieceCount(quantity, contents)
      : Math.ceil(quantity);
    if (!piecesMode && value + delta <= 0) {
      setPiecesMode(true);
      return;
    }
    save(
      Math.max(
        piecesMode ? pieceCount(minimum, contents) : minimum,
        value + delta,
      ),
    );
  };
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      aria-label="Pack quantity controls"
    >
      <div className="flex min-w-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          className="h-9 w-8 shrink-0 p-0"
          disabled={disabled}
          aria-label="Decrease quantity"
          onClick={() => step(-1)}
        >
          <MinusIcon className="h-4 w-4" />
        </Button>
        <div className="border-input flex min-w-0 flex-1 items-center rounded-md border">
          {piecesMode ? (
            <span
              className="min-w-0 flex-1 px-1 text-center text-sm tabular-nums"
              aria-label="Pack quantity"
            >
              {ordered.toLocaleString("en-CA", { maximumFractionDigits: 6 })}
            </span>
          ) : (
            <Input
              aria-label="Quantity in packs"
              type="text"
              inputMode="numeric"
              disabled={disabled}
              value={draft ?? String(ordered)}
              onChange={(event) => {
                setDraft(event.target.value);
                if (event.target.value.trim()) save(Number(event.target.value));
              }}
              onBlur={() => setDraft(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  step(-1);
                }
              }}
              onWheel={(event) => {
                if (
                  event.currentTarget === document.activeElement &&
                  event.deltaY < 0 &&
                  quantity <= minimum
                )
                  setPiecesMode(true);
              }}
              className="h-9 min-w-0 flex-1 border-0 px-1 text-center shadow-none"
            />
          )}
          <button
            type="button"
            className="shrink-0 px-1 text-sm tabular-nums"
            disabled={disabled}
            onClick={() => toggleMode()}
            aria-label={`Edit pieces: ${pieceCount(quantity, contents)}`}
          >
            (x{pieceCount(quantity, contents)})
          </button>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-8 shrink-0 p-0"
          disabled={disabled}
          aria-label="Increase quantity"
          onClick={() => step(1)}
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center justify-center gap-2 text-xs">
        <button
          type="button"
          disabled={disabled}
          className="underline underline-offset-2"
          onClick={() => toggleMode()}
        >
          {piecesMode ? "Switch to packs" : `Packs · ${contents} pieces each`}
        </button>
        {piecesMode && (
          <Input
            autoFocus
            aria-label="Quantity in pieces"
            type="number"
            min="0"
            step="1"
            disabled={disabled}
            value={draft ?? pieceCount(quantity, contents)}
            onChange={(event) => {
              setDraft(event.target.value);
              if (event.target.value.trim()) save(Number(event.target.value));
            }}
            onBlur={() => setDraft(null)}
            className="h-8 w-20 px-1 text-center"
          />
        )}
        {piecesMode && <span>Pieces</span>}
      </div>
    </div>
  );
}
