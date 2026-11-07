"use client";

import { useId, useRef, useState } from "react";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { uploadPackingSlip } from "~/lib/packing-slip-upload";

// Keep this browser limit aligned with documents/storage.ts. The server checks
// it again while streaming, along with current permissions and source version.
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif";

async function isSlipFile(file: File): Promise<boolean> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Could not read this file. Choose it again."));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
  const text = (from: number, to: number) =>
    String.fromCharCode(...bytes.slice(from, to));
  return (
    text(0, 5) === "%PDF-" ||
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    ) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    ["GIF87a", "GIF89a"].includes(text(0, 6)) ||
    (text(0, 4) === "RIFF" && text(8, 12) === "WEBP")
  );
}

/** Replace the whole source using document versioning. This never rereads the
 * slip, adopts a new reading, or changes any approved receipt quantities. */
export function ReceivingReplaceSource({
  jobId,
  documentId,
  expectedVersionId,
  onDone,
  onCancel,
  disabled = false,
}: {
  jobId: string;
  documentId: string;
  expectedVersionId: string;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const unavailable = disabled || busy || saved || !expectedVersionId;

  async function replace() {
    if (unavailable || !file || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!file.size || file.size > MAX_SOURCE_BYTES)
        throw new Error("Choose a nonempty file no larger than 50 MB.");
      if (!(await isSlipFile(file)))
        throw new Error("Choose a PDF, JPEG, PNG, WebP or GIF packing slip.");
      const form = new FormData();
      form.set("file", file);
      form.set("documentId", documentId);
      form.set("expectedVersionId", expectedVersionId);
      const result = await uploadPackingSlip<{
        success: boolean;
        documentId: string;
        versionId: string;
      }>(`/api/job-documents/upload?jobId=${encodeURIComponent(jobId)}`, form);
      if (
        !result.success ||
        result.documentId !== documentId ||
        !result.versionId
      )
        throw new Error(
          "The save could not be confirmed. Reload the slip before trying again.",
        );
      setSaved(true);
      try {
        await onDone();
      } catch {
        setError(
          "The replacement was saved, but the review could not refresh. Reload the slip to continue.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The save could not be confirmed. Reload the slip before trying again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Replace packing-slip source"
      className="space-y-4 rounded-xl border p-4"
    >
      <div className="space-y-2">
        <h3 className="font-semibold">Replace source file</h3>
        <p className="text-muted-foreground text-sm">
          Choose a clearer scan of the same delivery. For a missing page, upload
          a complete PDF containing all pages. This replaces the whole source
          file.
        </p>
        <p className="text-muted-foreground text-sm">
          The previous file, saved comparisons and approved quantities are kept.
          Review the new source before continuing approval. Uploading does not
          start another reading or approve any lines.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={inputId} className="block text-sm font-medium">
          Replacement PDF or image
        </label>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={unavailable}
          className="border-input block w-full min-w-0 rounded-md border p-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-2 disabled:opacity-50"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError("");
          }}
        />
        <p className="text-muted-foreground text-xs">
          PDF, JPEG, PNG, WebP or GIF · up to 50 MB
        </p>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          Replacement saved. Review the new source to continue.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          {saved ? "Close" : "Cancel"}
        </Button>
        {!saved && (
          <Button
            type="button"
            onClick={() => void replace()}
            disabled={unavailable || !file}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {busy ? "Saving replacement…" : "Replace source"}
          </Button>
        )}
      </div>
    </section>
  );
}
