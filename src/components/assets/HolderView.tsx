"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRightLeftIcon, ClipboardCheckIcon, PackageOpenIcon, PrinterIcon, Undo2Icon, WarehouseIcon } from "lucide-react";

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
import { ListPageSkeleton } from "~/components/ui/skeleton";
import { notify } from "~/components/ui/app-dialogs";
import { api } from "~/trpc/react";

import { MoveDialog, type StockPick } from "./AssetDialogs";
import {
  AssetsShell,
  EmptyState,
  ErrorText,
  ToolStatusBadge,
  formatQty,
  selectClass,
  useIsOnline,
  useToolRoom,
  type HolderRef,
} from "./shared";

export function HolderView({ holder }: { holder: HolderRef }) {
  const router = useRouter();
  const isOnline = useIsOnline();
  const { canManage } = useToolRoom();
  const utils = api.useUtils();
  const query = api.assets.holdings.useQuery({ holder }, { enabled: isOnline });
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [selectedStock, setSelectedStock] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"move" | "return" | "checkin" | null>(null);
  const startCount = api.assets.startCount.useMutation({
    onSuccess: async (count) => {
      await utils.assets.listCounts.invalidate();
      router.push(`/dashboard/assets/counts/${count.id}`);
    },
  });

  useEffect(() => {
    setSelectedTools(new Set());
    setSelectedStock(new Set());
  }, [holder.type, holder.id]);

  const data = query.data;
  const tools = data?.tools ?? [];
  const stock = data?.stock ?? [];
  const pickedStock: StockPick[] = stock
    .filter((s) => selectedStock.has(s.partId))
    .map((s) => ({ partId: s.partId, name: s.name, from: holder, available: s.quantity }));
  const count = selectedTools.size + selectedStock.size;
  const allSelected = tools.length + stock.length > 0 && count === tools.length + stock.length;
  const isLocation = holder.type === "location";
  const canMove = canManage || !isLocation;
  const clear = () => {
    setSelectedTools(new Set());
    setSelectedStock(new Set());
  };
  const toggle = (setter: typeof setSelectedTools, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AssetsShell
      title={data?.holder.label ?? "Tools"}
      description={
        holder.type === "job"
          ? "Tools checked out to this job"
          : holder.type === "user"
            ? "Tools this person has"
            : "Tools stored here"
      }
      actions={
        <>
          {holder.type === "job" && (
            <Button variant="outline" asChild>
              <Link href={`/dashboard/jobs/${holder.id}`}>Open job</Link>
            </Button>
          )}
          {canManage && (
            <Button variant="outline" disabled={startCount.isPending} onClick={() => startCount.mutate({ holder })}>
              <ClipboardCheckIcon className="mr-2 h-4 w-4" /> Count
            </Button>
          )}
        </>
      }
    >
      {query.isLoading ? (
        <ListPageSkeleton label="Loading tools" />
      ) : query.error || !data ? (
        <ErrorText message={query.error?.message ?? "Not found."} />
      ) : tools.length + stock.length === 0 ? (
        <EmptyState icon={<PackageOpenIcon />} title="No tools here">
          {holder.type === "job" ? "Request tools from the job's Material Lists page → Tool Request." : null}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="bg-muted/60 sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm backdrop-blur">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) clear();
                  else {
                    setSelectedTools(new Set(tools.map((t) => t.id)));
                    setSelectedStock(new Set(stock.map((s) => s.partId)));
                  }
                }}
              />
              {count ? `${count} selected` : "Select"}
            </label>
            {count > 0 && (
              <>
                {canMove && (
                  <Button size="sm" variant="outline" onClick={() => setDialog("move")}>
                    <ArrowRightLeftIcon className="mr-1.5 h-4 w-4" /> Move
                  </Button>
                )}
                {holder.type === "job" && (
                  <Button size="sm" variant="outline" onClick={() => setDialog("return")}>
                    <Undo2Icon className="mr-1.5 h-4 w-4" /> Send back to yard
                  </Button>
                )}
                {canManage && !isLocation && (
                  <Button size="sm" variant="outline" onClick={() => setDialog("checkin")}>
                    <WarehouseIcon className="mr-1.5 h-4 w-4" /> Check in
                  </Button>
                )}
                {selectedTools.size > 0 && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/dashboard/assets/labels?ids=${[...selectedTools].join(",")}`} target="_blank" rel="noreferrer">
                      <PrinterIcon className="mr-1.5 h-4 w-4" /> Labels
                    </a>
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="bg-card divide-y rounded-lg border">
            {tools.map((tool) => (
              <div key={tool.id} className="hover:bg-accent flex items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={selectedTools.has(tool.id)}
                  onChange={() => toggle(setSelectedTools, tool.id)}
                  aria-label={`Select ${tool.assetTag}`}
                />
                <Link href={`/dashboard/assets/tools/${tool.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{tool.assetTag}</span>
                    <span className="font-medium">{tool.name}</span>
                    {tool.status !== "in_use" && tool.status !== "available" && <ToolStatusBadge status={tool.status} />}
                  </div>
                  {tool.serialNumber && <div className="text-muted-foreground text-xs">S/N {tool.serialNumber}</div>}
                </Link>
              </div>
            ))}
            {stock.map((s) => (
              <label key={s.partId} className="hover:bg-accent flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={selectedStock.has(s.partId)}
                  onChange={() => toggle(setSelectedStock, s.partId)}
                />
                <span className="min-w-0 flex-1 font-medium">{s.name}</span>
                <span className="font-semibold tabular-nums">× {formatQty(s.quantity)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <MoveDialog
        open={dialog === "move"}
        onOpenChange={(open) => setDialog(open ? "move" : null)}
        assetIds={[...selectedTools]}
        stock={pickedStock}
        from={holder}
        canManage={canManage}
        onDone={clear}
      />
      {holder.type === "job" && (
        <ReturnDialog
          open={dialog === "return"}
          onOpenChange={(open) => setDialog(open ? "return" : null)}
          jobId={holder.id}
          assetIds={[...selectedTools]}
          stock={pickedStock}
          onDone={clear}
        />
      )}
      <CheckInDialog
        open={dialog === "checkin"}
        onOpenChange={(open) => setDialog(open ? "checkin" : null)}
        assetIds={[...selectedTools]}
        stock={pickedStock}
        onDone={clear}
      />
      <ErrorText message={startCount.error?.message} />
    </AssetsShell>
  );
}

function StockQuantities({
  stock,
  quantities,
  setQuantities,
}: {
  stock: StockPick[];
  quantities: Record<string, string>;
  setQuantities: (update: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  return (
    <>
      {stock.map((s) => (
        <div key={s.partId} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
          <Input
            className="h-8 w-24 text-right"
            inputMode="decimal"
            value={quantities[s.partId] ?? ""}
            onChange={(event) => setQuantities((q) => ({ ...q, [s.partId]: event.target.value }))}
            aria-label={`Quantity of ${s.name}`}
          />
          <span className="text-muted-foreground w-14 text-xs">of {formatQty(s.available)}</span>
        </div>
      ))}
    </>
  );
}

/** Foreman: ask the tool room to take tools back from the job. */
function ReturnDialog({
  open,
  onOpenChange,
  jobId,
  assetIds,
  stock,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  assetIds: string[];
  stock: StockPick[];
  onDone: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const request = api.assets.requestReturn.useMutation({
    onSuccess: async (order) => {
      await utils.assets.invalidate();
      onOpenChange(false);
      onDone();
      notify(`${order.orderNumber} sent to the tool room.`, "success");
      router.push(`/dashboard/assets/requests/${order.id}`);
    },
  });
  useEffect(() => {
    if (!open) return;
    setNote("");
    setQuantities(Object.fromEntries(stock.map((s) => [s.partId, String(s.available)])));
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const stockLines = stock.map((s) => ({ partId: s.partId, quantity: Number(quantities[s.partId] ?? 0) })).filter((s) => s.quantity > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send tools back</DialogTitle>
          <DialogDescription>
            Creates a return for the tool room. The tools stay on this job until the tool room checks them in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {assetIds.length > 0 && <p className="text-sm">{assetIds.length} tagged tool{assetIds.length === 1 ? "" : "s"}</p>}
          <StockQuantities stock={stock} quantities={quantities} setQuantities={setQuantities} />
          <div className="space-y-1.5">
            <Label htmlFor="return-note">Note for the tool room</Label>
            <Input id="return-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Pickup spot, anything broken…" />
          </div>
          <ErrorText message={request.error?.message} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={assetIds.length + stockLines.length === 0 || request.isPending}
            onClick={() => request.mutate({ jobId, assetIds, stock: stockLines, note: note.trim() || undefined })}
          >
            {request.isPending ? "Sending…" : "Send return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tool room: check tools straight back into a location (no return request). */
function CheckInDialog({
  open,
  onOpenChange,
  assetIds,
  stock,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetIds: string[];
  stock: StockPick[];
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const holders = api.assets.holders.useQuery(undefined, { enabled: open });
  const locations = (holders.data?.locations ?? []).filter((l) => l.isActive);
  const [locationId, setLocationId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const checkIn = api.assets.checkIn.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      onOpenChange(false);
      onDone();
    },
  });
  useEffect(() => {
    if (!open) return;
    setQuantities(Object.fromEntries(stock.map((s) => [s.partId, String(s.available)])));
    checkIn.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locationId, locations]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Check in</DialogTitle>
          <DialogDescription>Put these tools back into the yard, a warehouse or a vehicle.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="checkin-location">Into</Label>
            <select id="checkin-location" className={selectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {assetIds.length > 0 && <p className="text-sm">{assetIds.length} tagged tool{assetIds.length === 1 ? "" : "s"}</p>}
          <StockQuantities stock={stock} quantities={quantities} setQuantities={setQuantities} />
          <ErrorText message={checkIn.error?.message} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!locationId || checkIn.isPending}
            onClick={() =>
              checkIn.mutate({
                locationId,
                assetIds,
                stock: stock
                  .map((s) => ({ partId: s.partId, from: s.from, quantity: Number(quantities[s.partId] ?? 0) }))
                  .filter((s) => s.quantity > 0),
              })
            }
          >
            {checkIn.isPending ? "Checking in…" : "Check in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

