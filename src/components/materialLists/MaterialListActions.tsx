"use client";
import { FileTextIcon, PlusIcon, ShoppingCartIcon } from "lucide-react";
import { Button } from "~/components/ui/button";

export function MaterialListActions({
  total,
  canGenerate,
  blockedReason,
  onQuote,
  onOrder,
  onAdd,
  onNotes,
}: {
  total: number;
  canGenerate: boolean;
  blockedReason?: string | null;
  onQuote: () => void;
  onOrder: () => void;
  onAdd: () => void;
  onNotes?: () => void;
}) {
  const style =
    "h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs";
  return (
    <div className="mx-auto max-w-6xl space-y-1.5">
      {!onNotes && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-base text-gray-600 sm:text-lg">
            Material Total
          </span>
          <span className="text-base font-bold sm:text-lg">
            ${total.toFixed(2)}
          </span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {onNotes ? (
          <Button
            variant="outline"
            className={`col-span-3 ${style}`}
            onClick={onNotes}
          >
            <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
            Notes
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              className={style}
              onClick={onQuote}
              disabled={!canGenerate}
              title={blockedReason ?? "Generate quote"}
            >
              <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Quote
            </Button>
            <Button
              className={style}
              onClick={onOrder}
              disabled={!canGenerate}
              title={blockedReason ?? "Order"}
            >
              <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Order
            </Button>
            <Button variant="outline" className={style} onClick={onAdd}>
              <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Add Part
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
