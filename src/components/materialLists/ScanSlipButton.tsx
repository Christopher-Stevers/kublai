"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CameraIcon, FileTextIcon, UploadIcon } from "lucide-react";
import { notify } from "~/components/ui/app-dialogs";
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
import { hasCamera } from "./PackingSlips";
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
  className,
  compact = false,
  onLinked,
}: {
  jobId: string;
  className?: string;
  /** Small icon, for the material list footer. */
  compact?: boolean;
  /** Called with the slip's list and order instead of opening that list. */
  onLinked?: (materialListId: string, orderId: string) => void;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "opening" });
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_START);
  const files = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  // The slip is checked on the list's parts, so open the list itself.
  const openList = (materialListId: string, orderId: string) =>
    onLinked
      ? onLinked(materialListId, orderId)
      : router.push(`/jobs/material-lists/${materialListId}`);
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
  const found = (result: Found) => {
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
      let response: Response;
      if ("file" in input) {
        const form = new FormData();
        form.set("file", input.file);
        response = await fetch(
          `/api/job-documents/packing-slips/find?jobId=${encodeURIComponent(jobId)}`,
          { method: "POST", body: form },
        );
      } else
        response = await fetch("/api/job-documents/packing-slips/find", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "identify",
            jobId,
            documentId: input.documentId,
          }),
        });
      const result = await json<Found>(
        response,
        "Could not read this packing slip. Please retry.",
      );
      if (run.current === id) found(result);
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
      openList(result.materialListId, result.orderId);
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

  const busy = step.kind === "reading" || step.kind === "linking";
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
        Scan slip
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && step.kind !== "scan") close();
        }}
      >
        <DialogContent
          showCloseButton={step.kind !== "scan"}
          className="max-h-[90dvh] overflow-y-auto"
        >
          <DialogHeader>
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
          </DialogHeader>
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
            <>
              <Button variant="outline" onClick={() => void loadSaved()}>
                <FileTextIcon className="mr-2 size-4" />
                Choose a saved slip instead
              </Button>
              <PackingSlipScanner
                onSave={async (file) => {
                  void identify({ file });
                  return true;
                }}
                onUpload={() => files.current?.click()}
                onCancel={close}
              />
            </>
          )}
          {step.kind === "start" && (
            <div className="grid gap-2">
              <Button onClick={() => files.current?.click()}>
                <UploadIcon className="mr-2 size-4" />
                Upload photo or PDF
              </Button>
              <Button variant="outline" onClick={() => void loadSaved()}>
                <FileTextIcon className="mr-2 size-4" />
                Choose a saved slip
              </Button>
            </div>
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
                    const linked = slip.packingSlip;
                    if (!linked) return void identify({ documentId: slip.id });
                    close();
                    // A received slip has nothing left to check on the list.
                    if (slip.status === "applied")
                      router.push(
                        `/jobs/material-lists/${linked.materialListId}?orderId=${linked.orderId}&slips=1`,
                      );
                    else openList(linked.materialListId, linked.orderId);
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
              <Button variant="ghost" onClick={() => void begin()}>
                <CameraIcon className="mr-2 size-4" />
                Scan a new slip
              </Button>
            </div>
          )}
          {step.kind === "reading" && !error && (
            <p role="status">
              Finding the order this slip is for… This can take up to a minute.
            </p>
          )}
          {step.kind === "matched" && (
            <div className="grid gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground text-sm">Matched to</p>
                <p className="font-medium">{orderLabel(step.order)}</p>
                <p className="text-muted-foreground text-sm">
                  {step.order.materialListName}
                </p>
              </div>
              <Button
                onClick={() => void link(step.found.documentId, step.order)}
              >
                Read slip now ({countdown})
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  setStep({ kind: "pick", found: step.found, all: false })
                }
              >
                Choose another order
              </Button>
            </div>
          )}
          {step.kind === "pick" && (
            <OrderPicker
              found={step.found}
              all={step.all}
              onAll={() => setStep({ ...step, all: true })}
              onPick={(order) => void link(step.found.documentId, order)}
            />
          )}
          {step.kind === "linking" && !error && (
            <p role="status">
              Starting the reading for {orderLabel(step.order)}…
            </p>
          )}
          {error && (
            <div role="alert" className="grid gap-2">
              <p>{error}</p>
              {step.kind === "reading" && (
                <Button
                  disabled={busy && !error}
                  onClick={() =>
                    void identify(
                      step.file
                        ? { file: step.file }
                        : { documentId: step.documentId! },
                    )
                  }
                >
                  Retry
                </Button>
              )}
              {step.kind === "linking" && (
                <Button variant="outline" onClick={() => void begin()}>
                  Start over
                </Button>
              )}
              {step.kind === "saved" && (
                <Button onClick={() => void loadSaved()}>Retry loading</Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderPicker({
  found,
  all,
  onAll,
  onPick,
}: {
  found: Found;
  all: boolean;
  onAll: () => void;
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
      {rest.length > 0 &&
        (all ? (
          lists.map((list) => (
            <div key={list} className="grid gap-2">
              <p className="pt-2 text-sm font-medium">{list}</p>
              {rest
                .filter((o) => o.materialListName === list)
                .map((o) => option(o))}
            </div>
          ))
        ) : (
          <Button variant="outline" onClick={onAll}>
            Show all {found.orders.length} orders
          </Button>
        ))}
    </div>
  );
}
