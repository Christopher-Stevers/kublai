"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CameraIcon, FileTextIcon, UploadIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useOnlineStatus } from "~/hooks/use-online-status";
import type { PackingSlipLink } from "~/server/documents/types";
type Slip = {
  id: string;
  name: string;
  createdAt: string;
  packingSlip: PackingSlipLink;
};
export function PackingSlips({
  jobId,
  materialListId,
  orderId,
}: {
  jobId: string;
  materialListId: string;
  orderId?: string | null;
}) {
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [slips, setSlips] = useState<Slip[]>([]),
    [canUpload, setCanUpload] = useState(false);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  useEffect(() => setRetryFile(null), [jobId, materialListId, orderId]);
  const camera = useRef<HTMLInputElement>(null),
    files = useRef<HTMLInputElement>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          jobId,
          materialListId,
          ...(orderId ? { orderId } : {}),
        });
        const response = await fetch(
          `/api/job-documents/packing-slips?${query}`,
          { cache: "no-store", signal },
        );
        const result = (await response.json()) as {
          documents?: Slip[];
          canUpload?: boolean;
          error?: string;
        };
        if (!response.ok)
          throw Error(result.error ?? "Could not load packing slips.");
        setSlips(result.documents ?? []);
        setCanUpload(!!result.canUpload);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [jobId, materialListId, orderId],
  );
  useEffect(() => {
    if (!open || !online) return;
    const controller = new AbortController();
    setError(null);
    setSlips([]);
    setCanUpload(false);
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not load packing slips.",
        );
    });
    return () => controller.abort();
  }, [open, online, load]);
  const upload = async (file: File | undefined) => {
    if (!file || !orderId) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("packingSlipOrderId", orderId);
      const response = await fetch(
        `/api/job-documents/upload?jobId=${encodeURIComponent(jobId)}`,
        { method: "POST", body: form },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw Error(
          result.error ?? "Could not save packing slip. Please retry.",
        );
      setRetryFile(null);
      await load();
    } catch (e) {
      setRetryFile(file);
      setError(e instanceof Error ? e.message : "Could not save packing slip.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileTextIcon className="mr-2 size-4" />
        Packing slips
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) setRetryFile(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Packing slips</DialogTitle>
            <DialogDescription>
              {orderId
                ? "Photograph or upload this delivery’s packing slip. It is saved in Documents → Packing Slips and linked to this material list. Receiving quantities stay unchanged."
                : "Packing slips attached to orders from this material list."}
            </DialogDescription>
          </DialogHeader>
          {!online ? (
            <p>Reconnect to view or upload packing slips.</p>
          ) : (
            <>
              {orderId && canUpload && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => camera.current?.click()}
                  >
                    <CameraIcon className="mr-2 size-4" />
                    Take photo
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => files.current?.click()}
                  >
                    <UploadIcon className="mr-2 size-4" />
                    Upload photo or PDF
                  </Button>
                </div>
              )}
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-label="Photograph packing slip"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void upload(file);
                }}
              />
              <input
                ref={files}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                aria-label="Upload packing slip"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void upload(file);
                }}
              />
              {busy && <p role="status">Saving packing slip…</p>}
              {loading && !busy && <p role="status">Loading packing slips…</p>}
              {error && (
                <div role="alert">
                  <p>{error}</p>
                  {retryFile && (
                    <Button
                      disabled={busy}
                      onClick={() => void upload(retryFile)}
                    >
                      Retry upload
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      void load().catch((e) => setError(e.message));
                    }}
                  >
                    Retry loading
                  </Button>
                </div>
              )}
              {!loading && !error && !slips.length && (
                <p className="text-muted-foreground text-sm">
                  No packing slips attached yet.
                  {!orderId ? " Open Verify Order to attach one." : ""}
                </p>
              )}
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {slips.map((slip) => (
                  <Link
                    key={slip.id}
                    href={`/dashboard/jobs/${jobId}/documents?document=${slip.id}`}
                    className="hover:bg-accent block rounded-lg border p-3 text-sm"
                    onClick={() => setOpen(false)}
                  >
                    <span className="block font-medium">{slip.name}</span>
                    <span className="text-muted-foreground">
                      {slip.packingSlip.orderNumber} ·{" "}
                      {new Date(slip.createdAt).toLocaleDateString()}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
