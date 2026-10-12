"use client";
import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
export function NewCadDialog({
  jobId,
  onClose,
  onCreated,
}: {
  jobId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [id] = useState(() => crypto.randomUUID()),
    [name, setName] = useState("New design");
  const create = api.models.createCad.useMutation({
    onSuccess: (model) => onCreated(model.id),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New CAD design</DialogTitle>
          <DialogDescription>
            Start an empty design for this job. Draw in plan, elevation or 3D.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ jobId, id, name: name.trim() });
          }}
        >
          <label className="block text-sm">
            Design name
            <input
              aria-label="Design name"
              autoFocus
              maxLength={160}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background mt-2 w-full rounded border p-3"
            />
          </label>
          {create.error && (
            <p role="alert" className="text-destructive text-sm">
              {create.error.message}
            </p>
          )}
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Creating…" : "Create design"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
