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
import { Label } from "~/components/ui/label";

interface AddMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMaterialCreated: (materialName: string) => void;
}

export function AddMaterialDialog({
  open,
  onOpenChange,
  onMaterialCreated,
}: AddMaterialDialogProps) {
  const utils = api.useUtils();
  const [materialName, setMaterialName] = useState("");

  const createMaterial = api.catalogue.createMaterial.useMutation({
    onSuccess: (newMaterial) => {
      if (newMaterial?.name) {
        onMaterialCreated(newMaterial.name);
      }
      setMaterialName("");
      onOpenChange(false);
      void utils.catalogue.getMaterials.invalidate();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!materialName.trim()) {
      return;
    }

    createMaterial.mutate({ name: materialName.trim() });
  };

  const isLoading = createMaterial.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Material</DialogTitle>
          <DialogDescription>
            Create a new material that will be available for future part selections
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="materialName">
                Material Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="materialName"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                placeholder="e.g., Stainless Steel, Aluminum"
                required
                disabled={isLoading}
                className="mt-1"
                autoFocus
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
            <Button type="submit" disabled={isLoading || !materialName.trim()}>
              {isLoading ? "Creating..." : "Create Material"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


