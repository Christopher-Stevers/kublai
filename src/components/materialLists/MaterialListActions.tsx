"use client";
import { FileTextIcon, PlusIcon, SendIcon, ShoppingCartIcon } from "lucide-react";
import { Button } from "~/components/ui/button";

export function MaterialListActions({
  total,
  canGenerate,
  blockedReason,
  canQuote = true,
  canOrder = true,
  onQuote,
  onOrder,
  onAdd,
  onNotes,
  isToolRequest = false,
}: {
  total: number;
  canGenerate: boolean;
  blockedReason?: string | null;
  /** Member may request quotes / send orders (permissions). */
  canQuote?: boolean;
  canOrder?: boolean;
  onQuote: () => void;
  onOrder: () => void;
  onAdd: () => void;
  onNotes?: () => void;
  /** Tool requests: no totals or quotes; "Request" sends to the tool room. */
  isToolRequest?: boolean;
}) {
  const style =
    "h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs";
  return (
    <div className="mx-auto max-w-6xl space-y-1.5">
      {!onNotes && !isToolRequest && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-base text-muted-foreground sm:text-lg">
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
        ) : isToolRequest ? (
          <>
            <Button
              className={`col-span-2 ${style}`}
              onClick={onOrder}
              disabled={!canGenerate}
              title={blockedReason ?? "Send to the tool room"}
            >
              <SendIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Send to Tool Room
            </Button>
            <Button variant="outline" className={style} onClick={onAdd} data-tutorial="add-part">
              <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Add Tool
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              className={style}
              onClick={onQuote}
              disabled={!canGenerate || !canQuote}
              title={!canQuote ? "You don't have permission to request quotes" : (blockedReason ?? "Generate quote")}
            >
              <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Quote
            </Button>
            <Button
              className={style}
              onClick={onOrder}
              disabled={!canGenerate || !canOrder}
              title={!canOrder ? "You don't have permission to send orders" : (blockedReason ?? "Order")}
            >
              <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Order
            </Button>
            <Button variant="outline" className={style} onClick={onAdd} data-tutorial="add-part">
              <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Add Part
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
