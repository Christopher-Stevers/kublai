"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
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

  const utils = api.useUtils();
  const createSupplier = api.supplier.create.useMutation({
    onSuccess: (newSupplier) => {
      void utils.supplier.list.invalidate();
      if (onSupplierCreated && newSupplier) {
        onSupplierCreated(newSupplier.id);
      }
      onOpenChange(false);
      // Reset form but preserve initialName if provided
      setName(initialName || "");
      setContactEmail("");
      setContactPhone("");
      setOrderingNotes("");
      setLocationId(null);
    },
  });

  // Update form when initialData changes (e.g., when dialog opens for editing)
  useEffect(() => {
    if (open) {
      if (initialName && !initialData?.name) {
        setName(initialName);
      }
      if (initialData?.locationId !== undefined) {
        setLocationId(initialData.locationId);
      }
    }
  }, [initialName, initialData, open]);

  const updateSupplier = api.supplier.update.useMutation({
    onSuccess: () => {
      void utils.supplier.list.invalidate();
      if (supplierId) {
        void utils.supplier.getById.invalidate({ id: supplierId });
      }
      onOpenChange(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (supplierId) {
      updateSupplier.mutate({
        id: supplierId,
        name,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        orderingNotes: orderingNotes || undefined,
        locationId: locationId ?? null,
      });
    } else {
      createSupplier.mutate({
        name,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        orderingNotes: orderingNotes || undefined,
        locationId: locationId ?? null,
      });
    }
  };

  const isLoading = createSupplier.isPending || updateSupplier.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {supplierId ? "Edit Supplier" : "Add Supplier"}
          </DialogTitle>
          <DialogDescription>
            {supplierId
              ? "Update supplier information."
              : "Add a new supplier to your organization."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Supplier Name *
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter supplier name"
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="contactEmail" className="text-sm font-medium">
                Contact Email
              </label>
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="supplier@example.com"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="contactPhone" className="text-sm font-medium">
                Contact Phone
              </label>
              <Input
                id="contactPhone"
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(555) 123-4567"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="location" className="text-sm font-medium">
                Location (Optional)
              </label>
              <LocationSelector
                value={locationId}
                onChange={setLocationId}
                disabled={isLoading}
                placeholder="Select location..."
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="orderingNotes" className="text-sm font-medium">
                Ordering Notes
              </label>
              <textarea
                id="orderingNotes"
                value={orderingNotes}
                onChange={(e) => setOrderingNotes(e.target.value)}
                placeholder="Any special instructions for ordering..."
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !name.trim()}>
              {isLoading
                ? "Saving..."
                : supplierId
                  ? "Update Supplier"
                  : "Add Supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

