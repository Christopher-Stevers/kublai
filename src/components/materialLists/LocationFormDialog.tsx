"use client";

import { useState } from "react";
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

interface LocationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLocationCreated?: (locationId: string) => void;
}

export function LocationFormDialog({
  open,
  onOpenChange,
  onLocationCreated,
}: LocationFormDialogProps) {
  const [name, setName] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [notes, setNotes] = useState("");

  const utils = api.useUtils();
  const createLocation = api.location.createLocation.useMutation({
    onSuccess: (newLocation) => {
      void utils.location.searchLocations.invalidate();
      if (onLocationCreated) {
        onLocationCreated(newLocation.id);
      }
      onOpenChange(false);
      // Reset form
      setName("");
      setAddress1("");
      setAddress2("");
      setCity("");
      setRegion("");
      setPostalCode("");
      setCountry("");
      setNotes("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    createLocation.mutate({
      name,
      address1: address1 || undefined,
      address2: address2 || undefined,
      city: city || undefined,
      region: region || undefined,
      postalCode: postalCode || undefined,
      country: country || undefined,
      notes: notes || undefined,
    });
  };

  const isLoading = createLocation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Location</DialogTitle>
          <DialogDescription>
            Add a new location to your organization.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Location Name *
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Main Office, Job Site #1"
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="address1" className="text-sm font-medium">
                Address 1
              </label>
              <Input
                id="address1"
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="Street address"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="address2" className="text-sm font-medium">
                Address 2
              </label>
              <Input
                id="address2"
                value={address2}
                onChange={(e) => setAddress2(e.target.value)}
                placeholder="Apartment, suite, etc."
                disabled={isLoading}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="city" className="text-sm font-medium">
                  City
                </label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="region" className="text-sm font-medium">
                  Region / State
                </label>
                <Input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="State or Province"
                  disabled={isLoading}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="postalCode" className="text-sm font-medium">
                  Postal Code
                </label>
                <Input
                  id="postalCode"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="ZIP / Postal Code"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="country" className="text-sm font-medium">
                  Country
                </label>
                <Input
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Country"
                  disabled={isLoading}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="notes" className="text-sm font-medium">
                Notes
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes about this location..."
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
              {isLoading ? "Creating..." : "Add Location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

