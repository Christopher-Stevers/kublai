import { findJobPrice, type JobPriceEntry, type JobPriceIndex } from "./job-pricing";
export function jobPriceStatus(
  book:
    | {
        policy: { active: boolean } | null;
        entries: readonly JobPriceEntry[] | JobPriceIndex;
      }
    | undefined,
  partId?: string | null,
  supplierId?: string | null,
  supplierPartId?: string | null,
) {
  if (!book?.policy?.active) return undefined;
  const entry = findJobPrice(book.entries, partId, supplierId, supplierPartId);
  if(entry?.preferJobPricing===false)return undefined;
  return !entry
    ? "unlisted"
    : entry.priceStatus === "confirmed"
      ? "confirmed"
      : entry.priceStatus === "estimated"
        ? "estimated"
        : "listed";
}
