"use client";
import { receivingReviewHref } from "~/lib/receiving-navigation";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  CameraIcon,
  CheckIcon,
  FileTextIcon,
  InboxIcon,
  ListIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { notify } from "~/components/ui/app-dialogs";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { uploadPackingSlip } from "~/lib/packing-slip-upload";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import type { PackingSlipLink } from "~/server/documents/types";
import { hasCamera } from "~/lib/camera-availability";
const PackingSlipScanner = dynamic(() => import("./PackingSlipScanner"), {
  ssr: false,
});

type OrderOption = {
  id: string;
  orderNumber: string;
  supplier: string | null;
  materialListId: string;
  materialListName: string;
  sentAt: string | null;
  received: boolean;
};
type Found = {
  documentId: string;
  match: string | null;
  candidates: string[];
  orders: OrderOption[];
  readError?: string;
  queued?: boolean;
  analysisError?: string;
};
type SavedSlip = {
  id: string;
  name: string;
  createdAt: string;
  packingSlip: PackingSlipLink | null;
  status: string | null;
};
type Step =
  | { kind: "opening" }
  | { kind: "scan" }
  | { kind: "start" }
  | { kind: "saved"; slips: SavedSlip[] | null }
  | { kind: "reading"; file?: File; documentId?: string }
  | { kind: "matched"; found: Found; order: OrderOption }
  | { kind: "pick"; found: Found; all: boolean }
  | { kind: "linking"; order: OrderOption };
/** Seconds before a clear match starts the reading on its own. */
const AUTO_START = 3;

const orderLabel = (o: OrderOption) =>
  o.supplier && !o.orderNumber.toLowerCase().includes(o.supplier.toLowerCase())
    ? `${o.orderNumber} · ${o.supplier}`
    : o.orderNumber;

async function json<T>(response: Response, fallback: string) {
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw Error(result.error ?? fallback);
  return result;
}

/** Scan or choose a packing slip from the job's material lists; the slip's
 * order is worked out from what it lists, then the order's own packing-slip
 * reading starts. */
