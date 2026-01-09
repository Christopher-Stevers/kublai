"use client";

import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import { TrashIcon } from "lucide-react";
import Image from "next/image";

interface MaterialListItemProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    partDefinition: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
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
    uom: {
      id: string;
      code: string;
      displayName: string | null;
    } | null;
  };
  materialListId: string;
}

export function MaterialListItem({ item, materialListId }: MaterialListItemProps) {
  const utils = api.useUtils();
  const removeItem = api.materialList.removeMaterialListItem.useMutation({
    onSuccess: () => {
      void utils.materialList.getMaterialList.invalidate({
        materialListId,
      });
    },
  });

  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.extendedPrice
    ? parseFloat(item.extendedPrice)
    : quantity * unitCost;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Part Image */}
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
            {item.partDefinition?.imageUrl ? (
              <Image
                src={item.partDefinition.imageUrl}
                alt={item.partDefinition.displayName}
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <svg
                  className="h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Part Details */}
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">
              {item.partDefinition?.displayName ||
                item.descriptionSnapshot ||
                "Unknown Part"}
            </h3>
            {item.partDefinition?.material && (
              <p className="text-sm text-gray-600">
                {item.partDefinition.material}
              </p>
            )}

            {/* Quantity Controls */}
            <div className="mt-2">
              <QuantityControls
                itemId={item.id}
                quantity={quantity}
                materialListId={materialListId}
              />
            </div>

            {/* Supplier Selector */}
            <div className="mt-2">
              <SupplierSelector
                itemId={item.id}
                partDefinitionId={item.partDefinition?.id ?? ""}
                currentSupplierPartId={item.supplierPart?.id}
                materialListId={materialListId}
              />
            </div>
          </div>

          {/* Line Total and Actions */}
          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <p className="text-sm text-gray-600">Line Total</p>
              <p className="text-lg font-semibold">
                ${lineTotal.toFixed(2)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeItem.mutate({ itemId: item.id })}
              disabled={removeItem.isPending}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

