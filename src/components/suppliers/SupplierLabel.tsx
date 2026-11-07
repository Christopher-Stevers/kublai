"use client";
import { createContext, useContext } from "react";
import {
  applicablePriceBook,
  supplierLabel,
  type SupplierPricingLabelEntry,
} from "~/lib/supplier-label";
export const SupplierLabelContext = createContext<{
  entries: readonly SupplierPricingLabelEntry[];
  pending?: boolean;
  unavailable?: boolean;
}>({ entries: [] });
export function useSupplierLabel() {
  const context = useContext(SupplierLabelContext);
  return (
    name: string | null | undefined,
    supplierId?: string | null,
    partId?: string | null,
    listingId?: string | null,
    bookName?: string | null,
    fallback?: string,
  ) =>
    supplierLabel(
      name,
      bookName ??
        (context.unavailable
          ? "Pricing unavailable"
          : context.pending
            ? "Checking pricing…"
            : applicablePriceBook(
                context.entries,
                supplierId,
                partId,
                listingId,
              )),
      fallback,
    );
}
export function SupplierLabel({
  name,
  supplierId,
  partId,
  listingId,
  bookName,
  fallback,
}: {
  name?: string | null;
  supplierId?: string | null;
  partId?: string | null;
  listingId?: string | null;
  bookName?: string | null;
  fallback?: string;
}) {
  const label = useSupplierLabel();
  return <>{label(name, supplierId, partId, listingId, bookName, fallback)}</>;
}