export function ScanSlipButton({
  jobId,
  materialListId,
  className,
  compact = false,
}: {
  jobId: string;
  materialListId?: string;
  className?: string;
  /** Small icon, for the material list footer. */
  compact?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "opening" });
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_START);
  const files = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const retryScan = useRef<File | null>(null);
  const [barHost, setBarHost] = useState<HTMLDivElement | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);

  const begin = async () => {
    const id = ++run.current;
    setError(null);
    setStep({ kind: "opening" });
    setOpen(true);
    const camera = await hasCamera();
    if (run.current === id) setStep({ kind: camera ? "scan" : "start" });
  };
  const close = () => {
    run.current++;
    setOpen(false);
  };
  // The page sits under the app header; its back button leaves the page.
  useHeaderBackOverride(open ? close : null);
  // Slips waiting in this job's receiving queue, for the Queue button.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setWaiting(null);
    void fetch(
      `/api/job-documents/packing-slips/queue?${new URLSearchParams({ jobId })}`,
      { cache: "no-store" },
    )
      .then((res) =>
        res.ok ? (res.json() as Promise<{ documents?: { status: string }[] }>) : null,
      )
      .then((data) => {
        if (live && data?.documents)
          setWaiting(
            data.documents.filter(
              (d) => d.status === "review" || d.status === "processing",
            ).length,
          );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, jobId]);
  const queue = (leave: () => boolean = () => true) => (
    <Button
      key="queue"
      variant="outline"
      className="relative"
      onClick={() => {
        if (!leave()) return;
        close();
        router.push(`/jobs/${jobId}/receiving`);
      }}
    >
      <InboxIcon />
      Queue
      {!!waiting && (
        <>
          <span
            aria-hidden
            className="bg-primary text-primary-foreground absolute -top-2 -right-2 min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold"
          >
            {waiting}
          </span>
          <span className="sr-only">{`, ${waiting} waiting`}</span>
        </>
      )}
    </Button>
  );
  const found = (result: Found) => {
    if(result.queued){if(result.analysisError) notify(result.analysisError, "error");setOpen(false);router.push(receivingReviewHref(jobId, result.documentId, materialListId));return;}
    const order = result.orders.find((o) => o.id === result.match);
    setCountdown(AUTO_START);
    setStep(
      order
        ? { kind: "matched", found: result, order }
        : { kind: "pick", found: result, all: !result.candidates.length },
    );
  };
  const identify = async (input: { file: File } | { documentId: string }) => {
    const id = ++run.current;
    setError(null);
    setStep({ kind: "reading", ...input });
    try {
      let result: Found;
      if ("file" in input) {
        retryScan.current = input.file;
        const form = new FormData();
        form.set("file", input.file);
        result = await uploadPackingSlip<Found>(
          `/api/job-documents/packing-slips/find?jobId=${encodeURIComponent(jobId)}`,
          form,
        );
      } else {
        setOpen(false);router.push(receivingReviewHref(jobId, input.documentId, materialListId));return;
      }
      if (run.current === id) { retryScan.current = null; found(result); }
    } catch (e) {
      if (run.current === id)
        setError(
          e instanceof Error ? e.message : "Could not read this packing slip.",
        );
    }
  };
  const link = async (documentId: string, order: OrderOption) => {
    const id = ++run.current;
    setError(null);
    setStep({ kind: "linking", order });
    try {
      const result = await json<{
        materialListId: string;
        orderId: string;
        analysisError?: string;
      }>(
        await fetch("/api/job-documents/packing-slips/find", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "link",
            jobId,
            documentId,
            orderId: order.id,
          }),
        }),
        "Could not attach the slip to this order. Please retry.",
      );
      if (run.current !== id) return;
      setOpen(false);
      if (result.analysisError) notify(result.analysisError, "error");
      router.push(receivingReviewHref(jobId, documentId, materialListId));
    } catch (e) {
      if (run.current === id)
        setError(e instanceof Error ? e.message : "Could not attach the slip.");
    }
  };
  const loadSaved = async () => {
    const id = ++run.current;
    setError(null);
    setStep({ kind: "saved", slips: null });
    try {
      const result = await json<{ slips: SavedSlip[] }>(
        await fetch(
          `/api/job-documents/packing-slips/find?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        ),
        "Could not load saved packing slips.",
      );
      if (run.current === id) setStep({ kind: "saved", slips: result.slips });
    } catch (e) {
      if (run.current === id)
        setError(
          e instanceof Error
            ? e.message
            : "Could not load saved packing slips.",
        );
    }
  };

  // A clear match starts on its own unless the member picks another order.
  const matched = step.kind === "matched" ? step : null;
  useEffect(() => {
    if (!matched || !open) return;
    if (countdown <= 0) {
      void link(matched.found.documentId, matched.order);
      return;
    }
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, countdown, open]);

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        className={className}
        disabled={!online}
        onClick={() => void begin()}
      >
        <CameraIcon
          className={compact ? "mr-1 h-3.5 w-3.5 shrink-0" : "mr-2 h-5 w-5"}
        />
        Receive
      </Button>
      <Dialog
        open={open}
        // Not modal, so the app header above the page stays in use.
        modal={false}
        onOpenChange={(value) => {
          if (!value && step.kind !== "scan") close();
        }}
      >
        {/* A full page under the app header, not a pop-up: the camera gets
            the room, and every button sits in the bottom bar. */}
        <DialogContent
          showCloseButton={false}
          layerClassName="app-below-header bottom-0 z-[49] p-0"
          className="data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 flex h-full max-w-none flex-col gap-0 rounded-none border-0 p-0 shadow-none sm:max-w-none"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0 border-b bg-card px-4 py-3 text-left sm:px-6 [html[data-app-landscape]_&]:pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="mx-auto w-full max-w-2xl space-y-1">
              <DialogTitle>
                {step.kind === "saved"
                  ? "Saved packing slips"
                  : step.kind === "pick"
                    ? "Which order is this slip for?"
                    : "Scan packing slip"}
              </DialogTitle>
              <DialogDescription>
                {step.kind === "scan" || step.kind === "start"
                  ? "The slip is matched to its order from the products it lists, then read in full."
                  : step.kind === "saved"
                    ? "Choose a slip already saved for this job."
                    : step.kind === "pick"
                      ? "The slip is saved in Documents → Packing Slips. Choose its order to read it."
                      : "Saved in Documents → Packing Slips."}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="mx-auto grid w-full max-w-2xl gap-3">
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
              if (file) void identify({ file });
            }}
          />
          {step.kind === "opening" && <p role="status">Opening scanner…</p>}
          {step.kind === "scan" && (
            <PackingSlipScanner
              jobId={jobId}
              actionBar={barHost}
              extraActions={
                <Button key="saved" variant="outline" onClick={() => void loadSaved()}>
                  <FileTextIcon />
                  Saved slips
                </Button>
              }
              pageAction={queue}
              onSave={async (file) => {
                void identify({ file });
                return true;
              }}
              onUpload={() => files.current?.click()}
              onCancel={close}
            />
          )}
          {step.kind === "start" && (
            <p className="text-muted-foreground text-sm">
              No camera found. Upload a photo or PDF of the slip, or choose one
              already saved.
            </p>
          )}
          {step.kind === "saved" && (
            <div className="grid gap-2">
              {!step.slips && !error && (
                <p role="status">Loading saved packing slips…</p>
              )}
              {step.slips && !step.slips.length && (
                <p className="text-muted-foreground text-sm">
                  No packing slips saved for this job yet.
                </p>
              )}
              {step.slips?.map((slip) => (
                <button
                  key={slip.id}
                  type="button"
                  className="hover:bg-accent rounded-lg border p-3 text-left text-sm"
                  onClick={() => {
                    close();router.push(receivingReviewHref(jobId, slip.id, materialListId));
                  }}
                >
                  <span className="block font-medium">{slip.name}</span>
                  <span className="text-muted-foreground">
                    {slip.packingSlip
                      ? `${slip.packingSlip.orderNumber} · ${slip.packingSlip.materialListName}`
                      : "Not matched to an order yet"}{" "}
                    · {new Date(slip.createdAt).toLocaleDateString()}
                    {slip.status === "applied" ? " · Received" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
          {step.kind === "reading" && !error && (
            <p role="status">
              Saving the scan. Reading continues in the background once it is saved.
            </p>
          )}
          {step.kind === "matched" && (
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-sm">Matched to</p>
              <p className="font-medium">{orderLabel(step.order)}</p>
              <p className="text-muted-foreground text-sm">
                {step.order.materialListName}
              </p>
            </div>
          )}
          {step.kind === "pick" && (
            <OrderPicker
              found={step.found}
              all={step.all}
              onPick={(order) => void link(step.found.documentId, order)}
            />
          )}
          {step.kind === "linking" && !error && (
            <p role="status">
              Starting the reading for {orderLabel(step.order)}…
            </p>
          )}
          {error && <p role="alert">{error}</p>}
            </div>
          </div>
          <div
            ref={setBarHost}
            className="shrink-0 border-t bg-card px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6 [&>*]:mx-auto [&>*]:max-w-2xl"
          >
            {step.kind !== "scan" && (
              // Lowest priority first: the last action sits on the right.
              <PriorityActionBar>
                {queue()}
                {step.kind === "start" && (
                  <>
                    <Button key="saved" variant="outline" onClick={() => void loadSaved()}>
                      <FileTextIcon />
                      Saved slips
                    </Button>
                    <Button key="upload" onClick={() => files.current?.click()}>
                      <UploadIcon />
                      Upload
                    </Button>
                  </>
                )}
                {step.kind === "saved" && (
                  <>
                    {retryScan.current && (
                      <Button key="retry-scan" variant="outline" onClick={() => void identify({ file: retryScan.current! })}>
                        <RefreshCwIcon />
                        Retry captured scan
                      </Button>
                    )}
                    <Button key="scan" variant={error ? "outline" : "default"} onClick={() => void begin()}>
                      <CameraIcon />
                      Scan a new slip
                    </Button>
                    {error && (
                      <Button key="retry-load" onClick={() => void loadSaved()}>
                        <RefreshCwIcon />
                        Retry loading
                      </Button>
                    )}
                  </>
                )}
                {step.kind === "reading" && error && (
                  <>
                    <Button key="check" variant="outline" onClick={() => void loadSaved()}>
                      <FileTextIcon />
                      Check saved packing slips
                    </Button>
                    <Button
                      key="retry"
                      onClick={() =>
                        void identify(
                          step.file
                            ? { file: step.file }
                            : { documentId: step.documentId! },
                        )
                      }
                    >
                      <RefreshCwIcon />
                      Retry
                    </Button>
                  </>
                )}
                {step.kind === "matched" && (
                  <>
                    <Button
                      key="other"
                      variant="outline"
                      onClick={() =>
                        setStep({ kind: "pick", found: step.found, all: false })
                      }
                    >
                      <ListIcon />
                      Choose another order
                    </Button>
                    <Button
                      key="read"
                      onClick={() => void link(step.found.documentId, step.order)}
                    >
                      <CheckIcon />
                      Read slip now ({countdown})
                    </Button>
                  </>
                )}
                {step.kind === "pick" &&
                  !step.all &&
                  step.found.orders.some(
                    (o) => !step.found.candidates.includes(o.id),
                  ) && (
                    <Button key="all" onClick={() => setStep({ ...step, all: true })}>
                      <ListIcon />
                      Show all {step.found.orders.length} orders
                    </Button>
                  )}
                {step.kind === "linking" && error && (
                  <Button key="over" onClick={() => void begin()}>
                    <RefreshCwIcon />
                    Start over
                  </Button>
                )}
              </PriorityActionBar>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderPicker({
  found,
  all,
  onPick,
}: {
  found: Found;
  all: boolean;
  onPick: (order: OrderOption) => void;
}) {
  const closest = found.candidates
    .map((id) => found.orders.find((o) => o.id === id))
    .filter((o): o is OrderOption => Boolean(o));
  const rest = found.orders.filter((o) => !found.candidates.includes(o.id));
  const lists = [...new Set(rest.map((o) => o.materialListName))];
  const option = (o: OrderOption, best = false) => (
    <button
      key={o.id}
      type="button"
      className="hover:bg-accent rounded-lg border p-3 text-left text-sm"
      onClick={() => onPick(o)}
    >
      <span className="block font-medium">
        {orderLabel(o)}
        {best && (
          <span className="text-muted-foreground font-normal"> · closest</span>
        )}
      </span>
      <span className="text-muted-foreground">
        {o.materialListName}
        {o.sentAt ? ` · sent ${new Date(o.sentAt).toLocaleDateString()}` : ""}
        {o.received ? " · all received" : ""}
      </span>
    </button>
  );
  if (!found.orders.length)
    return (
      <p className="text-muted-foreground text-sm">
        This job has no sent orders to receive. The slip is saved in Documents →
        Packing Slips.
      </p>
    );
  return (
    <div className="grid gap-2">
      {found.readError && (
        <p className="text-sm text-amber-700">{found.readError}</p>
      )}
      {!found.readError && closest.length > 0 && (
        <p className="text-muted-foreground text-sm">
          No order was a clear match. These are the closest.
        </p>
      )}
      {closest.map((o, k) => option(o, k === 0))}
      {/* Show all is in the bottom bar. */}
      {all &&
        lists.map((list) => (
          <div key={list} className="grid gap-2">
            <p className="pt-2 text-sm font-medium">{list}</p>
            {rest
              .filter((o) => o.materialListName === list)
              .map((o) => option(o))}
          </div>
        ))}
    </div>
  );
}
