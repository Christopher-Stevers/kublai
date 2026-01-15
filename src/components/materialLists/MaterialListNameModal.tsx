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

  const utils = api.useUtils();
  const updateName = api.materialList.updateMaterialListName.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.materialList.getMaterialList.cancel({ materialListId });
      await utils.materialList.listMaterialLists.cancel();

      // Snapshot previous values
      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });
      const previousList = utils.materialList.listMaterialLists.getData();

      // Optimistically update material list detail
      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          materialList: {
            ...old.materialList,
            name: variables.name,
          },
        };
      });

      // Optimistically update material list in list
      utils.materialList.listMaterialLists.setData(undefined, (old) => {
        if (!old) return old;
        return old.map((list) =>
          list.id === materialListId
            ? { ...list, name: variables.name }
            : list,
        );
      });

      return { previousMaterialList, previousList };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousMaterialList) {
        utils.materialList.getMaterialList.setData(
          { materialListId },
          context.previousMaterialList,
        );
      }
      if (context?.previousList) {
        utils.materialList.listMaterialLists.setData(
          undefined,
          context.previousList,
        );
      }
    },
    onSettled: () => {
      void utils.materialList.getMaterialList.invalidate({ materialListId });
      void utils.materialList.listMaterialLists.invalidate();
    },
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  const handleSave = () => {
    if (!name.trim()) {
      return;
    }

    updateName.mutate({
      materialListId,
      name: name.trim(),
    });
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
            disabled={!name.trim() || updateName.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

