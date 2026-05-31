"use client";

import { useState, useEffect } from "react";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LocationSelector } from "~/components/ui/LocationSelector";

interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId?: string;
  initialName?: string;
  initialData?: {
    name: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    orderingNotes?: string | null;
    locationId?: string | null;
  };
  onSupplierCreated?: (supplierId: string) => void;
}

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplierId,
  initialName,
  initialData,
  onSupplierCreated,
}: SupplierFormDialogProps) {
  const [name, setName] = useState(initialData?.name || initialName || "");
  const [contactName, setContactName] = useState(
    initialData?.contactName || "",
  );
  const [contactEmail, setContactEmail] = useState(
    initialData?.contactEmail || "",
  );
  const [contactPhone, setContactPhone] = useState(
    initialData?.contactPhone || "",
  );
  const [orderingNotes, setOrderingNotes] = useState(
    initialData?.orderingNotes || "",
  );
  const [locationId, setLocationId] = useState<string | null>(
    initialData?.locationId ?? null,
  );

  useEffect(() => {
    if (open) {
      if (initialName && !initialData?.name) {
        setName(initialName);
      }
      if (initialData?.name !== undefined) {
        setName(initialData.name);
      }
      if (initialData?.contactName !== undefined) {
        setContactName(initialData.contactName ?? "");
      }
      if (initialData?.contactEmail !== undefined) {
        setContactEmail(initialData.contactEmail ?? "");
      }
      if (initialData?.contactPhone !== undefined) {
        setContactPhone(initialData.contactPhone ?? "");
      }
      if (initialData?.orderingNotes !== undefined) {
        setOrderingNotes(initialData.orderingNotes ?? "");
      }
      if (initialData?.locationId !== undefined) {
        setLocationId(initialData.locationId);
      }
    }
  }, [initialName, initialData, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const fields = {
      name,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      orderingNotes: orderingNotes || null,
      locationId: locationId ?? null,
    };

    if (supplierId) {
      void mutateMaterialListAndSync(getMaterialListReplicache().mutate.updateSupplier({
        supplierId,
        ...fields,
      }));
    } else {
      const newId = crypto.randomUUID();
      void mutateMaterialListAndSync(getMaterialListReplicache().mutate.createSupplier({
        supplierId: newId,
        ...fields,
      }));
      onSupplierCreated?.(newId);
    }

    onOpenChange(false);
    setName(initialName || "");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setOrderingNotes("");
    setLocationId(null);
  };

  const isPending = false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplierId ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          <DialogDescription>
            {supplierId
              ? "Update supplier information."
              : "Add a new supplier for parts and orders."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Supplier name"
            required
          />
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Contact name"
          />
          <Input
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="Contact email"
            type="email"
          />
          <Input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="Contact phone"
          />
          <Input
            value={orderingNotes}
            onChange={(e) => setOrderingNotes(e.target.value)}
            placeholder="Ordering notes"
          />
          <LocationSelector
            value={locationId ?? undefined}
            onChange={setLocationId}
            placeholder="Select location..."
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
