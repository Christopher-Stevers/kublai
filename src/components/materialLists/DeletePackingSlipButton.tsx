"use client";
import { useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { confirmAction } from "~/components/ui/app-dialogs";

/** Recycle the duplicate file through the existing permission-checked document API. */
export function DeletePackingSlipButton({
  jobId,
  documentId,
  name,
  disabled,
  onDeleted,
}: {
  jobId: string;
  documentId: string;
  name: string;
  disabled?: boolean;
  onDeleted: () => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        !(await confirmAction({
          title: "Delete this packing slip?",
          description: `“${name}” will move to Documents → Recycle bin and leave the receiving queue. The earlier slip stays. Any quantities already received remain recorded; deleting a file does not reverse a receipt. You can restore the file later.`,
          confirmLabel: "Delete packing slip",
          destructive: true,
        }))
      )
        return;
      const response = await fetch(
        `/api/job-documents?jobId=${encodeURIComponent(jobId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, action: "delete", documentId }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw Error(
          result.error || "Could not delete this packing slip. Try again.",
        );
      onDeleted();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not delete this packing slip. Try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div>
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => void remove()}
      >
        <Trash2Icon className="size-4" />
        {busy ? "Deleting…" : "Delete this packing slip"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
