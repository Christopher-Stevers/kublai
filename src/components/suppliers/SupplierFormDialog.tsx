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
import {
  createEmptySupplierContact,
  getPrimarySupplierContact,
  normalizeSupplierContacts,
  type SupplierContact,
  type SupplierContactEmailRole,
} from "~/lib/supplier-contacts";

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
    contacts?: SupplierContact[] | null;
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
  const [contacts, setContacts] = useState<SupplierContact[]>(() =>
    normalizeSupplierContacts(initialData?.contacts, initialData),
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
      if (initialData) {
        setContacts(
          normalizeSupplierContacts(initialData.contacts, initialData),
        );
      } else if (!supplierId) {
        setContacts([]);
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

    const normalizedContacts = normalizeSupplierContacts(contacts, {
      contactName,
      contactEmail,
      contactPhone,
    });
    const primaryContact = getPrimarySupplierContact(normalizedContacts);
    const fields = {
      name,
      contactName: primaryContact?.name ?? null,
      contactEmail: primaryContact?.email ?? null,
      contactPhone: primaryContact?.phone ?? null,
      contacts: normalizedContacts,
      orderingNotes: orderingNotes || null,
      locationId: locationId ?? null,
    };

    if (supplierId) {
      void mutateMaterialListAndSync(
        getMaterialListReplicache().mutate.updateSupplier({
          supplierId,
          ...fields,
        }),
      );
    } else {
      const newId = crypto.randomUUID();
      void mutateMaterialListAndSync(
        getMaterialListReplicache().mutate.createSupplier({
          supplierId: newId,
          ...fields,
        }),
      );
      onSupplierCreated?.(newId);
    }

    onOpenChange(false);
    setName(initialName || "");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setContacts([]);
    setOrderingNotes("");
    setLocationId(null);
  };

  const updateContact = (
    contactId: string,
    updates: Partial<Omit<SupplierContact, "id">>,
  ) => {
    setContacts((current) =>
      current.map((contact) =>
        contact.id === contactId
          ? {
              id: contact.id,
              name: "name" in updates ? (updates.name ?? null) : contact.name,
              email:
                "email" in updates ? (updates.email ?? null) : contact.email,
              phone:
                "phone" in updates ? (updates.phone ?? null) : contact.phone,
              emailRole: (updates.emailRole ??
                contact.emailRole) as SupplierContactEmailRole,
            }
          : contact,
      ),
    );
  };

  const addContact = () => {
    setContacts((current) => [...current, createEmptySupplierContact()]);
  };

  const removeContact = (contactId: string) => {
    setContacts((current) =>
      current.filter((contact) => contact.id !== contactId),
    );
  };

  const isPending = false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {supplierId ? "Edit Supplier" : "Add Supplier"}
          </DialogTitle>
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
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">Contacts</h3>
                <p className="text-muted-foreground text-xs">
                  Choose who goes in To or CC when emailing orders.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addContact}
              >
                Add Contact
              </Button>
            </div>

            {contacts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No contacts added.
              </p>
            ) : (
              <div className="space-y-3">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_auto]"
                  >
                    <Input
                      value={contact.name ?? ""}
                      onChange={(e) =>
                        updateContact(contact.id, {
                          name: e.target.value || null,
                        })
                      }
                      placeholder="Name"
                    />
                    <Input
                      value={contact.email ?? ""}
                      onChange={(e) =>
                        updateContact(contact.id, {
                          email: e.target.value || null,
                        })
                      }
                      placeholder="Email"
                      type="email"
                    />
                    <Input
                      value={contact.phone ?? ""}
                      onChange={(e) =>
                        updateContact(contact.id, {
                          phone: e.target.value || null,
                        })
                      }
                      placeholder="Phone"
                    />
                    <select
                      value={contact.emailRole}
                      onChange={(e) =>
                        updateContact(contact.id, {
                          emailRole: e.target.value as SupplierContactEmailRole,
                        })
                      }
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                    >
                      <option value="to">To</option>
                      <option value="cc">CC</option>
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeContact(contact.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
