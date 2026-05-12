"use client";

import { memo, useRef } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import Image from "next/image";
import { getMaterialListReplicache } from "~/lib/replicache-material-list";

type MaterialListSyncStatus = "synced" | "pending" | "syncing";

interface MaterialListItemProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    pendingSync?: boolean;
    partDefinition: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
    selectedSupplierId?: string | null;
    supplierPart: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
    uom?: {
      id: string;
      code: string;
      displayName: string | null;
    } | null;
    addedBy?: {
      id: string;
      name: string;
      email: string | null;
    } | null;
  };
  materialListId: string;
  syncStatus?: MaterialListSyncStatus;
}

function ItemSyncBadge({ status }: { status: MaterialListSyncStatus }) {
  if (status === "syncing") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200"
        title="Syncing"
        aria-label="Syncing"
      >
        <Loader2Icon className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200"
        title="Pending sync"
        aria-label="Pending sync"
      >
        <Clock3Icon className="h-3 w-3" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
      title="Synced"
      aria-label="Synced"
    >
      <CheckCircle2Icon className="h-3 w-3" />
    </span>
  );
}

function MaterialListItemComponent({
  item,
  materialListId,
  syncStatus,
}: MaterialListItemProps) {
  const removeInFlightRef = useRef(false);
  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.extendedPrice
    ? parseFloat(item.extendedPrice)
    : quantity * unitCost;

  const handleRemove = () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    void getMaterialListReplicache().mutate.removeItem({
      materialListId,
      itemId: item.id,
    });
  };

  const partName =
    item.partDefinition?.displayName ||
    item.descriptionSnapshot ||
    "Unknown Part";
  const creatorName = item.addedBy?.name?.trim() || item.addedBy?.email?.trim();
  return (
    <Card className="group relative overflow-hidden rounded-2xl border-gray-200 bg-gradient-to-br from-white to-gray-50/60 shadow-sm transition-all [content-visibility:auto] [contain-intrinsic-size:9rem] hover:border-gray-300 hover:shadow-md">
      <CardContent className="relative p-3 sm:p-4">
        <div className="absolute top-2 right-2 z-10 sm:top-2.5 sm:right-2.5">
          <ItemSyncBadge status={syncStatus ?? (item.pendingSync ? "pending" : "synced")} />
        </div>
        <div className="grid h-[7.25rem] grid-cols-[7.25rem_minmax(0,1fr)_2rem] gap-3 sm:h-32 sm:grid-cols-[8rem_minmax(0,1fr)_2rem] sm:gap-4">
          {/* Image — anchors card height */}
          <div className="relative h-[7.25rem] w-[7.25rem] overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 shadow-sm ring-1 ring-gray-200 ring-inset sm:h-32 sm:w-32">
            {item.partDefinition?.imageUrl ? (
              <Image
                src={item.partDefinition.imageUrl}
                alt={item.partDefinition.displayName}
                fill
                className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
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
          </div>

          {/* Content column — evenly spaced rows pinned to image height */}
          <div className="grid min-w-0 grid-rows-[1fr_2rem_2rem] gap-2 overflow-hidden">
            <div className="flex min-w-0 flex-col justify-center">
              <h3 className="line-clamp-1 text-sm leading-tight font-semibold tracking-tight text-gray-900 sm:text-base">
                {partName}
              </h3>

            </div>

            <div className="grid h-8 min-w-0 max-w-full grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-xl bg-white/70 pr-1">
              <div className="w-[6.5rem] shrink-0">
                <QuantityControls
                  itemId={item.id}
                  quantity={quantity}
                  materialListId={materialListId}
                  compact
                />
              </div>
              {creatorName && (
                <div
                  className="text-muted-foreground flex min-w-0 items-center gap-1 overflow-hidden pr-2 text-xs"
                  title={`Added by ${creatorName}`}
                >
                  <UserIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="block min-w-0 truncate">{creatorName}</span>
                </div>
              )}
            </div>

            <div className="grid h-8 min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
              <div className="w-[6.5rem] min-w-0 shrink-0">
                <SupplierSelector
                  itemId={item.id}
                  partDefinitionId={item.partDefinition?.id ?? ""}
                  currentSupplierPartId={item.supplierPart?.id}
                  currentSupplierId={item.selectedSupplierId}
                  materialListId={materialListId}
                  compact
                />
              </div>
              <div className="flex h-8 min-w-0 items-center justify-end gap-1.5 rounded-xl bg-white/70 px-2 ring-1 ring-gray-100">
                <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
                  Total
                </span>
                <span className="min-w-0 truncate text-right text-sm font-semibold text-gray-900 tabular-nums sm:text-base">
                  ${lineTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Action rail — same rows as content, so icons line up */}
          <div className="grid h-[7.25rem] w-8 grid-rows-[1fr_2rem_2rem] gap-2 sm:h-32">
            <div />
            <div />
            <div className="flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                onClick={handleRemove}
                aria-label="Remove item"
              >
                <TrashIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const MaterialListItem = memo(MaterialListItemComponent);
