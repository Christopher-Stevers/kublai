"use client";
import { QuantityControls } from "./QuantityControls";
import { SupplierSelector } from "./SupplierSelector";
import { packContents } from "~/lib/pack-quantity";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { MoreVerticalIcon, TrashIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { MaterialListItemProps } from "./MaterialListItem";
import type { ReplicacheSyncStatus } from "~/hooks/use-replicache-material-list";
import Image from "~/components/catalogue/PartImage";
import { QuotedBadge } from "~/components/jobPricing/QuotedBadge";
import { firstText } from "~/lib/first-text";
import { cn } from "~/lib/utils";
type MaterialListSyncStatus = ReplicacheSyncStatus;
function getUserInitials(
  name: string | null | undefined,
  email: string | null | undefined,
) {
  const source = (
    firstText(name?.trim(), email?.split("@")[0]?.trim()) ?? "?"
  ).replace(/[^a-z0-9\s._-]/gi, "");
  const parts = source
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }

  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

export function InitialsSyncBadge({
  user,
  status,
}: {
  user: MaterialListItemProps["item"]["addedBy"] | null | undefined;
  status: MaterialListSyncStatus;
}) {
  const displayName =
    firstText(user?.name?.trim(), user?.email?.trim()) ?? "Unknown user";
  const initials = getUserInitials(user?.name, user?.email);
  const statusLabel =
    status === "syncing"
      ? "Syncing"
      : status === "pending"
        ? "Pending sync"
        : "Synced";

  const statusClasses =
    status === "syncing"
      ? "ring-primary"
      : status === "pending"
        ? "ring-amber-500"
        : "ring-emerald-500";

  return (
    <div
      className="absolute top-2 left-2 z-20"
      title={`Added by ${displayName} • ${statusLabel}`}
      aria-label={`Added by ${displayName}. ${statusLabel}.`}
    >
      <div
        className={cn(
          "text-foreground ring-offset-background/80 dark:bg-card/95 dark:text-foreground relative flex h-[27px] w-[27px] items-center justify-center rounded-full bg-white/95 text-[9px] font-semibold shadow-sm ring-2 ring-offset-1",
          statusClasses,
        )}
      >
        {initials}
      </div>
    </div>
  );
}

/** Shared markup only: no receipt state, effects, timers or mutation authority. */
export function MaterialListPartPhoto({
  item,
  verifyMode = false,
  children,
}: {
  item: MaterialListItemProps["item"];
  verifyMode?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="part-photo-frame bg-muted relative mb-3 aspect-square w-full overflow-hidden rounded-xl"
      style={
        verifyMode
          ? {
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
              userSelect: "none",
            }
          : undefined
      }
      onContextMenu={verifyMode ? (event) => event.preventDefault() : undefined}
    >
      {item.partDefinition?.imageUrl ? (
        <Image
          src={item.partDefinition.imageUrl}
          alt={item.partDefinition.displayName}
          fill
          // Cards are under 300px wide unless one fills a phone screen.
          sizes="(max-width: 420px) 100vw, 300px"
          className="part-photo object-contain p-1"
          draggable={false}
          onContextMenu={
            verifyMode ? (event) => event.preventDefault() : undefined
          }
          style={
            verifyMode
              ? {
                  WebkitTouchCallout: "none",
                  WebkitUserSelect: "none",
                  userSelect: "none",
                }
              : undefined
          }
        />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-300">
          <svg
            className="h-7 w-7 sm:h-9 sm:w-9"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
        </div>
      )}
      <QuotedBadge status={item.jobPriceStatus} onPhoto />
      {children}
    </div>
  );
}

/** Release-only row menu; caller retains the single-flight removal authority. */
export function MaterialListRowMenu({
  partName,
  handleRemove,
}: {
  partName: string;
  handleRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="bg-card/90 ring-border text-muted-foreground hover:text-foreground absolute top-2 right-2 z-20 h-[27px] w-[27px] rounded-full p-0 shadow-sm ring-1 after:absolute after:-inset-2 after:rounded-full"
          aria-label={`More for ${partName}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVerticalIcon className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem variant="destructive" onSelect={handleRemove}>
          <TrashIcon className="h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shared editable controls only; receipt lifecycle remains in its owner. */
export function MaterialListEditableFields({
  item,
  materialListId,
  suppliers,
  isToolRequest = false,
}: Pick<
  MaterialListItemProps,
  "item" | "materialListId" | "suppliers" | "isToolRequest"
>) {
  const quantity = parseFloat(item.quantity);
  return (
    <div className="mt-auto flex flex-col gap-2 pt-2">
      {/* Each label sits just above its control. */}
      <div className="flex flex-col gap-0.5">
        {(isToolRequest ||
          packContents(item.partDefinition?.piecesPerPack) === 1) && (
          <span className="text-muted-foreground/80 px-0.5 text-[10px] font-medium tracking-wide uppercase">
            Quantity
          </span>
        )}
        <QuantityControls
          itemId={item.id}
          quantity={quantity}
          orderMultiple={isToolRequest ? null : item.supplierPart?.packSize}
          piecesPerPack={
            isToolRequest ? null : item.partDefinition?.piecesPerPack
          }
          bulkUnit={item.partDefinition?.bulkUnit}
          individualUnit={item.partDefinition?.individualUnit}
          materialListId={materialListId}
          pendingSync={item.pendingSync}
          compact
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground/80 px-0.5 text-[10px] font-medium tracking-wide uppercase">
          Supplier
        </span>
        {isToolRequest ? (
          <span className="text-muted-foreground px-1 text-sm">Tool room</span>
        ) : (
          <SupplierSelector
            currentVersion={item.supplierVersion}
            itemId={item.id}
            partDefinitionId={item.partDefinition?.id ?? ""}
            currentSupplierPartId={item.supplierPart?.id}
            currentSupplierId={item.selectedSupplierId}
            materialListId={materialListId}
            suppliers={suppliers}
            compact
          />
        )}
      </div>

      {/* Line totals are hidden for now (prices are not set up yet). */}
    </div>
  );
}
