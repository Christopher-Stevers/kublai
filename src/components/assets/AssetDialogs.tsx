"use client";

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

import { ErrorText, HolderSelect, selectClass, type HolderRef } from "./shared";

export type StockPick = { partId: string; name: string; from: HolderRef; available: number };

/** Moves tagged tools and/or quantity stock to another holder. */
export function MoveDialog({
  open,
  onOpenChange,
  assetIds,
  stock = [],
  from,
  canManage,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetIds: string[];
  stock?: StockPick[];
  from?: HolderRef | null;
  canManage: boolean;
  onDone?: () => void;
}) {
  const utils = api.useUtils();
  const holders = api.assets.holders.useQuery(undefined, { enabled: open });
  const [to, setTo] = useState<HolderRef | null>(null);
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const transfer = api.assets.transfer.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      onOpenChange(false);
      onDone?.();
    },
  });

  useEffect(() => {
    if (!open) return;
    setTo(null);
    setNote("");
    setQuantities(Object.fromEntries(stock.map((s) => [`${s.partId}:${s.from.type}:${s.from.id}`, String(s.available)])));
    transfer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stockLines = stock
    .map((s) => ({ ...s, quantity: Number(quantities[`${s.partId}:${s.from.type}:${s.from.id}`] ?? 0) }))
    .filter((s) => s.quantity > 0);
  const count = assetIds.length + stockLines.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move tools</DialogTitle>
          <DialogDescription>
            {assetIds.length > 0 && `${assetIds.length} tagged tool${assetIds.length === 1 ? "" : "s"}`}
            {assetIds.length > 0 && stock.length > 0 && " and "}
            {stock.length > 0 && "quantity items"}
            {!canManage && ". Tools going back to the yard need a return request, so the tool room can check them in."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="move-to">Move to</Label>
            <HolderSelect
              id="move-to"
              holders={holders.data}
              value={to}
              onChange={setTo}
              exclude={from}
              allow={canManage ? ["location", "job", "user"] : ["job", "user"]}
            />
          </div>
          {stock.map((s) => {
            const key = `${s.partId}:${s.from.type}:${s.from.id}`;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                <Input
                  className="h-8 w-24 text-right"
                  inputMode="decimal"
                  value={quantities[key] ?? ""}
                  onChange={(event) => setQuantities((q) => ({ ...q, [key]: event.target.value }))}
                  aria-label={`Quantity of ${s.name}`}
                />
                <span className="text-muted-foreground w-14 text-xs">of {s.available}</span>
              </div>
            );
          })}
          <div className="space-y-1.5">
            <Label htmlFor="move-note">Note (optional)</Label>
            <Input id="move-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <ErrorText message={transfer.error?.message} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!to || count === 0 || transfer.isPending}
            onClick={() =>
              to &&
              transfer.mutate({
                to,
                assetIds,
                stock: stockLines.map((s) => ({ partId: s.partId, from: s.from, quantity: s.quantity })),
                note: note.trim() || undefined,
              })
            }
          >
            {transfer.isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Anyone: report a tool damaged or missing, with a note. */
export function ReportProblemDialog({
  open,
  onOpenChange,
  assetId,
  toolLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  toolLabel: string;
}) {
  const utils = api.useUtils();
  const [status, setStatus] = useState<"damaged" | "missing">("damaged");
  const [note, setNote] = useState("");
  const report = api.assets.reportProblem.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      onOpenChange(false);
    },
  });
  useEffect(() => {
    if (open) {
      setStatus("damaged");
      setNote("");
      report.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>{toolLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["damaged", "missing"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm font-medium",
                  status === option
                    ? option === "damaged"
                      ? "border-amber-500 bg-amber-50 text-amber-900"
                      : "border-red-500 bg-red-50 text-red-900"
                    : "hover:bg-accent",
                )}
              >
                {option === "damaged" ? "Damaged" : "Missing"}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="problem-note">What happened?</Label>
            <Textarea
              id="problem-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={status === "damaged" ? "e.g. cord cut, chuck slipping" : "e.g. last seen on level 3 Tuesday"}
            />
          </div>
          <ErrorText message={report.error?.message} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={status === "missing" ? "destructive" : "default"}
            disabled={!note.trim() || report.isPending}
            onClick={() => report.mutate({ assetId, status, note: note.trim() })}
          >
            {report.isPending ? "Saving…" : status === "damaged" ? "Mark damaged" : "Mark missing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tool room: add individually tagged tools of one type. */
export function AddToolsDialog({
  open,
  onOpenChange,
  initialPartId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPartId?: string;
}) {
  const utils = api.useUtils();
  const types = api.assets.listTypes.useQuery(undefined, { enabled: open });
  const holders = api.assets.holders.useQuery(undefined, { enabled: open });
  const [partId, setPartId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [mode, setMode] = useState<"count" | "serials">("count");
  const [count, setCount] = useState("1");
  const [serials, setSerials] = useState("");
  const [created, setCreated] = useState<Array<{ id: string; assetTag: string }> | null>(null);
  const add = api.assets.addAssets.useMutation({
    onSuccess: async (rows) => {
      await utils.assets.invalidate();
      setCreated(rows.map((r) => ({ id: r.id, assetTag: r.assetTag })));
    },
  });
  const receive = api.assets.receiveStock.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      onOpenChange(false);
    },
  });

  const locations = (holders.data?.locations ?? []).filter((l) => l.isActive);
  const type = types.data?.find((t) => t.partId === partId);
  const isQuantity = type?.tracking === "quantity";

  useEffect(() => {
    if (!open) return;
    setPartId(initialPartId ?? "");
    setMode("count");
    setCount("1");
    setSerials("");
    setCreated(null);
    add.reset();
    receive.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locationId, locations]);

  const serialList = serials
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const units =
    mode === "serials"
      ? serialList.map((serialNumber) => ({ serialNumber }))
      : Array.from({ length: Math.min(200, Math.max(0, Math.floor(Number(count) || 0))) }, () => ({}));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? "Tools added" : "Add tools"}</DialogTitle>
          <DialogDescription>
            {created
              ? `${created.length} tool${created.length === 1 ? "" : "s"} tagged. Print their QR labels and stick them on.`
              : "Tagged tools get their own QR label. Consumables and bulk items are counted by quantity."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-wrap gap-1.5">
            {created.map((c) => (
              <span key={c.id} className="bg-muted rounded px-2 py-0.5 font-mono text-xs">
                {c.assetTag}
              </span>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-type">Tool type</Label>
              <select id="add-type" className={selectClass} value={partId} onChange={(event) => setPartId(event.target.value)}>
                <option value="">Choose a tool type…</option>
                {(types.data ?? [])
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <option key={t.partId} value={t.partId}>
                      {t.name}
                      {t.tracking === "quantity" ? " (by quantity)" : ""}
                    </option>
                  ))}
              </select>
              {types.data && types.data.length === 0 && (
                <p className="text-muted-foreground text-xs">Create tool types on the Tool Types page first.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-location">Stored at</Label>
              <select id="add-location" className={selectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            {type && !isQuantity && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(["count", "serials"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMode(option)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm",
                        mode === option ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
                      )}
                    >
                      {option === "count" ? "How many" : "Serial numbers"}
                    </button>
                  ))}
                </div>
                {mode === "count" ? (
                  <Input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} aria-label="How many" />
                ) : (
                  <Textarea
                    value={serials}
                    onChange={(event) => setSerials(event.target.value)}
                    placeholder="One serial number per line"
                    className="min-h-[120px] font-mono text-sm"
                  />
                )}
              </>
            )}
            {type && isQuantity && (
              <div className="space-y-1.5">
                <Label htmlFor="add-qty">Quantity received</Label>
                <Input id="add-qty" inputMode="decimal" value={count} onChange={(event) => setCount(event.target.value)} />
              </div>
            )}
            <ErrorText message={add.error?.message ?? receive.error?.message} />
          </div>
        )}
        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button asChild>
                <a href={`/dashboard/assets/labels?ids=${created.map((c) => c.id).join(",")}`} target="_blank" rel="noreferrer">
                  Print labels
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  !type || !locationId || add.isPending || receive.isPending || (isQuantity ? !(Number(count) > 0) : units.length === 0)
                }
                onClick={() => {
                  if (!type) return;
                  if (isQuantity) receive.mutate({ partId, locationId, quantity: Number(count) });
                  else add.mutate({ partId, locationId, units });
                }}
              >
                {add.isPending || receive.isPending
                  ? "Saving…"
                  : isQuantity
                    ? "Receive"
                    : `Add ${units.length || ""} tool${units.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
