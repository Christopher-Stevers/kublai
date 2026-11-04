"use client";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { sureOrder, type RankedOrderMatch } from "~/lib/order-match-comparison";

export function OrderMatchCandidates({
  jobId,
  documentId,
  readingKey,
  selectedId,
  onSelect,
  onSure,
}: {
  jobId: string;
  documentId: string;
  readingKey: string;
  selectedId: string;
  onSelect: (orderId: string) => void;
  /** Called with the one order above 90% confidence, once it is ranked. */
  onSure?: (orderId: string) => void;
}) {
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([jobId, documentId, readingKey, retry]);
  const [result, setResult] = useState<{
    key: string;
    rows: RankedOrderMatch[] | null;
  } | null>(null);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/job-documents/packing-slips/queue?${new URLSearchParams({ jobId, documentId, rankOrders: "1" })}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw Error("Ranking unavailable");
        const rows = (await response.json()) as RankedOrderMatch[];
        if (!Array.isArray(rows)) throw Error("Ranking unavailable");
        if (!controller.signal.aborted) setResult({ key, rows });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, rows: null });
      });
    return () => controller.abort();
  }, [jobId, documentId, key]);
  const sure = current?.rows && sureOrder(current.rows);
  useEffect(() => {
    if (sure) onSure?.(sure);
  }, [sure, onSure]);
  return (
    <section aria-label="Top order matches" className="space-y-2">
      <p className="text-sm font-medium">Top 5 Order Matches</p>
      <p className="text-muted-foreground text-xs">
        Ranked from the saved product reading. Select one to compare before
        confirming.
      </p>
      {!current ? (
        <p role="status" className="text-muted-foreground text-sm">
          Ranking saved reading…
        </p>
      ) : !current.rows ? (
        <div role="status" className="text-sm">
          Matches unavailable.{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try Again
          </Button>
        </div>
      ) : !current.rows.length ? (
        <p className="text-muted-foreground text-sm">
          No saved reading or eligible orders yet. You can still choose an order
          below.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {current.rows.slice(0, 5).map((order, index) => (
            <li key={order.orderId}>
              <button
                type="button"
                aria-pressed={selectedId === order.orderId}
                aria-label={`Compare rank ${index + 1}: ${order.orderNumber}`}
                onClick={() => onSelect(order.orderId)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm ${selectedId === order.orderId ? "border-primary bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full font-semibold">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{order.orderNumber}</span>
                  <span className="text-muted-foreground block text-xs">
                    {[order.supplier, order.listName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span
                    className={`block text-xs ${order.weak ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
                  >
                    {order.confidence}% confidence ·{" "}
                    {order.weak
                      ? "Weak match — check carefully"
                      : `${order.found} product${order.found === 1 ? "" : "s"} found`}
                    {selectedId === order.orderId ? " · Selected" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
