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
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";

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
  suppliers?: ReplicacheSupplier[];
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
  suppliers,
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
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.removeItem({
      materialListId,
      itemId: item.id,
    }));
  };

  const partName =
    item.partDefinition?.displayName ||
    item.descriptionSnapshot ||
    "Unknown Part";
  const creatorName = item.addedBy?.name?.trim() || item.addedBy?.email?.trim();
  return (
    <Card className="group relative w-full gap-0 overflow-hidden rounded-2xl py-0 shadow-sm transition-all [content-visibility:auto] [contain-intrinsic-size:20rem] hover:shadow-md">
      <CardContent className="p-0">
        <div className="flex w-full flex-col p-3">
          <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-gray-100">
            {item.partDefinition?.imageUrl ? (
              <Image
                src={item.partDefinition.imageUrl}
                alt={item.partDefinition.displayName}
                fill
                className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                draggable={false}
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

          <div className="flex min-h-[2.75rem] items-start justify-center text-center text-black">
            <h3 className="line-clamp-2 text-sm font-medium leading-snug">
              {partName}
            </h3>
          </div>

          {creatorName && (
            <div
              className="text-muted-foreground mt-1 flex min-w-0 items-center justify-center gap-1 overflow-hidden text-xs"
              title={`Added by ${creatorName}`}
            >
              <UserIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="block min-w-0 truncate">{creatorName}</span>
            </div>
          )}

          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1 px-0 py-1.5">
              <span className="shrink-0 text-[9px] font-medium tracking-tighter text-gray-400 uppercase">
                Quantity
              </span>
              <QuantityControls
                itemId={item.id}
                quantity={quantity}
                materialListId={materialListId}
                pendingSync={item.pendingSync}
                compact
              />
            </div>

            <div className="flex items-center gap-1 px-0 py-1.5">
              <span className="shrink-0 text-[9px] font-medium tracking-tighter text-gray-400 uppercase">
                Supplier
              </span>
              <SupplierSelector
                itemId={item.id}
                partDefinitionId={item.partDefinition?.id ?? ""}
                currentSupplierPartId={item.supplierPart?.id}
                currentSupplierId={item.selectedSupplierId}
                materialListId={materialListId}
                suppliers={suppliers}
                compact
              />
            </div>

            <div className="grid h-9 min-w-0 grid-cols-[3rem_minmax(0,1fr)_1.5rem_2rem] items-center gap-0.5 px-1">
              <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
                Total
              </span>
              <span className="min-w-0 truncate text-right text-sm font-semibold text-gray-900 tabular-nums sm:text-base">
                ${lineTotal.toFixed(2)}
              </span>
              <div className="flex items-center justify-center">
                <ItemSyncBadge status={syncStatus ?? (item.pendingSync ? "pending" : "synced")} />
              </div>
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
