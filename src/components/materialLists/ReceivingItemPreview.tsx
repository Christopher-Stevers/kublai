"use client";

import { receivingDisplayUnit } from "~/lib/receiving-quantity-display";
import { MaterialListItem } from "./MaterialListItem";
import { useReplicacheMaterialList } from "~/hooks/use-replicache-material-list";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import type { PartFacts } from "~/lib/slip-part-fit";

/** The same material-list card, with receipt controls disabled while inspecting. */
export function ReceivingItemPreview({
  item,
  part,
  materialListId,
  materialListName,
  supplierName,
}: {
  item: ReceiptOrderItem;
  part?: PartFacts;
  materialListId: string;
  materialListName?: string;
  supplierName?: string;
}) {
  const { items, materialList } = useReplicacheMaterialList(materialListId);
  // A part may occur more than once on a list; only use the exact sent line.
  const listed = items.find((line) => line.sentOrderItemId === item.id);
  const card = listed
    ? {
        ...listed,
        partDefinition: listed.partDefinition ?? null,
        supplierPart: listed.supplierPart ?? null,
      }
    : {
        id: item.id,
        sentOrderItemId: item.id,
        quantity: String(item.originalOrdered ?? item.ordered),
        unitCost: null,
        extendedPrice: null,
        descriptionSnapshot: item.description,
        partDefinition: part
          ? {
              id: part.partId,
              displayName: part.name,
              imageUrl: part.imageUrl ?? null,
              piecesPerPack: item.piecesPerPack,
              individualUnit: item.individualUnit,
              bulkUnit: part.bulkUnit,
              material: null,
            }
          : null,
        supplierPart: null,
      };
  return (
    <div className="mx-auto w-full max-w-sm space-y-3">
      {(materialList?.name ?? materialListName) && (
        <p className="text-muted-foreground text-sm">
          {materialList?.name ?? materialListName}
        </p>
      )}
      <MaterialListItem
        item={card}
        materialListId={materialListId}
        verifyMode
        verifyReadOnly
        verifyOrderedQuantity={String(item.ordered)}
        verifyInitialReceivedQuantity={item.received}
        verifyInitialStatus={item.verificationStatus}
        verifyCaption={
          <div className="text-muted-foreground mt-2 space-y-1 text-center text-sm">
            {receivingDisplayUnit(item.unit) && <p>Unit: {receivingDisplayUnit(item.unit)}</p>}
            {item.sku && <p>{item.sku}</p>}
            {supplierName && <p>{supplierName}</p>}
          </div>
        }
      />
    </div>
  );
}
