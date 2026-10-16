"use client";

import { useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { notify } from "~/components/ui/app-dialogs";
import { isValidOrderMultiple } from "~/lib/purchase-quantity";

export type SupplierListing =
  RouterOutputs["supplier"]["getById"]["supplierParts"][number];

export function SupplierPartDetails({
  listing,
  showPrice,
}: {
  listing: SupplierListing;
  showPrice: boolean;
}) {
  return (
    <div className="text-muted-foreground w-full space-y-1 text-xs break-words">
      <p>{listing.supplierName?.trim() ? listing.supplierName : "No supplier description"}</p>
      <p>SKU: {listing.supplierSku?.trim() ? listing.supplierSku : "Not set"}</p>
      {showPrice && (
        <p>
          {listing.lastKnownUnitCost == null || listing.lastKnownUnitCost === ""
            ? "Price not set"
            : `${listing.currency} ${Number(listing.lastKnownUnitCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
        </p>
      )}
      <p>
        Order multiple: {Number(listing.packSize ?? 1)}
        {listing.packUom ? ` ${listing.packUom.code}` : ""}
      </p>
    </div>
  );
}

export function SupplierPartEditor({
  listings,
  ...props
}: {
  listings: SupplierListing[];
  supplierName: string;
  canEdit: boolean;
  showPrice: boolean;
  bulkUnit?: string | null;
  onClose: () => void;
}) {
  const [listingId, setListingId] = useState(listings[0]?.id);
  const listing = listings.find((item) => item.id === listingId) ?? listings[0];
  if (!listing) return null;
  return (
    <SupplierListingEditor
      key={listing.id}
      {...props}
      listing={listing}
      listingPicker={
        listings.length > 1 ? (
          <label className="block space-y-1 text-sm">
            Supplier listing
            <select
              aria-label="Supplier listing"
              value={listing.id}
              onChange={(event) => setListingId(event.target.value)}
              className="border-input bg-background h-9 w-full rounded-md border px-2"
            >
              {listings.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.supplierSku?.trim() ? item.supplierSku : "No SKU"} —{" "}
                  {item.supplierName?.trim() ? item.supplierName : item.partDefinition?.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null
      }
    />
  );
}

function SupplierListingEditor({
  listing,
  listingPicker,
  supplierName,
  canEdit,
  showPrice,
  bulkUnit,
  onClose,
}: {
  listingPicker: React.ReactNode;
  listing: SupplierListing;
  supplierName: string;
  canEdit: boolean;
  showPrice: boolean;
  bulkUnit?: string | null;
  onClose: () => void;
}) {
  const [sku, setSku] = useState(listing.supplierSku ?? "");
  const [description, setDescription] = useState(listing.supplierName ?? "");
  const [multiple, setMultiple] = useState(listing.packSize ?? "1");
  const [uom, setUom] = useState(listing.packUomId ?? "");
  const [price, setPrice] = useState(listing.lastKnownUnitCost ?? "");
  const [currency, setCurrency] = useState(listing.currency);
  const [notes, setNotes] = useState(listing.notes ?? "");
  const [preferred, setPreferred] = useState(listing.isPreferred);
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const units = api.catalogue.getAllUnits.useQuery();
  const update = api.supplier.updateSupplierPart.useMutation();
  const save = async () => {
    if (!canEdit || update.isPending) return;
    if (!isValidOrderMultiple(multiple)) {
      setError("Enter a positive order multiple.");
      return;
    }
    if (
      showPrice &&
      price.trim() &&
      !/^\d{1,8}(\.\d{1,4})?$/.test(price.trim())
    ) {
      setError(
        "Enter a non-negative price with up to four decimal places, or leave it blank.",
      );
      return;
    }
    if (showPrice && !/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      setError("Enter a three-letter currency, such as CAD.");
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({
        id: listing.id,
        supplierSku: sku.trim(),
        supplierName: description.trim(),
        packSize: multiple.trim(),
        packUomId: uom || null,
        ...(showPrice
          ? {
              lastKnownUnitCost: price.trim() || null,
              currency: currency.trim().toUpperCase(),
            }
          : {}),
        notes: notes.trim(),
        isPreferred: preferred,
      });
      await Promise.all([
        utils.supplier.getById.invalidate({ id: listing.supplierId }),
        utils.supplier.getSupplierPartsByPart.invalidate({
          partDefinitionId: listing.partDefinitionId,
        }),
        utils.catalogue.searchParts.invalidate(),
      ]);
      notify("Supplier part saved", "success");
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save supplier information. Try again.",
      );
    }
  };
  const field = "space-y-1 text-sm";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplierName} part information</DialogTitle>
          <DialogDescription>
            {listing.partDefinition?.displayName}. These fields belong to this
            supplier. The catalogue description and photo stay the same.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          {!update.isPending && listingPicker}
          <fieldset
            disabled={!canEdit || update.isPending}
            className="space-y-4"
          >
            <label className={`block ${field}`}>
              Supplier SKU
              <Input
                value={sku}
                maxLength={255}
                onChange={(event) => setSku(event.target.value)}
              />
            </label>
            <label className={`block ${field}`}>
              Supplier description
              <Input
                value={description}
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 items-end gap-3">
              <label className={field}>
                Minimum / order multiple
                <Input
                  inputMode="decimal"
                  value={multiple}
                  onChange={(event) => setMultiple(event.target.value)}
                />
              </label>
              <label className={field}>
                Order unit
                <select
                  aria-label="Order unit"
                  className="border-input bg-background h-9 w-full rounded-md border px-2"
                  value={uom}
                  onChange={(event) => setUom(event.target.value)}
                >
                  <option value="">
                    Part default{bulkUnit ? ` (${bulkUnit})` : ""}
                  </option>
                  {units.data?.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.displayName} ({unit.code})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {showPrice && (
              <>
                <div className="grid grid-cols-2 items-end gap-3">
                  <label className={field}>
                    Price per {bulkUnit?.trim() ? bulkUnit : "ordering unit"}
                    <Input
                      inputMode="decimal"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      placeholder="Not set"
                    />
                  </label>
                  <label className={field}>
                    Currency
                    <Input
                      value={currency}
                      maxLength={3}
                      onChange={(event) => setCurrency(event.target.value)}
                    />
                  </label>
                </div>
                <p className="text-muted-foreground text-xs">
                  Supplier catalogue price. Job-specific pricing stays separate.
                </p>
              </>
            )}
            <label className={`block ${field}`}>
              Notes
              <textarea
                value={notes}
                maxLength={10000}
                onChange={(event) => setNotes(event.target.value)}
                className="border-input bg-background min-h-20 w-full rounded-md border p-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={preferred}
                onChange={(event) => setPreferred(event.target.checked)}
              />
              Preferred supplier for this part
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={update.isPending}
            >
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save supplier information"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
