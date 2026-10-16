import { packContents, formatOrderedBulkQuantity } from "./pack-quantity";
export type OrderEmailItem = {
  quantity: string | null;
  supplierSku?: string | null;
  supplierSkuSnapshot?: string | null;
  descriptionSnapshot: string | null;
  partDefinitionDisplayName?: string | null;
  partDefinitionPiecesPerPack?: number | null;
  partDefinitionBulkUnit?: string | null;
  partDefinitionIndividualUnit?: string | null;
};
export function formatEmailItemLine(item: OrderEmailItem, includeSupplierSku = false) {
  const rawQty = item.quantity?.toString().trim() ?? "0";
  const parsedQty = Number(rawQty);
  const qty = Number.isFinite(parsedQty) && packContents(item.partDefinitionPiecesPerPack) > 1
    ? formatOrderedBulkQuantity(parsedQty, item.partDefinitionPiecesPerPack, item.partDefinitionBulkUnit, item.partDefinitionIndividualUnit)
    : Number.isFinite(parsedQty) ? parsedQty.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 6 }) : rawQty;
  const description = [item.descriptionSnapshot?.trim(), item.partDefinitionDisplayName?.trim()].find(value=>!!value) ?? "Item";
  const sku = [item.supplierSku?.trim(), item.supplierSkuSnapshot?.trim()].find(value=>!!value);
  return `${qty} - ${description}${includeSupplierSku && sku ? ` [SKU: ${sku}]` : ""}`;
}
export type SupplierSkuLine = { plain: string; withSku: string };
export function supplierSkuLines(items: OrderEmailItem[]): SupplierSkuLine[] {
  return items.map(item => ({ plain: formatEmailItemLine(item), withSku: formatEmailItemLine(item, true) })).filter(line => line.plain !== line.withSku);
}
/** Change only generated item lines; preserve edited subject, prose and notes. */
export function setEmailSupplierSkus(body: string, lines: SupplierSkuLine[], include: boolean) {
  const unused = [...lines];
  return body.split("\n").map(text => {
    const index = unused.findIndex(line => text === line.plain || text === line.withSku);
    if (index < 0) return text;
    const [line] = unused.splice(index, 1);
    return include ? line!.withSku : line!.plain;
  }).join("\n");
}
