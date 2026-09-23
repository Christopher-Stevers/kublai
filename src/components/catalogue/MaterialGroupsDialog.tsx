"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
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
import { materialGroupPathSchema } from "~/lib/material-groups";
import { requestCatalogueReplicachePull } from "~/lib/replicache-catalogue";

export function MaterialGroupsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Material groups</DialogTitle>
          <DialogDescription>
            Put related materials together. For nested groups, separate names
            with /, such as PVC / Gasketed SDR. Leave a group blank to show that
            material at the top level.
          </DialogDescription>
        </DialogHeader>
        {open && <MaterialGroupEditor onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
function MaterialGroupEditor({ onClose }: { onClose: () => void }) {
  const query = api.catalogue.getMaterials.useQuery();
  const save = api.catalogue.setMaterialGroups.useMutation();
  const utils = api.useUtils();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const records = query.data ?? [];
  const visible = records.filter((material) =>
    material.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const changes = records.filter(
    (material) =>
      Object.hasOwn(drafts, material.id) &&
      drafts[material.id] !== material.groupPath.join(" / "),
  );
  async function submit() {
    setError(null);
    try {
      const assignments = changes.map((material) => {
        const text = drafts[material.id]!.trim();
        const parsed = materialGroupPathSchema.safeParse(
          text ? text.split("/").map((part) => part.trim()) : [],
        );
        if (!parsed.success)
          throw new Error(
            `${material.name}: use up to five nonempty group names, each at most 60 characters.`,
          );
        return { materialId: material.id, groupPath: parsed.data };
      });
      await save.mutateAsync({ assignments });
      requestCatalogueReplicachePull(0);
      await Promise.all([
        utils.catalogue.getMaterials.invalidate(),
        utils.catalogue.getPartWizardSummary.invalidate(),
      ]);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save groups. Please try again.",
      );
    }
  }
  return (
    <div className="space-y-4">
      <Input
        aria-label="Find material to group"
        placeholder="Find a material…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {query.isLoading && <p>Loading materials…</p>}
      {query.error && (
        <p role="alert">
          Could not load materials.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      <div className="space-y-3">
        {visible.map((material) => (
          <label
            key={material.id}
            className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_2fr]"
          >
            <span className="text-sm font-medium">{material.name}</span>
            <Input
              aria-label={`Group for ${material.name}`}
              value={drafts[material.id] ?? material.groupPath.join(" / ")}
              placeholder="No group"
              disabled={save.isPending}
              maxLength={310}
              onChange={(event) =>
                setDrafts((prior) => ({
                  ...prior,
                  [material.id]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      {!query.isLoading && !query.error && !visible.length && (
        <p>No matching materials.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={save.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={
            !changes.length ||
            changes.length > 200 ||
            save.isPending ||
            query.isError
          }
        >
          {save.isPending
            ? "Saving…"
            : `Save groups${changes.length ? ` (${changes.length})` : ""}`}
        </Button>
      </DialogFooter>
    </div>
  );
}
