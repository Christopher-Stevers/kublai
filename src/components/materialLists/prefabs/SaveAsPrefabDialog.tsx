"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { notify } from "~/components/ui/app-dialogs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useReplicacheMaterialList } from "~/hooks/use-replicache-material-list";
import { prefabItemsFromList } from "~/lib/prefab-add";
import { api } from "~/trpc/react";

/** "Save as Prefab" from a material list's More menu: name it and save. */
export function SaveAsPrefabDialog({
  open,
  onOpenChange,
  materialListId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
}) {
  const { items } = useReplicacheMaterialList(materialListId);
  const [name, setName] = useState("");
  const utils = api.useUtils();
  const create = api.prefabs.create.useMutation({
    onError: (error) => notify(error.message, "error"),
  });
  const parts = prefabItemsFromList(items);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || parts.length === 0) return;
    const prefab = await create.mutateAsync({ name: trimmed, items: parts }).catch(() => null);
    if (!prefab) return;
    void utils.prefabs.list.invalidate();
    notify(`Saved this list as ${prefab.name}`, "success", 3000);
    setName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save as Prefab</DialogTitle>
          <DialogDescription>
            Saves {parts.length} part{parts.length === 1 ? "" : "s"} from this list so anyone in
            the company can add them in one go.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            autoCorrect="off"
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Prefab name, e.g. Bathroom rough-in"
            aria-label="Prefab name"
            className="h-10"
          />
          <DialogFooter className="mt-4 grid grid-cols-2 gap-2 sm:flex">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || parts.length === 0 || create.isPending}>
              {create.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
