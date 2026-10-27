"use client";
import { PackingSlipTestReview } from "./PackingSlipTestReview";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import { PackingSlipReview } from "./PackingSlipReview";
import { DeliveryTracker } from "./DeliveryTracker";
import type { ReceiptOrderItem, SlipAnalysis } from "~/lib/packing-slip-review";
import dynamic from "next/dynamic";
const PackingSlipScanner = dynamic(() => import("./PackingSlipScanner"), {
  ssr: false,
});
import {
  CameraIcon,
  FileTextIcon,
  InfoIcon,
  UploadIcon,
} from "lucide-react";
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
  packingSlipAnalysis?: SlipAnalysis;
  currentVersionId: string | null;
};
export function PackingSlips({
  jobId,
  materialListId,
  orderId,
  onVerified,
  buttonClassName,
  buttonVariant = "outline",
  openOnMount = false,
  onOpened,
  onChanged,
  onReviewOnList,
}: {
  jobId: string;
  materialListId: string;
  orderId?: string | null;
  onVerified?: () => void;
  buttonClassName?: string;
  buttonVariant?: "default" | "outline";
  /** Open the list at once, e.g. to watch a slip just matched to this order. */
  openOnMount?: boolean;
  onOpened?: () => void;
  /** A slip was added, read again or cleared. */
  onChanged?: () => void;
  /** Read slips are checked on the material list's parts, not here. */
  onReviewOnList?: (documentId: string) => void;
}) {
  const router=useRouter();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [slips, setSlips] = useState<Slip[]>([]),
    [canUpload, setCanUpload] = useState(false),
    [orderItems, setOrderItems] = useState<ReceiptOrderItem[] | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  useEffect(() => setRetryFile(null), [jobId, materialListId, orderId]);
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [openingScanner, setOpeningScanner] = useState(false);
  const scanOnLoad = useRef(false);
  const opened = useRef(false);
  useEffect(() => {
    if (!openOnMount || opened.current) return;
    opened.current = true;
    setOpen(true);
    onOpened?.();
  }, [openOnMount, onOpened]);
  const files = useRef<HTMLInputElement>(null);
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
          order?: { items: ReceiptOrderItem[] };
          error?: string;
        };
        if (!response.ok)
          throw Error(result.error ?? "Could not load packing slips.");
        if (signal?.aborted) return;
        setSlips(result.documents ?? []);
        setCanUpload(!!result.canUpload);
        setOrderItems(result.order?.items ?? null);
        if (scanOnLoad.current) {
          scanOnLoad.current = false;
          // Existing slips open their saved comparisons; only a first scan opens the camera.
          setScanning(
            Boolean(orderId && result.canUpload && !result.documents?.length) &&
              (await hasCamera()) &&
              !signal?.aborted,
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setOpeningScanner(false);
        }
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
    setOrderItems(null);
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not load packing slips.",
        );
    });
    return () => controller.abort();
  }, [open, online, load]);
  const upload = async (file: File | undefined) => {
    if (!file || !orderId) return false;
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
      const result = (await response.json()) as {
        error?: string;
        documentId?:string;
        analysisError?: string;
      };
      if (!response.ok)
        throw Error(
          result.error ?? "Could not save packing slip. Please retry.",
        );
      setRetryFile(null);
      onChanged?.();
      setNotice(
        result.analysisError ??
          "Packing slip saved. It's being read now.",
      );
      await load().catch(() =>
        setError("Packing slip saved. Reopen this window to refresh the list."),
      );
      // Back to the list so the analysis can be watched as it runs.
      setScanning(false);
      // Or straight to the parts, which fill in once the slip is read.
      if (result.documentId) {setOpen(false);router.push(`/jobs/${jobId}/receiving?document=${result.documentId}`);}
      return true;
    } catch (e) {
      setRetryFile(file);
      setError(e instanceof Error ? e.message : "Could not save packing slip.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (
      !open ||
      !online ||
      !slips.some((s) => s.packingSlipAnalysis?.status === "processing")
    )
      return;
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [open, online, slips, load]);
  const analysisAction = async (
    slip: Slip,
    action: "analyze" | "clear",
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/job-documents/packing-slips/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          jobId,
          documentId: slip.id,
          runId: slip.packingSlipAnalysis?.runId,
        }),
      });
      const result = (await res.json()) as { error?: string };
      if (!res.ok)
        throw Error(result.error ?? "Could not update this receipt.");
      await load();
      const tookBack = false;
      if (action === "clear")
        setNotice(
          tookBack
            ? "Detection cleared and this slip's received quantities taken back. The file is still saved."
            : "Detection cleared. Approved quantities and review decisions are preserved.",
        );
      if (action === "analyze")
        setNotice(
          tookBack
            ? "This slip's received quantities were taken back. Reading it again now."
            : "Reading the slip again. Approved quantities are preserved.",
        );
      if (tookBack) onVerified?.();
      onChanged?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update this receipt.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant={buttonVariant}
        className={buttonClassName}
        size="sm"
        onClick={() => {
          scanOnLoad.current = Boolean(orderId);
          setOpeningScanner(Boolean(orderId && online));
          setScanning(false);
          setNotice("");
          setOpen(true);
        }}
      >
        <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
        Packing slips
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy && !scanning) {
            setOpen(value);
            if (!value) setRetryFile(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={!scanning}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-[96vw] xl:max-w-[1500px]"
        >
          <DialogHeader>
            <DialogTitle>
              {scanning || openingScanner
                ? "Scan packing slip"
                : "Packing slips"}
            </DialogTitle>
            <DialogDescription>
              {scanning || openingScanner
                ? "Keep the whole page in view. Captured pages are saved together as a PDF."
                : orderId
                  ? "Add each delivery’s slip. It’s read and filled in on the parts, then you confirm what arrived."
                  : "Packing slips attached to orders from this material list."}
            </DialogDescription>
          </DialogHeader>
          {notice && (
            <p
              role="status"
              className="bg-muted/60 flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            >
              <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          )}
          {/* Kept mounted so the scanner can offer an upload instead. */}
          <input
            ref={files}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            className="hidden"
            aria-label="Upload packing slip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              // A failed upload shows its error and Retry on the list.
              void upload(file).then((ok) => {
                if (!ok) setScanning(false);
              });
            }}
          />
          {openingScanner ? (
            <p role="status">Opening scanner…</p>
          ) : scanning ? (
            <PackingSlipScanner
              key={`${jobId}:${materialListId}:${orderId}`}
              onSave={upload}
              onUpload={() => files.current?.click()}
              onCancel={() => {
                scanOnLoad.current = false;
                setOpeningScanner(false);
                setScanning(false);
                setRetryFile(null);
                setError(null);
              }}
            />
          ) : !online ? (
            <p>Reconnect to view or upload packing slips.</p>
          ) : (
            <>
              {orderId && canUpload && (
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button
                    className="h-11"
                    disabled={busy}
                    onClick={() => setScanning(true)}
                  >
                    <CameraIcon className="mr-2 size-4" />
                    Take photo
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={busy}
                    onClick={() => files.current?.click()}
                  >
                    <UploadIcon className="mr-2 size-4" />
                    Upload
                  </Button>
                </div>
              )}
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
                      void load().catch((e: unknown) =>
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not load packing slips.",
                        ),
                      );
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
              {orderItems && orderItems.length > 0 && (
                <DeliveryTracker items={orderItems} slips={slips} />
              )}
              {slips.length > 0 && (
                <h3 className="text-muted-foreground pt-1 text-xs font-medium tracking-wide uppercase">
                  {slips.length === 1 ? "Slip" : `Slips · ${slips.length}`}
                </h3>
              )}
              <div className="space-y-3">
                {slips.map((slip) => (
                  <div
                    key={slip.id}
                    className="bg-card space-y-3 rounded-xl border p-3 sm:p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                        <FileTextIcon className="text-muted-foreground size-5" />
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        <Link
                          href={`/jobs/${jobId}/documents?document=${slip.id}`}
                          className="block font-medium break-words hover:underline"
                          onClick={() => setOpen(false)}
                        >
                          {slip.name}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {slip.packingSlip.orderNumber} ·{" "}
                          {new Date(slip.createdAt).toLocaleDateString()}
                        </span>
                      </span>
                      <SlipState analysis={slip.packingSlipAnalysis} />
                    </div>
                    <Link className="block py-2 font-medium underline" href={`/jobs/${jobId}/receiving?document=${slip.id}`}>Review matches and receiving</Link>
                    {slip.currentVersionId && (
                      <PackingSlipTestReview
                        key={`${jobId}:${slip.currentVersionId}`}
                        jobId={jobId}
                        versionId={slip.currentVersionId}
                      />
                    )}
                    {(Boolean(orderId && canUpload) ||
                      Boolean(slip.packingSlipAnalysis?.applied)) && (
                      <PackingSlipReview
                        key={`${slip.packingSlipAnalysis?.runId ?? slip.id}:${slip.packingSlipAnalysis?.status ?? "none"}`}
                        analysis={slip.packingSlipAnalysis}
                        versionId={slip.currentVersionId}
                        busy={busy || !online}
                        canManage={canUpload}
                        onAction={(action) => analysisAction(slip, action)}
                        onShowList={
                          onReviewOnList
                            ? () => {
                                window.location.assign(`/jobs/${jobId}/receiving?document=${slip.id}`);
                              }
                            : undefined
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** False only when the browser can tell there is no camera at all. */
export async function hasCamera() {
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    return !devices || devices.some((device) => device.kind === "videoinput");
  } catch {
    return true;
  }
}

const SLIP_STATE = {
  cleared: ["Detection cleared", "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"],
  applied: [
    "Received",
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  ],
  processing: [
    "Reading…",
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ],
  ready: [
    "To check",
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ],
  failed: [
    "Not read",
    "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  ],
} as const;
function SlipState({ analysis }: { analysis?: SlipAnalysis }) {
  if (!analysis) return null;
  const [label, tone] =
    SLIP_STATE[analysis.applied ? "applied" : analysis.status];
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
