"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ListPageSkeleton } from "~/components/ui/skeleton";
import { notify, confirmAction } from "~/components/ui/app-dialogs";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import { AssetsShell, ErrorText, RequestStatusBadge, formatQty, formatWhen, selectClass, useIsOnline } from "./shared";
import { TagScanner } from "./TagScanner";

type Request = RouterOutputs["assets"]["getRequest"];
type Line = Request["lines"][number];

const outstanding = (line: Line) => Math.max(0, line.quantity - line.fulfilledQuantity);

export function RequestDetail({ orderId }: { orderId: string }) {
  const isOnline = useIsOnline();
  const utils = api.useUtils();
  const query = api.assets.getRequest.useQuery({ orderId }, { enabled: isOnline });
  const cancel = api.assets.cancelRequest.useMutation({ onSuccess: () => utils.assets.invalidate() });
  const request = query.data;
  const isOpen = request?.fulfillmentStatus === "open" || request?.fulfillmentStatus === "partial";

  return (
    <AssetsShell
      title={request ? `${request.orderNumber ?? "Request"} · ${request.jobName}` : "Request"}
      description={
        request
          ? `${request.kind === "tool_return" ? "Return" : "Tool request"} from ${request.requestedBy ?? "unknown"}, ${formatWhen(request.sentAt)}`
          : undefined
      }
      actions={
        request && (
          <div className="flex items-center gap-2">
            <RequestStatusBadge status={request.fulfillmentStatus} kind={request.kind} />
            {request.materialListId && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/material-lists/${request.materialListId}`}>Open list</Link>
              </Button>
            )}
            {request.canManageAssets && isOpen && (
              <Button
                variant="ghost"
                size="sm"
                disabled={cancel.isPending}
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `Close ${request.orderNumber}?`,
                    description: "Anything not yet filled is dropped. Tools already checked out stay with the job.",
                    confirmLabel: "Close",
                  });
                  if (ok) cancel.mutate({ orderId });
                }}
              >
                Close
              </Button>
            )}
          </div>
        )
      }
    >
      {query.isLoading ? (
        <ListPageSkeleton rows={4} label="Loading request" />
      ) : query.error || !request ? (
        <ErrorText message={query.error?.message ?? "Request not found."} />
      ) : (
        <div className="space-y-4">
          {request.notes && (
            <p className="bg-muted rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">{request.notes}</p>
          )}
          {request.canManageAssets && isOpen ? (
            request.kind === "tool_request" ? (
              <FulfillForm request={request} />
            ) : (
              <ReceiveReturnForm request={request} />
            )
          ) : (
            <ReadOnlyLines request={request} />
          )}
          <ErrorText message={cancel.error?.message} />
        </div>
      )}
    </AssetsShell>
  );
}

function ReadOnlyLines({ request }: { request: Request }) {
  const verb = request.kind === "tool_return" ? "received" : "filled";
  return (
    <div className="bg-card divide-y rounded-lg border">
      {request.lines.map((line) => (
        <div key={line.id} className="flex items-center justify-between gap-3 p-3 text-sm">
          <div className="min-w-0">
            <div className="font-medium">{line.lineDescription ?? line.name}</div>
            {line.assetTag && <div className="text-muted-foreground font-mono text-xs">{line.assetTag}</div>}
          </div>
          <div className={cn("shrink-0 tabular-nums", outstanding(line) === 0 && "text-emerald-700")}>
            {formatQty(line.fulfilledQuantity)} / {formatQty(line.quantity)} {verb}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tool room picks tagged tools and stock from locations, then checks them out to the job. */
function FulfillForm({ request }: { request: Request }) {
  const utils = api.useUtils();
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [stockPicks, setStockPicks] = useState<Record<string, Record<string, string>>>({});
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const fulfill = api.assets.fulfillRequest.useMutation({
    onSuccess: async (order) => {
      await utils.assets.invalidate();
      await utils.materialList.getOrdersForMaterialList.invalidate();
      notify(order.fulfillmentStatus === "fulfilled" ? "Request filled and checked out to the job." : "Checked out. The rest stays open.", "success");
    },
  });

  // Pre-fill quantity lines from the first location that has enough.
  useEffect(() => {
    const initial: Record<string, Record<string, string>> = {};
    for (const line of request.lines) {
      if (line.tracking !== "quantity") continue;
      let need = outstanding(line);
      initial[line.id] = {};
      for (const source of line.availableStock) {
        if (need <= 0) break;
        const take = Math.min(need, source.quantity);
        initial[line.id]![source.locationId] = String(take);
        need -= take;
      }
    }
    setStockPicks(initial);
    setPicked({});
  }, [request]);

  const toolLine = useMemo(() => {
    const byTag = new Map<string, { lineId: string; assetId: string }>();
    for (const line of request.lines) for (const tool of line.availableTools) byTag.set(tool.assetTag.toUpperCase(), { lineId: line.id, assetId: tool.id });
    return byTag;
  }, [request]);

  const toggleTool = (line: Line, assetId: string) =>
    setPicked((prev) => {
      const set = new Set(prev[line.id] ?? []);
      if (set.has(assetId)) set.delete(assetId);
      else if (set.size < outstanding(line)) set.add(assetId);
      return { ...prev, [line.id]: set };
    });

  const payload = request.lines
    .map((line) => ({
      orderItemId: line.id,
      assetIds: [...(picked[line.id] ?? [])],
      stock: Object.entries(stockPicks[line.id] ?? {})
        .map(([locationId, qty]) => ({ locationId, quantity: Number(qty) }))
        .filter((s) => s.quantity > 0),
    }))
    .filter((l) => l.assetIds.length || l.stock.length);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <TagScanner
          label="Scan tools to pick them"
          onTag={(tag) => {
            const hit = toolLine.get(tag);
            const line = hit && request.lines.find((l) => l.id === hit.lineId);
            if (!hit || !line) {
              setScanMessage(`${tag} isn't an available tool for this request.`);
              return;
            }
            if ((picked[line.id] ?? new Set()).has(hit.assetId)) {
              setScanMessage(`${tag} is already picked.`);
              return;
            }
            if ((picked[line.id]?.size ?? 0) >= outstanding(line)) {
              setScanMessage(`Already have enough ${line.name}.`);
              return;
            }
            toggleTool(line, hit.assetId);
            setScanMessage(`Picked ${tag}: ${line.name}`);
          }}
        />
        {scanMessage && <p className="text-muted-foreground text-xs">{scanMessage}</p>}
      </div>

      {request.lines.map((line) => {
        const need = outstanding(line);
        const chosen = picked[line.id] ?? new Set<string>();
        return (
          <div key={line.id} className="bg-card rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{line.name}</div>
                <div className="text-muted-foreground text-xs">
                  Requested {formatQty(line.quantity)}
                  {line.fulfilledQuantity > 0 && ` · ${formatQty(line.fulfilledQuantity)} already sent`}
                </div>
              </div>
              {need === 0 ? (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                  <CheckIcon className="h-4 w-4" /> Done
                </span>
              ) : line.tracking === "serialized" ? (
                <span className="text-sm tabular-nums">
                  {chosen.size} / {formatQty(need)}
                </span>
              ) : null}
            </div>
            {need > 0 && line.tracking === "serialized" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {line.availableTools.length === 0 && <p className="text-sm text-amber-700">None available in the yard or vehicles.</p>}
                {line.availableTools.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(line, tool.id)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-left text-xs",
                      chosen.has(tool.id) ? "border-primary bg-primary/10" : "hover:bg-accent",
                    )}
                  >
                    <span className="font-mono font-semibold">{tool.assetTag}</span>
                    <span className="text-muted-foreground"> · {tool.locationName}</span>
                  </button>
                ))}
              </div>
            )}
            {need > 0 && line.tracking === "quantity" && (
              <div className="mt-2 space-y-1.5">
                {line.availableStock.length === 0 && <p className="text-sm text-amber-700">None in stock.</p>}
                {line.availableStock.map((source) => (
                  <div key={source.locationId} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{source.locationName}</span>
                    <span className="text-muted-foreground text-xs">{formatQty(source.quantity)} on hand</span>
                    <Input
                      className="h-8 w-20 text-right"
                      inputMode="decimal"
                      value={stockPicks[line.id]?.[source.locationId] ?? ""}
                      onChange={(event) =>
                        setStockPicks((prev) => ({
                          ...prev,
                          [line.id]: { ...(prev[line.id] ?? {}), [source.locationId]: event.target.value },
                        }))
                      }
                      aria-label={`Quantity from ${source.locationName}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <ErrorText message={fulfill.error?.message} />
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={payload.length === 0 || fulfill.isPending}
        onClick={() => fulfill.mutate({ orderId: request.id, lines: payload })}
      >
        {fulfill.isPending ? "Checking out…" : `Check out to ${request.jobName}`}
      </Button>
    </div>
  );
}

/** Tool room receives returned tools into a yard, warehouse or vehicle. */
function ReceiveReturnForm({ request }: { request: Request }) {
  const utils = api.useUtils();
  const [locationId, setLocationId] = useState(request.locations[0]?.id ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const receive = api.assets.receiveReturn.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      notify("Return received.", "success");
    },
  });

  useEffect(() => {
    setQuantities(Object.fromEntries(request.lines.map((line) => [line.id, String(outstanding(line))])));
  }, [request]);

  const lines = request.lines
    .map((line) => ({ orderItemId: line.id, quantity: Number(quantities[line.id] ?? 0) }))
    .filter((l) => l.quantity > 0);

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="return-location">Receive into</Label>
        <select id="return-location" className={selectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          {request.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="bg-card divide-y rounded-lg border">
        {request.lines.map((line) => {
          const need = outstanding(line);
          return (
            <div key={line.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{line.name}</div>
                <div className="text-muted-foreground text-xs">
                  {line.assetTag ? <span className="font-mono">{line.assetTag}</span> : `Returning ${formatQty(line.quantity)}`}
                  {line.fulfilledQuantity > 0 && ` · ${formatQty(line.fulfilledQuantity)} received`}
                </div>
              </div>
              {need === 0 ? (
                <CheckIcon className="h-4 w-4 text-emerald-700" />
              ) : line.assetId ? (
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={Number(quantities[line.id] ?? 0) > 0}
                  onChange={(event) => setQuantities((q) => ({ ...q, [line.id]: event.target.checked ? "1" : "0" }))}
                  aria-label={`Received ${line.assetTag}`}
                />
              ) : (
                <Input
                  className="h-8 w-20 text-right"
                  inputMode="decimal"
                  value={quantities[line.id] ?? ""}
                  onChange={(event) => setQuantities((q) => ({ ...q, [line.id]: event.target.value }))}
                  aria-label={`Quantity received of ${line.name}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        Untick or lower anything that didn&apos;t come back. It stays with the job and the return stays open.
      </p>
      <ErrorText message={receive.error?.message} />
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={!locationId || lines.length === 0 || receive.isPending}
        onClick={() => receive.mutate({ orderId: request.id, locationId, lines })}
      >
        {receive.isPending ? "Receiving…" : "Receive return"}
      </Button>
    </div>
  );
}
