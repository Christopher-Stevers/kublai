"use client";
import { AlertTriangleIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { WaitingItem } from "~/lib/order-waiting";
import { receivingQuantity } from "~/lib/receiving-quantity-display";

const TITLE = "Still waiting for material";

/** A warning triangle on an order that has begun receiving and still has
 * material to come. Tap or hover it for the items and quantities. */
export function OrderWaitingWarning({
  items,
  className = "",
}: {
  items: WaitingItem[];
  className?: string;
}) {
  if (!items.length) return null;
  const lines = items.map(
    (i) => `${receivingQuantity(i.outstanding, i.unit)} · ${i.description}`,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${TITLE}: ${items.length} ${items.length === 1 ? "item" : "items"}`}
          title={[TITLE, ...lines].join("\n")}
          // Inside a <summary>, a tap opens the list without folding it.
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className={`focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded text-amber-700 hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:outline-none dark:text-amber-300 ${className}`}
        >
          <AlertTriangleIcon aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangleIcon aria-hidden className="size-4 shrink-0" />
          {TITLE}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ul className="space-y-1 px-2 pb-1.5 text-sm">
          {items.map((i, n) => (
            <li key={n} className="flex gap-2">
              <span className="shrink-0 font-medium tabular-nums">
                {receivingQuantity(i.outstanding, i.unit)}
              </span>
              <span className="min-w-0 break-words">{i.description}</span>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
