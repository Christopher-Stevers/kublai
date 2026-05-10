"use client";

import { useState, useEffect } from "react";
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
import {
  applyOfflineRenameMaterialList,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";

interface MaterialListNameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  initialName?: string | null;
}

export function MaterialListNameModal({
  open,
  onOpenChange,
  materialListId,
  initialName,
}: MaterialListNameModalProps) {
  const [name, setName] = useState(initialName || "");

  // Update name when initialName changes
  useEffect(() => {
    if (initialName !== undefined) {
      setName(initialName || "");
    }
  }, [initialName]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    void applyOfflineRenameMaterialList(materialListId, trimmedName);
    void enqueueOfflineMutation({
      type: "renameMaterialList",
      materialListId,
      name: trimmedName,
      queuedAt: new Date().toISOString(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Material List Name</DialogTitle>
          <DialogDescription>
            Update the name for this material list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label htmlFor="material-list-name" className="text-sm font-medium">
              Material List Name *
            </label>
            <Input
              id="material-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Main Floor Materials"
              className="mt-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSave();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
