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

interface AddPartTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPartTypeCreated: (partTypeName: string) => void;
}

export function AddPartTypeDialog({
  open,
  onOpenChange,
  onPartTypeCreated,
}: AddPartTypeDialogProps) {
  const utils = api.useUtils();
  const [partTypeName, setPartTypeName] = useState("");

  const createPartType = api.catalogue.createPartType.useMutation({
    onSuccess: (newPartType) => {
      onPartTypeCreated(newPartType.name);
      setPartTypeName("");
      onOpenChange(false);
      void utils.catalogue.getPartTypes.invalidate();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!partTypeName.trim()) {
      return;
    }

    createPartType.mutate({ name: partTypeName.trim() });
  };

  const isLoading = createPartType.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Part Type</DialogTitle>
          <DialogDescription>
            Create a new part type that will be available for future part selections
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="partTypeName">
                Part Type Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="partTypeName"
                value={partTypeName}
                onChange={(e) => setPartTypeName(e.target.value)}
                placeholder="e.g., Fitting, Valve, Adapter"
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
            <Button type="submit" disabled={isLoading || !partTypeName.trim()}>
              {isLoading ? "Creating..." : "Create Part Type"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


